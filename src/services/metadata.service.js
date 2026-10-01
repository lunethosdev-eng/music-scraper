const axios = require('axios');

async function fetchAppleMusicCovers(artist, title) {
  const safeArtist = artist || '';
  const safeTitle = title || '';

  try {
    const term = encodeURIComponent(`${safeArtist} ${safeTitle}`);
    const res = await axios.get(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`, { timeout: 5000 });
    
    if (res.data && res.data.results && res.data.results.length > 0) {
      const track = res.data.results[0];
      const rawCover = track.artworkUrl100 || track.artworkUrl60 || '';
      
      // Sanitización segura sin romper el hilo
      const staticCover = rawCover
        ? rawCover.replace('100x100bb', '1000x1000bb').replace('60x60bb', '1000x1000bb')
        : 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop';
      
      let animatedCover = null;
      if (track.previewUrl && typeof track.previewUrl === 'string' && track.previewUrl.includes('.m4v')) {
        animatedCover = track.previewUrl;
      }

      return {
        staticCover,
        animatedCover,
        album: track.collectionName || 'Single',
        durationSec: track.trackTimeMillis ? Math.floor(track.trackTimeMillis / 1000) : 180
      };
    }
  } catch (err) {
    console.warn(`[Apple Music API] Portada no encontrada para ${safeArtist} - ${safeTitle}: ${err.message}`);
  }

  // Fallback genérico seguro
  return {
    staticCover: `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop`,
    animatedCover: null,
    album: 'Single',
    durationSec: 180
  };
}

module.exports = { fetchAppleMusicCovers };
