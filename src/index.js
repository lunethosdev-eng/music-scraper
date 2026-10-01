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
app.use(express.static(path.join(__dirname, 'public')));

// RUTAS API DE CLIENTE
app.get('/api/tracks', async (req, res) => {
  const { data, error } = await supabase.from('tracks').select('*').order('downloaded_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// RUTA PARA DESCARGA DIRECTA DE AUDIOS (EN BUCKETS)
app.get('/api/download-stream/:id', async (req, res) => {
  const { id } = req.params;
  const { data: track, error } = await supabase.from('tracks').select('*').eq('id', id).single();
  
  if (error || !track) return res.status(404).json({ error: 'Canción no encontrada' });

  // Retorna respuesta con cabeceras para caching offline en cliente
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Disposition', `inline; filename="${track.artist_name} - ${track.title}.mp3"`);
  res.redirect(track.audio_url);
});

// Websocket connection
io.on('connection', (socket) => {
  console.log('📱 Cliente WebSocket conectado:', socket.id);
});

// CRON JOB: Procesa la cola de descarga cada minuto para mantener ~500 descargas/hora
cron.schedule('* * * * *', async () => {
  await processQueueBatch(io);
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, async () => {
  console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
  await seedInitialQueue();
});
