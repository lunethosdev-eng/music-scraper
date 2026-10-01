const fs = require('fs');
const { supabase } = require('../config/supabase');
const { downloadAudioMP3 } = require('../services/ytdlp.service');
const { fetchAppleMusicCovers } = require('../services/metadata.service');
const { fetchSyncedLyrics } = require('../services/lyrics.service');
const { uploadFileToSupabase } = require('../services/storage.service');

// Artistas configurados con canciones reales para la siembra inicial
const POPULAR_ARTISTS = [
  { name: "Bad Bunny", tracks: ["Monaco", "Tití Me Preguntó", "Ojitos Lindos", "DAKITI"] },
  { name: "Eve", tracks: ["Kaikai Kitan", "Dramaturgy", "Anoko secret", "Bokurano"] },
  { name: "Laufey", tracks: ["From The Start", "Promise", "Falling Behind", "Valentine"] },
  { name: "Her's", tracks: ["What Once Was", "Cool with You", "Marcel", "Harvey"] },
  { name: "Cuarteto de Nos", tracks: ["Porfiado", "Lo Malo de Ser Bueno", "El Hijo de Hernández", "Cinturón Gris"] },
  { name: "Depresión Sonora", tracks: ["Ya no hay verano", "Hasta que llegue la muerte", "Como todo el mundo", "Gasolina y Mechero"] },
  { name: "Cuco", tracks: ["Lo Que Siento", "Hydrocodone", "Amor de Siempre"] },
  { name: "Milo J", tracks: ["Rara Vez", "M.A.I", "Dispara"] },
  { name: "Junior H", tracks: ["Y Lloro", "Fin de Semana", "El Azul"] },
  { name: "Grupo Frontera", tracks: ["un X100to", "No Se Va", "El Comienzo"] },
  { name: "The Marías", tracks: ["Cariño", "Run Your Mouth", "Hush"] },
  { name: "Kenshi Yonezu", tracks: ["Kick Back", "Lemon", "Peace Sign"] }
];

async function seedInitialQueue() {
  console.log('⚡ Poblando cola inicial con artistas y canciones reales...');
  for (const item of POPULAR_ARTISTS) {
    for (const trackTitle of item.tracks) {
      const searchQuery = `${item.name} ${trackTitle}`;
      await supabase.from('download_queue').upsert({
        track_title: trackTitle,
        artist_name: item.name,
        search_query: searchQuery,
        status: 'pending'
      }, { onConflict: 'search_query' });
    }
  }
}

async function processQueueBatch(io) {
  const { data: pendingJobs, error } = await supabase
    .from('download_queue')
    .select('*')
    .eq('status', 'pending')
    .limit(5);

  if (error || !pendingJobs || pendingJobs.length === 0) return;

  for (const job of pendingJobs) {
    try {
      await supabase.from('download_queue').update({ status: 'processing' }).eq('id', job.id);
      
      const artist = job.artist_name || 'Artista_Desconocido';
      const title = job.track_title || 'Cancion_Desconocida';
      const searchQuery = job.search_query || `${artist} ${title}`;

      if (io) io.emit('queue_update', { message: `Descargando: ${artist} - ${title}` });

      const safeFilename = `${artist}_${title}`.replace(/[^a-zA-Z0-9]/g, '_');

      // 1. Descargar MP3 vía yt-dlp
      const localMp3Path = await downloadAudioMP3(searchQuery, safeFilename);

      // 2. Obtener Metadata & Covers (Apple Music) de forma segura
      const metadata = await fetchAppleMusicCovers(artist, title);

      // 3. Obtener Lyrics LRC Sincronizados
      const lyricsLRC = await fetchSyncedLyrics(artist, title);

      // 4. Subir Archivo MP3 a Supabase Storage
      const audioPublicUrl = await uploadFileToSupabase(
        'audio-files', 
        localMp3Path, 
        `${safeFilename}.mp3`, 
        'audio/mpeg'
      );

      // Limpiar archivo temporal local
      if (fs.existsSync(localMp3Path)) fs.unlinkSync(localMp3Path);

      // 5. Guardar Registro en la tabla "tracks"
      await supabase.from('tracks').upsert({
        title: title,
        artist_name: artist,
        album: metadata.album || 'Single',
        duration_sec: metadata.durationSec || 180,
        audio_url: audioPublicUrl,
        static_cover_url: metadata.staticCover,
        animated_cover_url: metadata.animatedCover,
        synced_lyrics_lrc: lyricsLRC,
        source_platform: 'youtube/apple'
      }, { onConflict: 'title,artist_name' });

      // Marcar trabajo como completado
      await supabase.from('download_queue').update({ status: 'completed' }).eq('id', job.id);

      if (io) {
        io.emit('track_completed', {
          title: title,
          artist: artist,
          cover: metadata.staticCover
        });
      }

    } catch (err) {
      console.error(`[Worker Error] Falló descarga de ${job?.search_query || 'desconocido'}:`, err.message);
      await supabase.from('download_queue').update({ 
        status: 'failed', 
        error_message: err.message || 'Error desconocido'
      }).eq('id', job.id);
    }
  }
}

module.exports = { seedInitialQueue, processQueueBatch };
