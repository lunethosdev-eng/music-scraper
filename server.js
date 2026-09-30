require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TEMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Auxiliar: Buscar portada en Apple Music iTunes Search API
async function fetchAppleMusicCover(term) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const response = await axios.get(url);
    if (response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      // Obtener versión de alta resolución
      const highResCover = track.artworkUrl100.replace('100x100bb', '1000x1000bb');
      return { coverUrl: highResCover, album: track.collectionName };
    }
  } catch (err) {
    console.error('Error obteniendo portada de Apple Music:', err.message);
  }
  return { coverUrl: null, album: null };
}

// RUTA 1: Endpoint de Scraping y Guardado en Supabase
app.post('/api/scrape', async (req, res) => {
  const { url, title, artist, lyrics } = req.body;

  if (!url || !title || !artist) {
    return res.status(400).json({ error: 'Faltan campos requeridos: url, title, artist' });
  }

  const trackId = Date.now().toString();
  const outputPath = path.join(TEMP_DIR, `${trackId}.mp3`);

  try {
    // 1. Descargar audio y convertir a MP3 usando yt-dlp y ffmpeg
    const command = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;
    await execPromise(command);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Error generando el archivo de audio MP3');
    }

    // 2. Obtener portada de Apple Music
    const appleData = await fetchAppleMusicCover(`${artist} ${title}`);

    // 3. Subir archivo MP3 a Supabase Storage ('audio-files')
    const fileBuffer = fs.readFileSync(outputPath);
    const audioStoragePath = `tracks/${trackId}_${artist.replace(/\s+/g, '_')}.mp3`;

    const { error: audioUploadErr } = await supabase.storage
      .from('audio-files')
      .upload(audioStoragePath, fileBuffer, {
        contentType: 'audio/mpeg',
        upsert: true
      });

    fs.unlinkSync(outputPath); // Limpiar archivo local temporal
    if (audioUploadErr) throw audioUploadErr;

    // 4. Guardar metadatos y letras en la base de datos
    const { data: dbData, error: dbErr } = await supabase
      .from('tracks')
      .insert([{
        title,
        artist,
        album: appleData.album || 'Single',
        audio_path: audioStoragePath,
        cover_url: appleData.coverUrl,
        lyrics: lyrics || [],
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

// RUTA 2: Obtener catálogo de canciones
app.get('/api/tracks', async (req, res) => {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// RUTA 3: Transmisión de Stream Binario (Para clientes Offline)
app.get('/api/tracks/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .select('audio_path')
      .eq('id', id)
      .single();

    if (dbError || !track) return res.status(404).json({ error: 'Canción no encontrada' });

    // Descargar desde el Storage de Supabase
    const { data: fileBlob, error: downloadErr } = await supabase.storage
      .from('audio-files')
      .download(track.audio_path);

    if (downloadErr) throw downloadErr;

    const arrayBuffer = await fileBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Encabezados binarios para consumo en la app sin links directos
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// RUTA 4: Documentación e Interfaz de Guía para Clientes
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Music Server API - Documentación Client Fetch</title>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; line-height: 1.5; }
        h1, h2 { color: #38bdf8; }
        pre { background: #1e293b; padding: 1.25rem; border-radius: 8px; overflow-x: auto; color: #7dd3fc; border: 1px solid #334155; }
        .card { background: #1e293b; border: 1px solid #334155; padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem; }
        code { color: #f43f5e; font-family: monospace; }
      </style>
    </head>
    <body>
      <h1>🎵 Server API de Música & Scraper</h1>
      <p>Servidor activo en Render con soporte completo para <code>yt-dlp</code>, <code>ffmpeg</code> y Supabase.</p>

      <div class="card">
        <h2>📌 Endpoints de la API</h2>
        <ul>
          <li><code>POST /api/scrape</code> - Raspa YouTube/SoundCloud, busca portada en Apple Music y guarda en Supabase.</li>
          <li><code>GET /api/tracks</code> - Retorna lista de canciones con letras en formato Karaoke (LRC/JSON).</li>
          <li><code>GET /api/tracks/:id/stream</code> - Descarga directa del stream binario en formato MP3.</li>
        </ul>
      </div>

      <div class="card">
        <h2>📱 Ejemplo de Fetch Offline para Apps Clientes (Web / Capacitor / React Native)</h2>
        <p>Para evitar exponer URLs directas y guardar la música en la memoria offline de la app cliente:</p>
        <pre><code>// Descarga de audio en binario (Blob) para guardado offline
async function loadTrackOffline(trackId) {
  // 1. Fetch directo al endpoint binario
  const response = await fetch(\`https://TU-APP.onrender.com/api/tracks/\${trackId}/stream\`);
  const blob = await response.blob();

  // 2. Generar ObjectURL local para la memoria interna de la app
  const localAudioUrl = URL.createObjectURL(blob);

  // 3. Asignar al reproductor de la app
  const audioPlayer = new Audio(localAudioUrl);
  audioPlayer.play();

  // Opcional: Convertir a ArrayBuffer para almacenamiento persistente en IndexedDB o filesystem local
  // const arrayBuffer = await blob.arrayBuffer();
}</code></pre>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de música activo en el puerto ${PORT}`));
