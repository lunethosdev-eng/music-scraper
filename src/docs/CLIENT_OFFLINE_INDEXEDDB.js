/**
 * MusicOfflineClient.js
 * Cliente de descarga automática en IndexedDB para reproducción Offline.
 */

class MusicOfflineClient {
  constructor() {
    this.dbName = "MusicOfflineDB";
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("tracks")) {
          db.createObjectStore("tracks", { keyPath: "id" });
        }
      };
      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve();
      };
      request.onerror = (e) => reject(e);
    });
  }

  // Descarga la canción y la guarda como Blob binario dentro de IndexedDB
  async fetchAndCacheTrack(trackMetadata) {
    console.log(`[Offline Cache] Descargando MP3: ${trackMetadata.title}`);
    
    // Fetch del binario MP3
    const audioRes = await fetch(trackMetadata.audio_url);
    const audioBlob = await audioRes.blob();

    // Fetch de la Portada
    const coverRes = await fetch(trackMetadata.static_cover_url);
    const coverBlob = await coverRes.blob();

    const record = {
      id: trackMetadata.id,
      title: trackMetadata.title,
      artist: trackMetadata.artist_name,
      audioBlob: audioBlob,
      coverBlob: coverBlob,
      lyrics: trackMetadata.synced_lyrics_lrc,
      cachedAt: new Date()
    };

    const transaction = this.db.transaction(["tracks"], "readwrite");
    const store = transaction.objectStore("tracks");
    store.put(record);

    console.log(`[Offline Cache] Canción ${trackMetadata.title} guardada exitosamente en IndexedDB.`);
  }

  // Obtiene el Blob local y crea una ObjectURL jugable Offline
  async getOfflineAudioUrl(trackId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(["tracks"], "readonly");
      const store = transaction.objectStore("tracks");
      const request = store.get(trackId);

      request.onsuccess = () => {
        if (request.result) {
          const blobUrl = URL.createObjectURL(request.result.audioBlob);
          const coverUrl = URL.createObjectURL(request.result.coverBlob);
          resolve({
            audioBlobUrl: blobUrl,
            coverBlobUrl: coverUrl,
            lyrics: request.result.lyrics
          });
        } else {
          reject("Canción no encontrada en almacenamiento offline.");
        }
      };
    });
  }
}

// Ejemplo de uso directo en cliente:
/*
  const client = new MusicOfflineClient();
  await client.init();

  // 1. Descarga automática sin mostrar link al usuario
  await client.fetchAndCacheTrack(trackFromApi);

  // 2. Reproducción offline mediante Blob local
  const offlineData = await client.getOfflineAudioUrl(trackFromApi.id);
  
  const audioElement = document.getElementById("audioPlayer");
  audioElement.src = offlineData.audioBlobUrl; // p.ej. blob:http://localhost/38947-a8fd
  audioElement.play();
*/
