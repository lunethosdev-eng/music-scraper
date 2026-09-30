require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { spawn, exec } = require('child_process');
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

// Ruta al archivo de cookies si existe
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

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
// COLA DE DESCARGAS Y EMISIÓN SSE (PROGRESS REAL-TIME)
// ---------------------------------------------------------------------------
let downloadQueue = [];
let isProcessingQueue = false;
let sseClients = [];
const MAX_RETRIES = 3;

const INITIAL_SEED_ARTISTS = [
  "Laufey - From The Start",
  "Laufey - Valentine",
  "Hers - What Once Was",
  "Grupo Frontera - un X100to",
  "Eve - Kaikai Kitan",
  "Coqueta - Grupo Frontera"
];

function notifySSEClients() {
  const data = JSON.stringify(downloadQueue.slice(-15).reverse());
  sseClients.forEach(client => client.res.write(`data: ${data}\n\n`));
}

function addToQueue(query) {
  const existing = downloadQueue.find(item => item.query.toLowerCase() === query.toLowerCase());
  if (existing) return existing;

  const newItem = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
    query,
    status: 'pending',
    progress: 0,
    retryCount: 0,
    progressMessage: 'En espera...',
    addedAt: new Date()
  };
  downloadQueue.push(newItem);
  notifySSEClients();
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
    item.progress = 0;
    item.progressMessage = item.retryCount > 0 
      ? `Reintentando (${item.retryCount}/${MAX_RETRIES})...` 
      : 'Iniciando descarga...';
    notifySSEClients();

    try {
      await autoScrapeAndSave(item);
      item.status = 'completed';
      item.progress = 100;
      item.progressMessage = '¡Descarga y procesamiento completados!';
      notifySSEClients();
    } catch (err) {
      console.error(`Error procesando "${item.query}":`, err.message);
      item.retryCount += 1;
      
      if (item.retryCount < MAX_RETRIES) {
        item.status = 'pending';
        item.progressMessage = `Error. Reintento #${item.retryCount} programado...`;
      } else {
        item.status = 'failed';
        item.progressMessage = `Fallo: ${err.message.slice(0, 100)}...`;
      }
      notifySSEClients();
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
// DESCARGA ROBUSTA CON YT-DLP Y SEGUIMIENTO DE PORCENTAJE REAL
// ---------------------------------------------------------------------------
function autoScrapeAndSave(queueItem) {
  return new Promise(async (resolve, reject) => {
    const searchQuery = queueItem.query;
    const trackId = Date.now().toString();
    const outputPath = path.join(TEMP_DIR, `${trackId}.mp3`);
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

    let ytTitle = searchQuery;
    let ytThumbnail = null;

    const useCookies = fs.existsSync(COOKIES_PATH);
    const cookiesFlag = useCookies ? `--cookies "${COOKIES_PATH}"` : '';

    try {
      const metaCmd = `yt-dlp "ytsearch1:${searchQuery.replace(/"/g, '')}" ${cookiesFlag} --extractor-args "youtube:player_client=ios,web" --user-agent "${userAgent}" --dump-json --no-playlist --no-check-certificates`;
      const { stdout: metaJson } = await execPromise(metaCmd);
      const parsedMeta = JSON.parse(metaJson);
      ytTitle = parsedMeta.title || searchQuery;
      ytThumbnail = parsedMeta.thumbnail || null;
    } catch (metaErr) {
      console.warn('Metadatos iniciales omitidos:', metaErr.message);
    }

    const args = [
      `ytsearch1:${searchQuery}`,
      '--extractor-args', 'youtube:player_client=ios,web',
      '--user-agent', userAgent,
      '--no-playlist',
      '--no-check-certificates',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', outputPath
    ];

    if (useCookies) {
      args.push('--cookies', COOKIES_PATH);
    }

    const ytdlpProcess = spawn('yt-dlp', args);

    ytdlpProcess.stdout.on('data', (data) => {
      const str = data.toString();
      const match = str.match(/\[download\]\s+(\d+\.\d+)%/);
      if (match) {
        const pct = parseFloat(match[1]);
        queueItem.progress = pct;
        queueItem.progressMessage = `Descargando audio: ${pct.toFixed(1)}%`;
        notifySSEClients();
      }
    });

    ytdlpProcess.stderr.on('data', (data) => {
      console.log(`yt-dlp log: ${data.toString()}`);
    });

    ytdlpProcess.on('close', async (code) => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        return reject(new Error(`yt-dlp finalizó con código de error ${code}`));
      }

      try {
        queueItem.progressMessage = 'Procesando portadas y letras...';
        notifySSEClients();

        const appleData = await fetchAppleMusicData(searchQuery);
        const finalTitle = appleData.title || ytTitle.split('-')[1]?.trim() || ytTitle;
        const finalArtist = appleData.artist || ytTitle.split('-')[0]?.trim() || 'Artista';
        const finalCover = appleData.coverUrl || ytThumbnail;
        const finalAnimatedCover = appleData.animatedCoverUrl || null;

        const lyrics = await fetchSyncedLyrics(finalArtist, finalTitle);

        const fileBuffer = fs.readFileSync(outputPath);
        const audioStoragePath = `tracks/${trackId}_${finalArtist.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

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
        resolve(dbTrack);
      } catch (err) {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        reject(err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// ENDPOINTS API & SSE
// ---------------------------------------------------------------------------
app.get('/api/ping', (req, res) => res.send('PONG'));

app.get('/api/queue', (req, res) => {
  res.json(downloadQueue.slice(-15).reverse());
});

app.get('/api/queue/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  res.write(`data: ${JSON.stringify(downloadQueue.slice(-15).reverse())}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
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
// DASHBOARD WEB & DOCUMENTACIÓN (APPLE DESIGN LANGUAGE)
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Music Server</title>
      <style>
        :root {
          --bg-primary: #000000;
          --bg-surface: #1c1c1e;
          --bg-glass: rgba(28, 28, 30, 0.75);
          --accent: #fa2d48;
          --text-main: #ffffff;
          --text-sub: #8e8e93;
          --border: rgba(255, 255, 255, 0.1);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }
        body { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", sans-serif; background: var(--bg-primary); color: var(--text-main); padding-bottom: 120px; }
        
        header { position: sticky; top: 0; z-index: 50; background: var(--bg-glass); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .logo-group { display: flex; align-items: center; gap: 0.75rem; }
        .logo-group svg { fill: var(--accent); width: 24px; height: 24px; }
        h1 { font-size: 1.25rem; font-weight: 600; letter-spacing: -0.02em; }
        
        nav { display: flex; gap: 0.5rem; background: rgba(120, 120, 128, 0.12); padding: 3px; border-radius: 9px; }
        nav button { background: transparent; border: none; color: var(--text-sub); padding: 0.4rem 1rem; border-radius: 7px; cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: all 0.2s ease; }
        nav button.active { background: #636366; color: #fff; }

        .container { max-width: 1200px; margin: 2rem auto; padding: 0 1.5rem; }
        .grid-layout { display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
        @media (max-width: 850px) { .grid-layout { grid-template-columns: 1fr; } }

        .search-box { display: flex; gap: 0.75rem; margin-bottom: 2rem; position: relative; }
        .search-box input { flex: 1; padding: 0.85rem 1rem 0.85rem 2.8rem; background: var(--bg-surface); border: 1px solid var(--border); border-radius: 12px; color: #fff; font-size: 0.95rem; outline: none; transition: border-color 0.2s; }
        .search-box input:focus { border-color: var(--accent); }
        .search-icon { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); fill: var(--text-sub); width: 18px; height: 18px; }
        
        .btn-apple { background: var(--accent); color: white; border: none; padding: 0.85rem 1.5rem; border-radius: 12px; font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: opacity 0.2s; }
        .btn-apple:hover { opacity: 0.9; }

        .catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 1.25rem; }
        .track-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; cursor: pointer; transition: transform 0.25s ease, box-shadow 0.25s ease; }
        .track-card:hover { transform: scale(1.02); box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .cover-container { position: relative; width: 100%; aspect-ratio: 1; background: #2c2c2e; overflow: hidden; }
        .cover-img, .cover-video { width: 100%; height: 100%; object-fit: cover; }
        .track-info { padding: 0.85rem; }
        .track-title { font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 0.2rem; }
        .track-artist { font-size: 0.8rem; color: var(--text-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

        /* Panel de Cola */
        .queue-panel { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 16px; padding: 1.25rem; height: fit-content; }
        .queue-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; }
        .queue-item { background: rgba(255,255,255,0.04); padding: 0.85rem; border-radius: 10px; margin-bottom: 0.75rem; border: 1px solid var(--border); font-size: 0.85rem; }
        .progress-bar-bg { width: 100%; height: 4px; background: rgba(255,255,255,0.1); border-radius: 2px; margin-top: 0.6rem; overflow: hidden; }
        .progress-bar-fill { height: 100%; background: var(--accent); width: 0%; transition: width 0.3s ease; }

        /* Reproductor Estilo iOS */
        .player-bar { position: fixed; bottom: 0; left: 0; right: 0; background: var(--bg-glass); backdrop-filter: blur(25px); border-top: 1px solid var(--border); padding: 0.85rem 2rem; display: flex; align-items: center; justify-content: space-between; gap: 1.5rem; z-index: 100; }
        .player-left { display: flex; align-items: center; gap: 1rem; min-width: 240px; }
        .player-cover-box { width: 48px; height: 48px; border-radius: 8px; overflow: hidden; background: #2c2c2e; flex-shrink: 0; }
        .player-cover-box img, .player-cover-box video { width: 100%; height: 100%; object-fit: cover; }
        audio { flex: 1; max-width: 500px; height: 36px; }
        .btn-icon { background: rgba(255,255,255,0.08); border: none; padding: 0.6rem; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: background 0.2s; }
        .btn-icon:hover { background: rgba(255,255,255,0.15); }
        .btn-icon svg { fill: #fff; width: 18px; height: 18px; }

        /* Panel de Letras Sincronizadas */
        .lyrics-panel { display: none; position: fixed; right: 2rem; bottom: 85px; width: 360px; max-height: 420px; background: var(--bg-glass); backdrop-filter: blur(30px); border: 1px solid var(--border); border-radius: 18px; padding: 1.25rem; overflow-y: auto; box-shadow: 0 20px 40px rgba(0,0,0,0.6); z-index: 99; }
        .lyrics-panel.active { display: block; }
        .lyrics-line { font-size: 0.95rem; line-height: 1.5; margin-bottom: 0.75rem; color: var(--text-sub); transition: color 0.2s; }
        .lyrics-line.active { color: #fff; font-weight: 600; }

        /* Seccion Docs */
        .doc-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 16px; padding: 1.5rem; margin-bottom: 1.5rem; }
        .doc-card h3 { color: var(--accent); margin-bottom: 0.5rem; font-size: 1.1rem; font-weight: 600; }
        pre { background: #000; padding: 1.2rem; border-radius: 10px; color: #34d399; font-family: "SF Mono", Menlo, monospace; font-size: 0.85rem; overflow-x: auto; border: 1px solid var(--border); margin-top: 0.75rem; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
      </style>
    </head>
    <body>
      <header>
        <div class="logo-group">
          <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
          <h1>Apple Music Core</h1>
        </div>
        <nav>
          <button id="btnTabDashboard" class="active" onclick="switchTab('dashboard')">Catálogo</button>
          <button id="btnTabDocs" onclick="switchTab('docs')">Documentación API</button>
        </nav>
      </header>

      <div class="container">
        <!-- VISTA CATÁLOGO -->
        <div id="tabDashboard" class="tab-content active">
          <div class="grid-layout">
            <div>
              <div class="search-box">
                <svg class="search-icon" viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
                <input type="text" id="searchInput" placeholder="Buscar canción o artista..." />
                <button class="btn-apple" onclick="handleSearch()">Buscar / Descargar</button>
              </div>
              <h2 style="margin-bottom: 1.25rem; font-size: 1.1rem; font-weight: 600; color: var(--text-sub);">Biblioteca Almacenada</h2>
              <div id="catalogGrid" class="catalog-grid">Cargando biblioteca...</div>
            </div>
            
            <div class="queue-panel">
              <div class="queue-header">
                <h3 style="font-size: 1rem; font-weight: 600;">Estado de Descargas</h3>
                <span id="queueCount" style="font-size: 0.8rem; color: var(--text-sub);">(0)</span>
              </div>
              <div id="queueList">Sin descargas.</div>
            </div>
          </div>
        </div>

        <!-- VISTA DOCUMENTACIÓN -->
        <div id="tabDocs" class="tab-content">
          <div class="doc-card">
            <h3>1. Descargar y Guardar MP3 en IndexedDB (Client-side Offline)</h3>
            <p style="font-size: 0.9rem; color: var(--text-sub);">Guarda directamente el archivo MP3 binario dentro del almacenamiento IndexedDB del navegador del usuario sin requerir API keys adicionales en reproducciones posteriores:</p>
            <pre>// Utilizando IndexedDB estándar del navegador
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('MusicCacheDB', 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('tracks', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveTrackOffline(track) {
  const db = await initDB();
  const response = await fetch(track.audio_stream_url);
  const blob = await response.blob();
  
  const tx = db.transaction('tracks', 'readwrite');
  tx.objectStore('tracks').put({
    id: track.id,
    title: track.title,
    artist: track.artist,
    cover: track.cover_url,
    blob: blob
  });
  console.log('Canción guardada localmente en IndexedDB');
}

async function playOfflineTrack(trackId) {
  const db = await initDB();
  const tx = db.transaction('tracks', 'readonly');
  const req = tx.objectStore('tracks').get(trackId);
  req.onsuccess = () => {
    const record = req.result;
    if (record) {
      const audioUrl = URL.createObjectURL(record.blob);
      const audio = new Audio(audioUrl);
      audio.play();
    }
  };
}</pre>
          </div>

          <div class="doc-card">
            <h3>2. Estructura de Respuesta del Catálogo (`GET /api/tracks`)</h3>
            <pre>[
  {
    "id": "1727710000000",
    "title": "From The Start",
    "artist": "Laufey",
    "album": "Bewitched",
    "audio_stream_url": "https://servidor.com/api/tracks/1727710000000/stream",
    "cover_url": "https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/1000x1000bb.jpg",
    "animated_cover_url": "https://audio-ssl.itunes.apple.com/m4v/preview.m4v",
    "lyrics": [
      { "time": 12.4, "text": "Don't look at me like that" }
    ]
  }
]</pre>
          </div>
        </div>
      </div>

      <!-- PANEL DE LETRAS -->
      <div id="lyricsPanel" class="lyrics-panel">
        <h4 style="margin-bottom: 1rem; font-size: 1rem; font-weight: 600;">Letras de la canción</h4>
        <div id="lyricsContainer">No hay letras disponibles.</div>
      </div>

      <!-- REPRODUCTOR -->
      <div class="player-bar">
        <div class="player-left">
          <div id="playerCoverBox" class="player-cover-box"></div>
          <div>
            <div id="playerTitle" style="font-weight: 600; font-size: 0.9rem;">Sin reproducción</div>
            <div id="playerArtist" style="font-size: 0.78rem; color: var(--text-sub);">-</div>
          </div>
        </div>
        <audio id="audioPlayer" controls></audio>
        <button class="btn-icon" onclick="toggleLyrics()" title="Letras">
          <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
        </button>
      </div>

      <script>
        let currentLyrics = [];

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
            grid.innerHTML = '<p style="color:var(--text-sub);">No hay pistas en el catálogo.</p>';
            return;
          }

          tracks.forEach(track => {
            const card = document.createElement('div');
            card.className = 'track-card';
            card.onclick = () => playTrack(track);

            const coverElement = track.animated_cover_url
              ? '<video class="cover-video" src="' + track.animated_cover_url + '" autoplay loop muted poster="' + (track.cover_url || '') + '"></video>'
              : '<img class="cover-img" src="' + (track.cover_url || 'https://via.placeholder.com/300') + '" />';

            card.innerHTML = 
              '<div class="cover-container">' + coverElement + '</div>' +
              '<div class="track-info">' +
                '<div class="track-title">' + track.title + '</div>' +
                '<div class="track-artist">' + track.artist + '</div>' +
              '</div>';
            grid.appendChild(card);
          });
        }

        function renderQueue(items) {
          const list = document.getElementById('queueList');
          document.getElementById('queueCount').innerText = '(' + items.length + ')';
          if (items.length === 0) {
            list.innerHTML = '<p style="font-size:0.85rem; color:var(--text-sub);">No hay tareas pendientes.</p>';
            return;
          }
          list.innerHTML = '';
          items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'queue-item';
            
            const progress = item.progress || 0;
            div.innerHTML = 
              '<div style="font-weight:600;">' + item.query + '</div>' +
              '<div style="font-size:0.75rem; color:var(--text-sub); margin-top: 0.2rem;">' + item.progressMessage + '</div>' +
              '<div class="progress-bar-bg"><div class="progress-bar-fill" style="width:' + progress + '%"></div></div>';
            list.appendChild(div);
          });
        }

        // Conexión SSE para actualización de porcentaje en tiempo real
        const evtSource = new EventSource('/api/queue/stream');
        evtSource.onmessage = function(e) {
          const queueItems = JSON.parse(e.data);
          renderQueue(queueItems);
        };

        async function handleSearch() {
          const query = document.getElementById('searchInput').value.trim();
          if (!query) return;
          const res = await fetch('/api/search?q=' + encodeURIComponent(query));
          const data = await res.json();
          if (data.status === 'found') playTrack(data.tracks[0]);
        }

        function playTrack(track) {
          const box = document.getElementById('playerCoverBox');
          if (track.animated_cover_url) {
            box.innerHTML = '<video src="' + track.animated_cover_url + '" autoplay loop muted poster="' + (track.cover_url || '') + '"></video>';
          } else {
            box.innerHTML = '<img src="' + (track.cover_url || '') + '" />';
          }

          document.getElementById('playerTitle').innerText = track.title;
          document.getElementById('playerArtist').innerText = track.artist;
          
          const audio = document.getElementById('audioPlayer');
          audio.src = track.audio_stream_url || ('/api/tracks/' + track.id + '/stream');
          audio.play();

          currentLyrics = track.lyrics || [];
          renderLyrics();
        }

        function renderLyrics() {
          const container = document.getElementById('lyricsContainer');
          if (!currentLyrics || currentLyrics.length === 0) {
            container.innerHTML = '<p style="font-size: 0.85rem; color: var(--text-sub);">Sin letra disponible.</p>';
            return;
          }
          container.innerHTML = currentLyrics.map(line => 
            '<div class="lyrics-line">' + line.text + '</div>'
          ).join('');
        }

        function toggleLyrics() {
          document.getElementById('lyricsPanel').classList.toggle('active');
        }

        loadCatalog();
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
