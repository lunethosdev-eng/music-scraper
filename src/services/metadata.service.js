const axios = require('axios');

async function fetchAppleMusicCovers(artist, title) {
  try {
    const term = encodeURIComponent(`${artist} ${title}`);
    const res = await axios.get(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
    
    if (res.data.results && res.data.results.length > 0) {
      const track = res.data.results[0];
      // Obtener portada de alta resolución 1000x1000
      const staticCover = track.artworkUrl100.replace('100x100bb', '1000x1000bb');
      
      // Buscar el video o animated artwork URL (previsualización de Apple Music)
      let animatedCover = null;
      if (track.previewUrl && track.previewUrl.includes('.m4v')) {
        animatedCover = track.previewUrl;
      }

      return {
        staticCover,
        animatedCover,
        album: track.collectionName,
        durationSec: Math.floor(track.trackTimeMillis / 1000)
      };
    }
  } catch (err) {
    console.warn(`[Apple Music API] Portada no encontrada: ${err.message}`);
  }

  // Fallback genérico
  return {
    staticCover: `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop`,
    animatedCover: null,
    album: 'Single',
    durationSec: 180
  };
}

module.exports = { fetchAppleMusicCovers };
