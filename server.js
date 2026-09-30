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
// INITIAL SEED ARTISTS & AUTO SEARCH SEEDER
// ---------------------------------------------------------------------------
const SEED_ARTISTS = [
  "Laufey",
  "Grupo Frontera",
  "Her's",
  "Bad Bunny",
  "Milo J",
  "Eve",
  "Cuarteto de Nos",
  "Depresion Sonora",
  "Tatsuro Yamashita",
  "Orange Range"
];

async function ensureBucketExists() {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    if (buckets && !buckets.some(b => b.name === 'audio-files')) {
      await supabase.storage.createBucket('audio-files', { public: true });
    }
  } catch (err) {
    console.error('Error al verificar bucket:', err.message);
  }
}

// ---------------------------------------------------------------------------
// GESTIÓN DE ARTISTAS E IMÁGENES
// ---------------------------------------------------------------------------
async function fetchAndSaveArtistInfo(artistName) {
  try {
    const { data: existing } = await supabase
      .from('artists')
      .select('*')
      .eq('name', artistName)
      .maybeSingle();

    if (existing) return existing;

    const res = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=musicArtist&limit=1`, { timeout: 5000 });
    let imageUrl = null;

    if (res.data.results && res.data.results.length > 0) {
      const songRes = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(artistName)}&entity=song&limit=1`, { timeout: 5000 });
      if (songRes.data.results && songRes.data.results.length > 0) {
        imageUrl = songRes.data.results[0].artworkUrl100?.replace('100x100bb', '600x600bb');
      }
    }

    const { data: newArtist } = await supabase
      .from('artists')
      .insert([{ name: artistName, image_url: imageUrl }])
      .select()
      .single();

    return newArtist;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// COLA DE DESCARGAS PERSISTENTE EN BASE DE DATOS
// ---------------------------------------------------------------------------
async function addToQueue(query) {
  try {
    const { data: existing } = await supabase
      .from('download_queue')
      .select('*')
      .ilike('query', query)
      .maybeSingle();

    if (existing) return existing;

    const { data: newItem } = await supabase
      .from('download_queue')
      .insert([{ query, status: 'pending', progress_message: 'En espera en la cola' }])
      .select()
      .single();

    return newItem;
  } catch (err) {
    console.error('Error añadiendo a la cola:', err.message);
  }
}

let isProcessing = false;
async function processQueueLoop() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const { data: pendingItems } = await supabase
      .from('download_queue')
      .select('*')
      .eq('status', 'pending')
      .limit(5);

    if (pendingItems && pendingItems.length > 0) {
      for (const item of pendingItems) {
        await supabase
          .from('download_queue')
          .update({ status: 'downloading', progress_message: 'Descargando audio...' })
          .eq('id', item.id);

        try {
          await autoScrapeAndSave(item.query);
          await supabase
            .from('download_queue')
            .update({ status: 'completed', progress_message: 'Completado con exito' })
            .eq('id', item.id);
        } catch (err) {
          await supabase
            .from('download_queue')
            .update({ status: 'failed', progress_message: `Error: ${err.message}` })
            .eq('id', item.id);
        }
      }
    }
  } catch (err) {
    console.error('Error procesando bucle de descargas:', err.message);
  } finally {
    isProcessing = false;
  }
}

// Generador automático de catálogo continuo
async function autoPopulateCatalog() {
  try {
    for (const artist of SEED_ARTISTS) {
      await fetchAndSaveArtistInfo(artist);
      const res = await axios.get(`https://itunes.apple.com/search?term=${encodeURIComponent(artist)}&entity=song&limit=20`, { timeout: 5000 });
      if (res.data && res.data.results) {
        for (const track of res.data.results) {
          const query = `${track.artistName} - ${track.trackName}`;
          await addToQueue(query);
        }
      }
    }
  } catch (err) {
    console.error('Error poblando la cola automatica:', err.message);
  }
}

// ---------------------------------------------------------------------------
// METADATOS Y YOUTUBE DL (CON FILTRO DE DURACIÓN)
// ---------------------------------------------------------------------------
async function fetchAppleMusicData(term) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const response = await axios.get(url, { timeout: 5000 });
    if (response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      return {
        coverUrl: track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '800x800bb') : null,
        animatedCoverUrl: track.previewUrl || null,
        album: track.collectionName,
        artist: track.artistName,
        title: track.trackName
      };
    }
  } catch (err) {}
  return { coverUrl: null, animatedCoverUrl: null, album: null, artist: null, title: null };
}

async function autoScrapeAndSave(searchQuery) {
  const trackId = Date.now().toString();
  const outputPath = path.join(TEMP_DIR, `${trackId}.mp3`);
  const userAgent = '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"';
  
  // --match-filter evita descargar videos de mas de 10 minutos (evita podcasts/noticias)
  const clientArgs = '--extractor-args "youtube:player_client=android,mweb" --match-filter "duration <= 600"';

  try {
    const searchTarget = `${searchQuery} audio`;
    const downloadCmd = `yt-dlp "ytsearch1:${searchTarget.replace(/"/g, '')}" ${clientArgs} --user-agent ${userAgent} --no-playlist --no-check-certificates -x --audio-format mp3 --audio-quality 0 -o "${outputPath}"`;
    await execPromise(downloadCmd);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Archivo MP3 no generado o excede duracion maxima');
    }

    const appleData = await fetchAppleMusicData(searchQuery);
    const finalTitle = appleData.title || searchQuery;
    const finalArtist = appleData.artist || 'Artista Desconocido';
    
    const artistRecord = await fetchAndSaveArtistInfo(finalArtist);

    const fileBuffer = fs.readFileSync(outputPath);
    const audioStoragePath = `tracks/${trackId}_clean.mp3`;

    const { error: uploadErr } = await supabase.storage
      .from('audio-files')
      .upload(audioStoragePath, fileBuffer, { contentType: 'audio/mpeg', upsert: true });

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (uploadErr) throw uploadErr;

    const { data: dbTrack, error: dbErr } = await supabase
      .from('tracks')
      .insert([{
        title: finalTitle,
        artist: finalArtist,
        artist_id: artistRecord ? artistRecord.id : null,
        album: appleData.album || 'Single',
        audio_path: audioStoragePath,
        cover_url: appleData.coverUrl || (artistRecord ? artistRecord.image_url : null),
        animated_cover_url: appleData.animatedCoverUrl,
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
app.get('/api/ping', (req, res) => res.send('PONG'));

app.get('/api/artists', async (req, res) => {
  const { data, error } = await supabase.from('artists').select('*');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get('/api/queue', async (req, res) => {
  const { data } = await supabase.from('download_queue').select('*').order('created_at', { ascending: false }).limit(20);
  res.json(data || []);
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Falta parametro q' });

  const { data: existing } = await supabase
    .from('tracks')
    .select('*')
    .or(`title.ilike.%${q}%,artist.ilike.%${q}%`);

  if (existing && existing.length > 0) {
    return res.json({ status: 'found', tracks: existing });
  }

  const queueItem = await addToQueue(q);
  res.json({ status: 'queued', queueItem });
});

app.get('/api/tracks', async (req, res) => {
  const { data, error } = await supabase.from('tracks').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const tracksWithUrls = data.map(t => ({
    ...t,
    audio_stream_url: `${req.protocol}://${req.get('host')}/api/tracks/${t.id}/stream`
  }));
  res.json(tracksWithUrls);
});

app.get('/api/tracks/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: track } = await supabase.from('tracks').select('audio_path').eq('id', id).single();
    if (!track) return res.status(404).json({ error: 'No encontrado' });

    const { data: fileBlob, error: downloadErr } = await supabase.storage.from('audio-files').download(track.audio_path);
    if (downloadErr) throw downloadErr;

    const arrayBuffer = await fileBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// VISTA WEB Y DOCUMENTACIÓN
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Music Server Dashboard</title>
  <style>
    body { font-family: sans-serif; background: #0f172a; color: #fff; padding: 20px; }
    .card { background: #1e293b; padding: 15px; margin-bottom: 10px; border-radius: 8px; }
    input { padding: 10px; width: 300px; }
    button { padding: 10px; background: #0284c7; color: white; border: none; cursor: pointer; }
  </style>
</head>
<body>
  <h1>🎵 Music Server API & Downloader</h1>
  <div class="card">
    <h3>Buscar / Descargar Cancion</h3>
    <input type="text" id="q" placeholder="Ej: Milo J - Niño" />
    <button onclick="search()">Buscar</button>
  </div>
  <div class="card">
    <h3>Estado del servidor: <span style="color: #34d399;">Activo</span></h3>
    <p>Endpoints Roku / Android: <code>GET /api/tracks</code></p>
  </div>
  <script>
    async function search() {
      const q = document.getElementById('q').value;
      if(!q) return;
      const res = await fetch('/api/search?q=' + encodeURIComponent(q));
      const data = await res.json();
      alert(JSON.stringify(data));
    }
  </script>
</body>
</html>`;
  res.setHeader('Content-Type', 'text/html');
  res.send(htmlContent);
});

// ---------------------------------------------------------------------------
// INICIALIZACIÓN
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
  await ensureBucketExists();
  
  // Ejecuta la carga de listas masivas
  autoPopulateCatalog();

  // Revisa la cola cada 12 segundos para procesar descargas sostenidas
  setInterval(processQueueLoop, 12000);

  // Ping autoinvocado para evitar suspensiones de Render
  setInterval(() => {
    axios.get(`http://localhost:${PORT}/api/ping`).catch(() => {});
  }, 5 * 60 * 1000);
});
