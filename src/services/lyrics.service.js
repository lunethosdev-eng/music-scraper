const axios = require('axios');

async function fetchSyncedLyrics(artist, title) {
  try {
    const res = await axios.get(`https://lrclib.net/api/get`, {
      params: { artist_name: artist, track_name: title }
    });

    if (res.data && res.data.syncedLyrics) {
      return res.data.syncedLyrics;
    }
  } catch (e) {
    console.log(`[Lyrics Service] Sin letras sincronizadas para ${artist} - ${title}`);
  }

  // Fallback de letras formateadas LRC
  return `[00:00.00] ${title} - ${artist}\n[00:05.00] (Letra sincronizada no disponible en servidor)`;
}

module.exports = { fetchSyncedLyrics };
