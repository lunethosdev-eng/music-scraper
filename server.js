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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});

const TEMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// VERIFICACIÓN Y CREACIÓN AUTOMÁTICA DEL BUCKET EN SUPABASE
// ---------------------------------------------------------------------------
async function ensureBucketExists() {
  try {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    if (error) {
      console.error('Error listando buckets:', error.message);
      return;
    }
    const exists = buckets.some(b => b.name === 'audio-files');
    if (!exists) {
      console.log('Creando bucket "audio-files" en Supabase...');
      const { error: createErr } = await supabase.storage.createBucket('audio-files', { public: true });
      if (createErr) console.error('Error creando bucket:', createErr.message);
      else console.log('Bucket "audio-files" creado exitosamente.');
    }
  } catch (err) {
    console.error('Error al verificar bucket:', err.message);
  }
}

// ---------------------------------------------------------------------------
// COLA DE DESCARGAS CON SISTEMA DE REINTENTOS
// ---------------------------------------------------------------------------
let downloadQueue = [];
let isProcessingQueue = false;
const MAX_RETRIES = 3;

const INITIAL_SEED_ARTISTS = [
  "Laufey - From The Start",
  "Laufey - Valentine",
  "Hers - What Once Was",
  "Grupo Frontera - un X100to",
  "Eve - Kaikai Kitan",
  "Coqueta - Grupo Frontera"
];

function addToQueue(query) {
  const existing = downloadQueue.find(item => item.query.toLowerCase() === query.toLowerCase());
  if (existing) return existing;

  const newItem = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
    query,
    status: 'pending',
    retryCount: 0,
    progressMessage: 'En espera',
    addedAt: new Date()
  };
  downloadQueue.push(newItem);
  processQueue();
  return newItem;
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (true) {
    const item = downloadQueue.find(i => i.status === 'pending');
    if (!item) break;

    item.status = 'downloading';
    item.progressMessage = item.retryCount > 0 
      ? `Reintentando (${item.retryCount}/${MAX_RETRIES})...` 
      : 'Descargando audio y metadatos...';

    try {
      await autoScrapeAndSave(item.query);
      item.status = 'completed';
      item.progressMessage = '¡Completado con éxito!';
    } catch (err) {
      console.error(`Error procesando "${item.query}":`, err.message);
      item.retryCount += 1;
      
      if (item.retryCount < MAX_RETRIES) {
        item.status = 'pending';
        item.progressMessage = `Error. Fallo #${item.retryCount}, reintentando en breve...`;
      } else {
        item.status = 'failed';
        item.progressMessage = `Fallo definitivo tras ${MAX_RETRIES} intentos: ${err.message}`;
      }
    }
  }

  isProcessingQueue = false;
}

// ---------------------------------------------------------------------------
// METADATOS Y LETRAS
// ---------------------------------------------------------------------------
async function fetchAppleMusicData(term) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const response = await axios.get(url, { timeout: 5000 });
    if (response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      const highResCover = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '1000x1000bb') : null;
      const animatedCover = track.previewUrl || null;

      return {
        coverUrl: highResCover,
        animatedCoverUrl: animatedCover,
        album: track.collectionName,
        artist: track.artistName,
        title: track.trackName
      };
    }
  } catch (err) {
    console.error('Apple Music API fallback:', err.message);
  }
  return { coverUrl: null, animatedCoverUrl: null, album: null, artist: null, title: null };
}

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

async function fetchSyncedLyrics(artist, title) {
  try {
    const response = await axios.get('https://lrclib.net/api/get', {
      params: { artist_name: artist, track_name: title },
      timeout: 4000
    });
    if (response.data && response.data.syncedLyrics) {
      return parseLrc(response.data.syncedLyrics);
    }
  } catch (err) {
    try {
      const searchRes = await axios.get('https://lrclib.net/api/search', {
        params: { q: `${artist} ${title}` },
        timeout: 4000
      });
      if (searchRes.data && searchRes.data.length > 0 && searchRes.data[0].syncedLyrics) {
        return parseLrc(searchRes.data[0].syncedLyrics);
      }
    } catch (e) {}
  }
  return [];
}

// ---------------------------------------------------------------------------
// DESCARGA CON YT-DLP
// ---------------------------------------------------------------------------
async function autoScrapeAndSave(searchQuery) {
  const trackId = Date.now().toString();
  const outputPath = path.join(TEMP_DIR, `${trackId}.mp3`);
  const userAgent = '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"';
  
  const clientArgs = '--extractor-args "youtube:player_client=android,mweb"';

  try {
    let ytTitle = searchQuery;
    let ytThumbnail = null;

    try {
      const metaCmd = `yt-dlp "ytsearch1:${searchQuery.replace(/"/g, '')}" ${clientArgs} --user-agent ${userAgent} --dump-json --no-playlist --no-check-certificates`;
      const { stdout: metaJson } = await execPromise(metaCmd);
      const parsedMeta = JSON.parse(metaJson);
      ytTitle = parsedMeta.title || searchQuery;
      ytThumbnail = parsedMeta.thumbnail || null;
    } catch (metaErr) {
      console.warn('Obtención de metadatos de YouTube omitida:', metaErr.message);
    }

    const downloadCmd = `yt-dlp "ytsearch1:${searchQuery.replace(/"/g, '')}" ${clientArgs} --user-agent ${userAgent} --js-runtimes node --no-playlist --no-check-certificates -x --audio-format mp3 --audio-quality 0 -o "${outputPath}"`;
    await execPromise(downloadCmd);

    if (!fs.existsSync(outputPath)) {
      throw new Error('yt-dlp no pudo generar el archivo MP3');
    }

    const appleData = await fetchAppleMusicData(searchQuery);
    const finalTitle = appleData.title || ytTitle.split('-')[1]?.trim() || ytTitle;
    const finalArtist = appleData.artist || ytTitle.split('-')[0]?.trim() || 'Artista';
    const finalCover = appleData.coverUrl || ytThumbnail;
    const finalAnimatedCover = appleData.animatedCoverUrl || null;

    const lyrics = await fetchSyncedLyrics(finalArtist, finalTitle);

    const fileBuffer = fs.readFileSync(outputPath);
    const audioStoragePath = `tracks/${trackId}_${finalArtist.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    // Subida a Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from('audio-files')
      .upload(audioStoragePath, fileBuffer, { contentType: 'audio/mpeg', upsert: true });

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (uploadErr) throw uploadErr;

    // Guardado en BD Supabase
    const { data: dbTrack, error: dbErr } = await supabase
      .from('tracks')
      .insert([{
        title: finalTitle,
        artist: finalArtist,
        album: appleData.album || 'Single',
        audio_path: audioStoragePath,
        cover_url: finalCover,
        animated_cover_url: finalAnimatedCover,
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
// ENDPOINTS API
// ---------------------------------------------------------------------------
app.get('/api/ping', (req, res) => res.send('PONG'));

app.get('/api/queue', (req, res) => {
  res.json(downloadQueue.slice(-15).reverse());
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Parámetro "q" es obligatorio' });

  try {
    const { data: existingTracks } = await supabase
      .from('tracks')
      .select('*')
      .or(`title.ilike.%${q}%,artist.ilike.%${q}%`);

    if (existingTracks && existingTracks.length > 0) {
      return res.json({ status: 'found', source: 'database', tracks: existingTracks });
    }

    const queueItem = addToQueue(q);
    return res.json({
      status: 'queued',
      message: `"${q}" se agregó a la cola.`,
      queueItem
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tracks', async (req, res) => {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const tracksWithUrls = data.map(track => ({
    ...track,
    audio_stream_url: `${req.protocol}://${req.get('host')}/api/tracks/${track.id}/stream`
  }));

  res.json(tracksWithUrls);
});

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
// DASHBOARD WEB & DOCUMENTACIÓN
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Music Server & API</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; padding-bottom: 120px; }
        header { background: #161e2e; padding: 1.25rem 2rem; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }
        h1 { font-size: 1.3rem; color: #38bdf8; }
        nav { display: flex; gap: 1rem; }
        nav button { background: transparent; border: 1px solid #334155; color: #94a3b8; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-weight: 500; }
        nav button.active { background: #0284c7; color: white; border-color: #0284c7; }
        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
        .grid-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
        @media (max-width: 768px) { .grid-layout { grid-template-columns: 1fr; } }
        .search-box { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; }
        input[type="text"] { flex: 1; padding: 0.85rem; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 0.95rem; outline: none; }
        .btn-main { background: #0284c7; color: white; border: none; padding: 0.85rem 1.25rem; border-radius: 8px; font-weight: 600; cursor: pointer; }
        .catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
        .track-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; overflow: hidden; cursor: pointer; transition: transform 0.2s; }
        .track-card:hover { transform: translateY(-3px); }
        .cover-container { position: relative; width: 100%; aspect-ratio: 1; background: #0f172a; overflow: hidden; }
        .cover-img, .cover-video { width: 100%; height: 100%; object-fit: cover; }
        .track-info { padding: 0.75rem; }
        .queue-panel { background: #161e2e; border: 1px solid #1e293b; border-radius: 12px; padding: 1.25rem; }
        .queue-item { background: #1e293b; padding: 0.75rem; border-radius: 8px; margin-bottom: 0.75rem; border-left: 4px solid #64748b; font-size: 0.85rem; }
        .queue-item.pending { border-color: #f59e0b; }
        .queue-item.downloading { border-color: #3b82f6; animation: pulse 1.5s infinite; }
        .queue-item.completed { border-color: #10b981; }
        .queue-item.failed { border-color: #ef4444; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        
        /* Player & Lyrics Bar */
        .player-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #161e2e; border-top: 1px solid #1e293b; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
        .player-left { display: flex; align-items: center; gap: 1rem; width: 260px; }
        .player-cover { width: 52px; height: 52px; border-radius: 6px; object-fit: cover; background: #0f172a; }
        audio { flex: 1; max-width: 450px; height: 36px; }
        .btn-lyrics { background: #334155; color: #f1f5f9; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; }
        
        /* Modal de Letras */
        .lyrics-panel { display: none; position: fixed; right: 2rem; bottom: 90px; width: 340px; max-height: 400px; background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 1rem; overflow-y: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 100; }
        .lyrics-panel.active { display: block; }
        .lyrics-line { font-size: 0.9rem; margin-bottom: 0.5rem; color: #94a3b8; }
        
        /* Documentación */
        .doc-section { background: #161e2e; border: 1px solid #1e293b; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.5rem; }
        .doc-section h3 { color: #38bdf8; margin-bottom: 0.75rem; font-size: 1.1rem; }
        pre { background: #0f172a; padding: 1rem; border-radius: 8px; color: #34d399; font-size: 0.85rem; overflow-x: auto; border: 1px solid #1e293b; margin-top: 0.5rem; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
      </style>
    </head>
    <body>
      <header>
        <div>
          <h1>🎵 Music Scraper & API</h1>
        </div>
        <nav>
          <button id="btnTabDashboard" class="active" onclick="switchTab('dashboard')">Catálogo</button>
          <button id="btnTabDocs" onclick="switchTab('docs')">📖 Documentación API</button>
        </nav>
      </header>

      <div class="container">
        <!-- VISTA CATÁLOGO Y COLA -->
        <div id="tabDashboard" class="tab-content active">
          <div class="grid-layout">
            <div>
              <div class="search-box">
                <input type="text" id="searchInput" placeholder="Buscar canción o artista..." />
                <button class="btn-main" onclick="handleSearch()">Buscar / Descargar</button>
              </div>
              <h2 style="margin-bottom: 1rem; font-size: 1.1rem; color: #94a3b8;">Canciones Guardadas en Supabase</h2>
              <div id="catalogGrid" class="catalog-grid">Cargando catálogo...</div>
            </div>
            <div class="queue-panel">
              <h3 style="margin-bottom: 1rem;">⚡ Cola de Descargas <span id="queueCount">(0)</span></h3>
              <div id="queueList">Cargando...</div>
            </div>
          </div>
        </div>

        <!-- VISTA DOCUMENTACIÓN SEPARADA -->
        <div id="tabDocs" class="tab-content">
          <div class="doc-section">
            <h3>1. Ejemplos de Petición (Fetch API en JavaScript / Node.js)</h3>
            <p style="font-size: 0.9rem; color: #94a3b8;">Obtén el catálogo de pistas almacenadas directamente desde Supabase:</p>
            <pre>fetch('https://tu-servidor.onrender.com/api/tracks')
  .then(res => res.json())
  .then(tracks => {
    tracks.forEach(track => {
      console.log('Título:', track.title);
      console.log('Streaming URL MP3:', track.audio_stream_url);
      console.log('Cover Animado:', track.animated_cover_url);
      console.log('Letras sincronizadas:', track.lyrics);
    });
  });</pre>
          </div>

          <div class="doc-section">
            <h3>2. Almacenamiento Local en Android TV (Kotlin)</h3>
            <pre>suspend fun cacheMp3(context: Context, trackId: String, streamUrl: String): File = withContext(Dispatchers.IO) {
    val file = File(context.filesDir, "track_$trackId.mp3")
    if (!file.exists()) {
        URL(streamUrl).openStream().use { input ->
            FileOutputStream(file).use { output -> input.copyTo(output) }
        }
    }
    return@withContext file
}</pre>
          </div>

          <div class="doc-section">
            <h3>3. Descarga y Reproducción en Roku TV (BrightScript)</h3>
            <pre>sub DownloadAndPlayAudio(trackId as String, streamUrl as String)
    localPath = "tmp:/" + trackId + ".mp3"
    if not createObject("roFileSystem").Exists(localPath)
        transfer = createObject("roUrlTransfer")
        transfer.SetUrl(streamUrl)
        transfer.writeToFile(localPath)
    end if

    audioContent = createObject("roSGNode", "ContentNode")
    audioContent.url = localPath
    audioContent.streamformat = "mp3"

    m.audioPlayer = createObject("roSGNode", "Audio")
    m.audioPlayer.content = audioContent
    m.audioPlayer.control = "play"
end sub</pre>
          </div>
        </div>
      </div>

      <!-- PANEL DE LETRAS -->
      <div id="lyricsPanel" class="lyrics-panel">
        <h4 style="margin-bottom: 0.75rem; color: #38bdf8;">Letras</h4>
        <div id="lyricsContainer">No hay letras disponibles para esta canción.</div>
      </div>

      <!-- REPRODUCTOR -->
      <div class="player-bar">
        <div class="player-left">
          <div id="playerCoverWrapper" style="width:52px; height:52px;">
            <img id="playerCover" class="player-cover" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" />
          </div>
          <div>
            <h4 id="playerTitle" style="font-size: 0.9rem;">Selecciona una canción</h4>
            <p id="playerArtist" style="font-size: 0.75rem; color: #94a3b8;">-</p>
          </div>
        </div>
        <audio id="audioPlayer" controls></audio>
        <button class="btn-lyrics" onclick="toggleLyrics()">📜 Letras</button>
      </div>

      <script>
        let currentTrackLyrics = [];

        function switchTab(tabName) {
          document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
          document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));
          
          if (tabName === 'dashboard') {
            document.getElementById('tabDashboard').classList.add('active');
            document.getElementById('btnTabDashboard').classList.add('active');
          } else {
            document.getElementById('tabDocs').classList.add('active');
            document.getElementById('btnTabDocs').classList.add('active');
          }
        }

        async function loadCatalog() {
          const res = await fetch('/api/tracks');
          const tracks = await res.json();
          const grid = document.getElementById('catalogGrid');
          grid.innerHTML = '';
          
          if (tracks.length === 0) {
            grid.innerHTML = '<p style="color:#94a3b8;">No hay canciones descargadas aún.</p>';
            return;
          }

          tracks.forEach(track => {
            const card = document.createElement('div');
            card.className = 'track-card';
            card.onclick = () => playTrack(track);

            const hasAnimated = track.animated_cover_url;
            const coverMedia = hasAnimated
              ? '<video class="cover-video" src="' + track.animated_cover_url + '" autoplay loop muted poster="' + (track.cover_url || '') + '"></video>'
              : '<img class="cover-img" src="' + (track.cover_url || 'https://via.placeholder.com/300') + '" />';

            card.innerHTML = 
              '<div class="cover-container">' + coverMedia + '</div>' +
              '<div class="track-info">' +
                '<div style="font-weight: 600; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">' + track.title + '</div>' +
                '<div style="font-size: 0.78rem; color: #94a3b8;">' + track.artist + '</div>' +
              '</div>';
            grid.appendChild(card);
          });
        }

        async function loadQueue() {
          const res = await fetch('/api/queue');
          const items = await res.json();
          const list = document.getElementById('queueList');
          document.getElementById('queueCount').innerText = '(' + items.length + ')';
          if (items.length === 0) { list.innerHTML = '<p style="font-size:0.8rem;">Sin descargas activas.</p>'; return; }
          list.innerHTML = '';
          items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'queue-item ' + item.status;
            div.innerHTML = '<div style="font-weight:600;">' + item.query + '</div><div style="font-size:0.75rem; color:#94a3b8;">' + item.progressMessage + '</div>';
            list.appendChild(div);
          });
        }

        async function handleSearch() {
          const query = document.getElementById('searchInput').value.trim();
          if (!query) return;
          const res = await fetch('/api/search?q=' + encodeURIComponent(query));
          const data = await res.json();
          if (data.status === 'found') playTrack(data.tracks[0]);
          loadQueue();
        }

        function playTrack(track) {
          const wrapper = document.getElementById('playerCoverWrapper');
          if (track.animated_cover_url) {
            wrapper.innerHTML = '<video class="player-cover" src="' + track.animated_cover_url + '" autoplay loop muted poster="' + (track.cover_url || '') + '"></video>';
          } else {
            wrapper.innerHTML = '<img class="player-cover" src="' + (track.cover_url || '') + '" />';
          }

          document.getElementById('playerTitle').innerText = track.title;
          document.getElementById('playerArtist').innerText = track.artist;
          
          const audio = document.getElementById('audioPlayer');
          audio.src = track.audio_stream_url || ('/api/tracks/' + track.id + '/stream');
          audio.play();

          // Cargar letras
          currentTrackLyrics = track.lyrics || [];
          renderLyrics();
        }

        function renderLyrics() {
          const container = document.getElementById('lyricsContainer');
          if (!currentTrackLyrics || currentTrackLyrics.length === 0) {
            container.innerHTML = '<p style="font-size: 0.85rem; color: #64748b;">No hay letras sincronizadas disponibles.</p>';
            return;
          }
          container.innerHTML = currentTrackLyrics.map(line => 
            '<div class="lyrics-line">' + line.text + '</div>'
          ).join('');
        }

        function toggleLyrics() {
          document.getElementById('lyricsPanel').classList.toggle('active');
        }

        loadCatalog(); loadQueue();
        setInterval(loadQueue, 3000);
        setInterval(loadCatalog, 10000);
      </script>
    </body>
    </html>
  `);
});

async function seedInitialQueue() {
  for (const song of INITIAL_SEED_ARTISTS) {
    addToQueue(song);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor de música activo en puerto ${PORT}`);
  await ensureBucketExists();
  setTimeout(seedInitialQueue, 3000);
  setInterval(() => { axios.get(`http://localhost:${PORT}/api/ping`).catch(() => {}); }, 10 * 60 * 1000);
});
