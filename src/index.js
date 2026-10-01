const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const cron = require('node-cron');
const { Server } = require('socket.io');

const { supabase } = require('./config/supabase');
const { seedInitialQueue, processQueueBatch } = require('./workers/queue.worker');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 1. OBTENER CATÁLOGO COMPLETO DE CANCIONES
app.get('/api/tracks', async (req, res) => {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('downloaded_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 2. BÚSQUEDA Y DESCARGA AUTOMÁTICA BAJO DEMANDA (Para Web Client y Roku TV)
app.get('/api/search', async (req, res) => {
  const query = req.query.q || req.query.query;
  if (!query) return res.status(400).json({ error: 'Parámetro de búsqueda "q" es requerido' });

  try {
    // A. Buscar en el catálogo local de Supabase
    const { data: existingTracks } = await supabase
      .from('tracks')
      .select('*')
      .or(`title.ilike.%${query}%,artist_name.ilike.%${query}%`)
      .limit(10);

    if (existingTracks && existingTracks.length > 0) {
      return res.json({ status: 'found', tracks: existingTracks });
    }

    // B. Verificar si ya está en cola procesando o pendiente
    const { data: existingQueue } = await supabase
      .from('download_queue')
      .select('*')
      .ilike('search_query', `%${query}%`)
      .in('status', ['pending', 'processing'])
      .limit(1);

    if (existingQueue && existingQueue.length > 0) {
      return res.json({ 
        status: 'queued', 
        message: 'La canción se está procesando en la cola. Estará disponible en breve.',
        queue_item: existingQueue[0]
      });
    }

    // C. Si no existe, agregar a la cola de descargas con alta prioridad
    const newQueueItem = {
      track_title: query,
      artist_name: 'Auto-Scraped',
      search_query: query,
      status: 'pending'
    };

    const { data: insertedQueue, error: insertErr } = await supabase
      .from('download_queue')
      .insert(newQueueItem)
      .select()
      .single();

    if (insertErr) throw insertErr;

    // Disparar procesamiento inmediato
    processQueueBatch(io).catch(console.error);

    return res.json({
      status: 'downloading',
      message: 'Canción no encontrada en servidor. Scraper iniciado en segundo plano.',
      queue_item: insertedQueue
    });

  } catch (err) {
    console.error('[Search API Error]:', err.message);
    res.status(500).json({ error: 'Error procesando la búsqueda' });
  }
});

// 3. RUTA DE DESCARGA O STREAMING DIRECTO DE AUDIOS
app.get('/api/download-stream/:id', async (req, res) => {
  const { id } = req.params;
  const { data: track, error } = await supabase.from('tracks').select('*').eq('id', id).single();
  
  if (error || !track) return res.status(404).json({ error: 'Canción no encontrada' });

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `inline; filename="${track.artist_name || 'Artista'} - ${track.title || 'Cancion'}.mp3"`);
  res.redirect(track.audio_url);
});

// WebSocket Connection
io.on('connection', (socket) => {
  console.log('📱 Cliente WebSocket conectado:', socket.id);
});

// CRON JOB: Procesa la cola de descarga automáticamente cada minuto
cron.schedule('* * * * *', async () => {
  await processQueueBatch(io);
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, async () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  await seedInitialQueue();
});
