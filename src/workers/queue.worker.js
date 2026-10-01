const fs = require('fs');
const { supabase } = require('../config/supabase');
const { downloadAudioMP3 } = require('../services/ytdlp.service');
const { fetchAppleMusicCovers } = require('../services/metadata.service');
const { fetchSyncedLyrics } = require('../services/lyrics.service');
const { uploadFileToSupabase } = require('../services/storage.service');

// Canciones y artistas reales de alta popularidad para la semilla inicial
const POPULAR_SEED_TRACKS = [
  { artist: "Laufey", title: "From The Start" },
  { artist: "Grupo Frontera", title: "un x100to" },
  { artist: "Bad Bunny", title: "MONACO" },
  { artist: "Taylor Swift", title: "Cruel Summer" },
  { artist: "Feid", title: "LUNA" },
  { artist: "Peso Pluma", title: "LADY GAGA" },
  { artist: "Billie Eilish", title: "BIRDS OF A FEATHER" },
  { artist: "NewJeans", title: "Super Shy" },
  { artist: "Her's", title: "What Once Was" },
  { artist: "Eve", title: "Kaikai Kitan" }
];

async function seedInitialQueue() {
  console.log('⚡ Poblando cola inicial con canciones reales...');
  for (const track of POPULAR_SEED_TRACKS) {
    const searchQuery = `${track.artist} ${track.title}`;
    await supabase.from('download_queue').upsert({
      track_title: track.title,
      artist_name: track.artist,
      search_query: searchQuery,
      status: 'pending'
    }, { onConflict: 'search_query' });
  }
}

async function processQueueBatch(io) {
  const { data: pendingJobs, error } = await supabase
    .from('download_queue')
    .select('*')
    .eq('status', 'pending')
    .limit(3);

  if (error || !pendingJobs || pendingJobs.length === 0) return;

  for (const job of pendingJobs) {
    try {
      await supabase.from('download_queue').update({ status: 'processing' }).eq('id', job.id);
      
      if (io) io.emit('queue_update', { message: `Descargando: ${job.artist_name} - ${job.track_title}` });

      const safeFilename = `${job.artist_name}_${job.track_title}_${Date.now()}`.replace(/[^a-zA-Z0-9]/g, '_');

      // 1. Descargar MP3 vía yt-dlp
      const localMp3Path = await downloadAudioMP3(job.search_query, safeFilename);

      // 2. Obtener Metadata & Covers (Apple Music API)
      const metadata = await fetchAppleMusicCovers(job.artist_name, job.track_title);

      // 3. Obtener Letras Sincronizadas
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

      // 5. Guardar Registro Final en Supabase DB "tracks"
      const { data: insertedTrack } = await supabase.from('tracks').upsert({
        title: job.track_title,
        artist_name: job.artist_name,
        album: metadata.album,
        duration_sec: metadata.durationSec,
        audio_url: audioPublicUrl,
        static_cover_url: metadata.staticCover,
        animated_cover_url: metadata.animatedCover,
        synced_lyrics_lrc: lyricsLRC,
        source_platform: 'youtube/apple'
      }, { onConflict: 'title,artist_name' }).select().single();

      await supabase.from('download_queue').update({ status: 'completed' }).eq('id', job.id);

      if (io) {
        io.emit('track_completed', {
          track: insertedTrack || { title: job.track_title, artist_name: job.artist_name, static_cover_url: metadata.staticCover },
          message: `Completada: ${job.artist_name} - ${job.track_title}`
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

// BÚSQUEDA Y AUTO-DESCARGA BAJO DEMANDA (Para Roku / Apps Móviles / Web)
async function requestTrackScrape(artist, title, io) {
  const searchQuery = `${artist} ${title}`.trim();

  // 1. Buscar en la tabla 'tracks'
  let queryBuilder = supabase.from('tracks').select('*');
  if (artist) {
    queryBuilder = queryBuilder.ilike('artist_name', `%${artist}%`).ilike('title', `%${title}%`);
  } else {
    queryBuilder = queryBuilder.or(`title.ilike.%${title}%,artist_name.ilike.%${title}%`);
  }
  
  const { data: existingTracks } = await queryBuilder.limit(1);

  if (existingTracks && existingTracks.length > 0) {
    return { status: 'available', source: 'database', track: existingTracks[0] };
  }

  // 2. Si no existe, agregar a la cola
  const { data: queued } = await supabase.from('download_queue').upsert({
    track_title: title || "Unknown Track",
    artist_name: artist || "Unknown Artist",
    search_query: searchQuery,
    status: 'pending'
  }, { onConflict: 'search_query' }).select().single();

  // Activar descarga inmediata
  processQueueBatch(io);

  return { 
    status: 'downloading', 
    source: 'scraper',
    message: 'Canción no encontrada localmente. Se ha enviado al scraper para descarga inmediata.', 
    queueItem: queued 
  };
}

module.exports = { seedInitialQueue, processQueueBatch, requestTrackScrape };
