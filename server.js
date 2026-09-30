require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const axios = require('axios');

const execPromise = util.promisify(exec);

const app = express();
app.use(cors());
app.use(express.json());

// Variables de entorno de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ajbmpgnzkgtcmulocftd.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Inicialización de Supabase con soporte de WebSocket para Node.js
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});

const TEMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// FUNCIONES AUXILIARES: APPLE MUSIC & LRCLIB (LETRAS KARAOKE)
// ---------------------------------------------------------------------------

// Buscar portada HD en Apple Music iTunes Search API
async function fetchAppleMusicCover(term) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const response = await axios.get(url);
    if (response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      const highResCover = track.artworkUrl100.replace('100x100bb', '1000x1000bb');
      return { coverUrl: highResCover, album: track.collectionName, artist: track.artistName, title: track.trackName };
    }
  } catch (err) {
    console.error('Error buscando portada en Apple Music:', err.message);
  }
  return { coverUrl: null, album: null, artist: null, title: null };
}

// Parsear formato de letras sincronizadas LRC a un arreglo JSON
function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = parseInt(match[3].padEnd(3, '0'), 10);
      const timeInSeconds = min * 60 + sec + ms / 1000;
      const text = line.replace(timeRegex, '').trim();
      if (text) result.push({ time: timeInSeconds, text });
    }
  }
  return result;
}

// Buscar letras sincronizadas en LRCLIB API
async function fetchSyncedLyrics(artist, title) {
  try {
    const response = await axios.get('https://lrclib.net/api/get', {
      params: { artist_name: artist, track_name: title }
    });
    if (response.data && response.data.syncedLyrics) {
      return parseLrc(response.data.syncedLyrics);
    }
  } catch (err) {
    try {
      const searchRes = await axios.get('https://lrclib.net/api/search', {
        params: { q: `${artist} ${title}` }
      });
      if (searchRes.data && searchRes.data.length > 0 && searchRes.data[0].syncedLyrics) {
        return parseLrc(searchRes.data[0].syncedLyrics);
      }
    } catch (searchErr) {
      console.error('Error buscando letras sincronizadas:', searchErr.message);
    }
  }
  return [];
}

// Proceso automático de scraping y subida a Supabase
async function autoScrapeAndSave(searchQuery) {
  const trackId = Date.now().toString();
  const outputPath = path.join(TEMP_DIR, `${trackId}.mp3`);

  try {
    // 1. Descargar audio con yt-dlp buscando por término en YouTube
    const downloadCmd = `yt-dlp "ytsearch1:${searchQuery.replace(/"/g, '')}" -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" --print "%(title)s"`;
    const { stdout: ytTitle } = await execPromise(downloadCmd);

    if (!fs.existsSync(outputPath)) {
      throw new Error('No se pudo descargar el archivo MP3');
    }

    const cleanYtTitle = (ytTitle || searchQuery).trim().replace(/\r?\n|\r/g, '');

    // 2. Obtener Metadatos y Portada en Apple Music
    const appleData = await fetchAppleMusicCover(searchQuery);
    const finalTitle = appleData.title || cleanYtTitle.split('-')[1]?.trim() || cleanYtTitle;
    const finalArtist = appleData.artist || cleanYtTitle.split('-')[0]?.trim() || 'Artista Desconocido';

    // 3. Obtener Letras Sincronizadas
    const lyrics = await fetchSyncedLyrics(finalArtist, finalTitle);

    // 4. Subir MP3 a Supabase Storage
    const fileBuffer = fs.readFileSync(outputPath);
    const audioStoragePath = `tracks/${trackId}_${finalArtist.replace(/[^a-zA-Z0-0]/g, '_')}.mp3`;

    const { error: uploadErr } = await supabase.storage
      .from('audio-files')
      .upload(audioStoragePath, fileBuffer, { contentType: 'audio/mpeg', upsert: true });

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (uploadErr) throw uploadErr;

    // 5. Insertar en la Base de Datos Supabase
    const { data: dbTrack, error: dbErr } = await supabase
      .from('tracks')
      .insert([{
        title: finalTitle,
        artist: finalArtist,
        album: appleData.album || 'Single',
        audio_path: audioStoragePath,
        cover_url: appleData.coverUrl,
        lyrics: lyrics,
        source_platform: 'auto-scraped'
      }])
      .select()
      .single();

    if (dbErr) throw dbErr;
    return dbTrack;
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ENDPOINTS DE LA API
// ---------------------------------------------------------------------------

// Búsqueda Inteligente: Si no existe en la BD, se descarga automáticamente
app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Parámetro de búsqueda "q" requerido' });

  try {
    // 1. Verificar si ya existe en la Base de Datos
    const { data: existingTracks, error } = await supabase
      .from('tracks')
      .select('*')
      .or(`title.ilike.%${q}%,artist.ilike.%${q}%`);

    if (!error && existingTracks && existingTracks.length > 0) {
      return res.json({ source: 'database', tracks: existingTracks });
    }

    // 2. Si no existe, descargar de inmediato con scraper automatizado
    console.log(`Canción "${q}" no encontrada en catálogo. Iniciando descarga automática...`);
    const newTrack = await autoScrapeAndSave(q);
    return res.json({ source: 'auto-download', tracks: [newTrack] });

  } catch (err) {
    res.status(500).json({ error: `Error procesando la solicitud: ${err.message}` });
  }
});

// Endpoint manual de scraping vía POST
app.post('/api/scrape', async (req, res) => {
  const { url, title, artist, lyrics } = req.body;
  if (!url || !title || !artist) {
    return res.status(400).json({ error: 'Campos requeridos: url, title, artist' });
  }

  const trackId = Date.now().toString();
  const outputPath = path.join(TEMP_DIR, `${trackId}.mp3`);

  try {
    const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
    await execPromise(command);

    const appleData = await fetchAppleMusicCover(`${artist} ${title}`);
    const fetchedLyrics = lyrics && lyrics.length > 0 ? lyrics : await fetchSyncedLyrics(artist, title);

    const fileBuffer = fs.readFileSync(outputPath);
    const audioStoragePath = `tracks/${trackId}_${artist.replace(/\s+/g, '_')}.mp3`;

    const { error: audioUploadErr } = await supabase.storage
      .from('audio-files')
      .upload(audioStoragePath, fileBuffer, { contentType: 'audio/mpeg', upsert: true });

    fs.unlinkSync(outputPath);
    if (audioUploadErr) throw audioUploadErr;

    const { data: dbData, error: dbErr } = await supabase
      .from('tracks')
      .insert([{
        title,
        artist,
        album: appleData.album || 'Single',
        audio_path: audioStoragePath,
        cover_url: appleData.coverUrl,
        lyrics: fetchedLyrics,
        source_platform: url.includes('soundcloud') ? 'soundcloud' : 'youtube'
      }])
      .select()
      .single();

    if (dbErr) throw dbErr;
    res.json({ success: true, track: dbData });
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    res.status(500).json({ error: error.message });
  }
});

// Obtener todas las canciones del catálogo
app.get('/api/tracks', async (req, res) => {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Stream binario de MP3 (Para consumo offline en apps cliente y reproductor)
app.get('/api/tracks/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .select('audio_path')
      .eq('id', id)
      .single();

    if (dbError || !track) return res.status(404).json({ error: 'Canción no encontrada' });

    const { data: fileBlob, error: downloadErr } = await supabase.storage
      .from('audio-files')
      .download(track.audio_path);

    if (downloadErr) throw downloadErr;

    const arrayBuffer = await fileBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// INTERFAZ WEB: DASHBOARD, CATÁLOGO Y REPRODUCTOR INTEGRADO
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Music Server - Catálogo & Reproductor</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; padding-bottom: 120px; }
        header { background: #161e2e; padding: 1.5rem 2rem; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }
        h1 { font-size: 1.4rem; color: #38bdf8; display: flex; align-items: center; gap: 0.5rem; }
        .container { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; }
        .search-box { display: flex; gap: 0.75rem; margin-bottom: 2rem; }
        input[type="text"] { flex: 1; padding: 0.85rem 1.25rem; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 1rem; outline: none; }
        input[type="text"]:focus { border-color: #38bdf8; }
        button { background: #0284c7; color: white; border: none; padding: 0.85rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; transition: 0.2s; }
        button:hover { background: #0369a1; }
        .status-msg { margin-bottom: 1rem; padding: 0.75rem; border-radius: 6px; background: #1e293b; display: none; color: #38bdf8; font-size: 0.9rem; }
        
        .catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1.25rem; }
        .track-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; overflow: hidden; transition: transform 0.2s, border-color 0.2s; cursor: pointer; }
        .track-card:hover { transform: translateY(-4px); border-color: #38bdf8; }
        .cover-img { width: 100%; aspect-ratio: 1; object-fit: cover; background: #0f172a; }
        .track-info { padding: 0.85rem; }
        .track-title { font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .track-artist { font-size: 0.8rem; color: #94a3b8; margin-top: 0.25rem; }

        /* Reproductor Fijo Inferior */
        .player-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #161e2e; border-top: 1px solid #1e293b; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; backdrop-filter: blur(10px); }
        .player-left { display: flex; align-items: center; gap: 1rem; min-width: 240px; }
        .player-cover { width: 56px; height: 56px; border-radius: 6px; object-fit: cover; background: #0f172a; }
        .player-meta h4 { font-size: 0.95rem; color: #fff; }
        .player-meta p { font-size: 0.8rem; color: #94a3b8; }
        audio { flex: 1; max-width: 500px; height: 40px; }
        
        /* Modal de Letras Karaoke */
        .lyrics-box { position: fixed; right: 1rem; bottom: 90px; width: 320px; max-height: 350px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 1rem; overflow-y: auto; display: none; }
        .lyrics-box h3 { font-size: 0.9rem; color: #38bdf8; margin-bottom: 0.5rem; border-bottom: 1px solid #334155; padding-bottom: 0.4rem; }
        .lyric-line { font-size: 0.85rem; color: #64748b; margin: 0.4rem 0; transition: color 0.2s, font-weight 0.2s; }
        .lyric-line.active { color: #38bdf8; font-weight: bold; font-size: 0.95rem; }
      </style>
    </head>
    <body>
      <header>
        <h1>🎵 Music Server - Catálogo</h1>
        <span style="font-size: 0.85rem; color: #34d399;">● Servidor Activo</span>
      </header>

      <div class="container">
        <div class="search-box">
          <input type="text" id="searchInput" placeholder="Buscar canción o artista (ej. Laufey - From The Start)..." />
          <button onclick="handleSearch()">Buscar / Auto-Descargar</button>
        </div>

        <div id="statusMsg" class="status-msg"></div>

        <h2 style="margin-bottom: 1rem; font-size: 1.2rem; color: #94a3b8;">Catálogo de Canciones</h2>
        <div id="catalogGrid" class="catalog-grid"></div>
      </div>

      <!-- Letras Karaoke -->
      <div id="lyricsBox" class="lyrics-box">
        <h3>🎤 Letras en Tiempo Real</h3>
        <div id="lyricsContent"></div>
      </div>

      <!-- Reproductor -->
      <div class="player-bar">
        <div class="player-left">
          <img id="playerCover" class="player-cover" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" alt="" />
          <div class="player-meta">
            <h4 id="playerTitle">Selecciona una canción</h4>
            <p id="playerArtist">-</p>
          </div>
        </div>
        <audio id="audioPlayer" controls></audio>
      </div>

      <script>
        let currentLyrics = [];

        async function loadCatalog() {
          const res = await fetch('/api/tracks');
          const tracks = await res.json();
          renderCatalog(tracks);
        }

        function renderCatalog(tracks) {
          const grid = document.getElementById('catalogGrid');
          grid.innerHTML = '';
          tracks.forEach(track => {
            const card = document.createElement('div');
            card.className = 'track-card';
            card.onclick = () => playTrack(track);
            card.innerHTML = \`
              <img class="cover-img" src="\${track.cover_url || 'https://via.placeholder.com/300'}" />
              <div class="track-info">
                <div class="track-title">\${track.title}</div>
                <div class="track-artist">\${track.artist}</div>
              </div>
            \`;
            grid.appendChild(card);
          });
        }

        async function handleSearch() {
          const query = document.getElementById('searchInput').value.trim();
          if (!query) return;

          const status = document.getElementById('statusMsg');
          status.style.display = 'block';
          status.innerText = '🔍 Buscando en catálogo o iniciando auto-descarga (esto puede tomar unos segundos)...';

          try {
            const res = await fetch(\`/api/search?q=\${encodeURIComponent(query)}\`);
            const data = await res.json();

            if (data.tracks && data.tracks.length > 0) {
              status.innerText = data.source === 'auto-download' ? '✅ ¡Canción descargada y agregada al catálogo!' : '✅ Canción encontrada.';
              loadCatalog();
              playTrack(data.tracks[0]);
            } else {
              status.innerText = '❌ No se pudo encontrar ni descargar la canción.';
            }
          } catch (err) {
            status.innerText = '⚠️ Error en la búsqueda: ' + err.message;
          }
        }

        function playTrack(track) {
          document.getElementById('playerCover').src = track.cover_url || '';
          document.getElementById('playerTitle').innerText = track.title;
          document.getElementById('playerArtist').innerText = track.artist;

          const audio = document.getElementById('audioPlayer');
          audio.src = \`/api/tracks/\${track.id}/stream\`;
          audio.play();

          // Cargar Letras
          currentLyrics = track.lyrics || [];
          renderLyrics(currentLyrics);
        }

        function renderLyrics(lyrics) {
          const box = document.getElementById('lyricsBox');
          const content = document.getElementById('lyricsContent');
          content.innerHTML = '';

          if (!lyrics || lyrics.length === 0) {
            box.style.display = 'none';
            return;
          }

          box.style.display = 'block';
          lyrics.forEach((line, index) => {
            const div = document.createElement('div');
            div.className = 'lyric-line';
            div.id = \`lyric-\${index}\`;
            div.innerText = line.text;
            content.appendChild(div);
          });
        }

        // Sincronización de Letras con el reproductor
        document.getElementById('audioPlayer').addEventListener('timeupdate', (e) => {
          const currentTime = e.target.currentTime;
          if (!currentLyrics.length) return;

          currentLyrics.forEach((line, index) => {
            const el = document.getElementById(\`lyric-\${index}\`);
            if (el) {
              if (currentTime >= line.time && (!currentLyrics[index + 1] || currentTime < currentLyrics[index + 1].time)) {
                el.classList.add('active');
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } else {
                el.classList.remove('active');
              }
            }
          });
        });

        loadCatalog();
      </script>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de música activo en el puerto ${PORT}`));
