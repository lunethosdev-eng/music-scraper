const fs = require('fs');
const { supabase } = require('../config/supabase');
const { downloadAudioMP3 } = require('../services/ytdlp.service');
const { fetchAppleMusicCovers } = require('../services/metadata.service');
const { fetchSyncedLyrics } = require('../services/lyrics.service');
const { uploadFileToSupabase } = require('../services/storage.service');

// Artistas populares a escanear automáticamente
const POPULAR_ARTISTS = [
  "Laufey", "Her's", "Grupo Frontera", "Eve", "Bad Bunny", 
  "Taylor Swift", "Feid", "Peso Pluma", "Billie Eilish", "NewJeans"
];

async function seedInitialQueue() {
  console.log('⚡ Poblando cola inicial con artistas populares...');
  for (const artist of POPULAR_ARTISTS) {
    const tracks = ["Popular Track 1", "Hits 2026", "Live Performance"];
    for (const t of tracks) {
      await supabase.from('download_queue').upsert({
        track_title: `${t}`,
        artist_name: artist,
        search_query: `${artist} ${t}`,
        status: 'pending'
      }, { onConflict: 'search_query' });
    }
  }
}

async function processQueueBatch(io) {
  // Obtiene lote pendiente
  const { data: pendingJobs, error } = await supabase
    .from('download_queue')
    .select('*')
    .eq('status', 'pending')
    .limit(10); // Procesamiento concurrente modularizado

  if (error || !pendingJobs || pendingJobs.length === 0) return;

  for (const job of pendingJobs) {
    try {
      // Actualizar estado
      await supabase.from('download_queue').update({ status: 'processing' }).eq('id', job.id);
      
      if (io) io.emit('queue_update', { message: `Descargando: ${job.artist_name} - ${job.track_title}` });

      const safeFilename = `${job.artist_name}_${job.track_title}`.replace(/[^a-zA-Z0-9]/g, '_');

      // 1. Descargar MP3 vía yt-dlp
      const localMp3Path = await downloadAudioMP3(job.search_query, safeFilename);

      // 2. Obtener Metadata & Covers (Apple Music)
      const metadata = await fetchAppleMusicCovers(job.artist_name, job.track_title);

      // 3. Obtener Lyrics LRC Sincronizados
      const lyricsLRC = await fetchSyncedLyrics(job.artist_name, job.track_title);

      // 4. Subir Archivo MP3 a Supabase Storage
      const audioPublicUrl = await uploadFileToSupabase(
        'audio-files', 
        localMp3Path, 
        `${safeFilename}.mp3`, 
        'audio/mpeg'
      );

      // Limpiar archivo temporal local
      if (fs.existsSync(localMp3Path)) fs.unlinkSync(localMp3Path);

      // 5. Guardar Registro Final en la tabla "tracks"
      await supabase.from('tracks').upsert({
        title: job.track_title,
        artist_name: job.artist_name,
        album: metadata.album,
        duration_sec: metadata.durationSec,
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
          title: job.track_title,
          artist: job.artist_name,
          cover: metadata.staticCover
        });
      }

    } catch (err) {
      console.error(`[Worker Error] Falló descarga de ${job.search_query}:`, err.message);
      await supabase.from('download_queue').update({ 
        status: 'failed', 
        error_message: err.message 
      }).eq('id', job.id);
    }
  }
}

module.exports = { seedInitialQueue, processQueueBatch };
