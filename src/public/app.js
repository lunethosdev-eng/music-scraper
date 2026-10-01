const socket = io();

// Cambiar de Tab
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(tabId).classList.add('active');
  event.target.classList.add('active');
}

// Cargar Catálogo de Canciones
async function loadTracks() {
  try {
    const res = await fetch('/api/tracks');
    const tracks = await res.json();
    const tbody = document.getElementById('tracks-list');
    tbody.innerHTML = '';

    if (!tracks || tracks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No hay canciones disponibles aún. Usa la barra de búsqueda para descargar.</td></tr>';
      return;
    }

    tracks.forEach(track => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><img src="${track.static_cover_url}" class="thumb"></td>
        <td><strong>${track.title}</strong></td>
        <td>${track.artist_name}</td>
        <td>${track.album || 'Single'}</td>
        <td>${track.synced_lyrics_lrc ? '✅ LRC Sincronizado' : '❌ N/A'}</td>
        <td><button onclick="playTrack('${track.audio_url}', '${escapeQuotes(track.title)}', '${escapeQuotes(track.artist_name)}', '${track.static_cover_url}', '${escapeQuotes(track.synced_lyrics_lrc || '')}')">▶ Reproducir</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando catálogo:', err);
  }
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

function playTrack(url, title, artist, cover, lyrics) {
  document.getElementById('current-title').innerText = title;
  document.getElementById('current-artist').innerText = artist;
  document.getElementById('current-cover').src = cover;
  document.getElementById('lyrics-preview').innerText = lyrics || 'Letra sincronizada no disponible.';

  const player = document.getElementById('audio-player');
  player.src = url;
  player.play();
}

// Búsqueda y Descarga Automática Bajo Demanda
async function handleSearch() {
  const query = document.getElementById('search-input').value.trim();
  const statusBanner = document.getElementById('search-status');

  if (!query) return;

  statusBanner.className = 'status-banner downloading';
  statusBanner.innerText = '🔍 Consultando catálogo / Activando scraper...';
  statusBanner.classList.remove('hidden');

  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.status === 'found') {
      statusBanner.className = 'status-banner found';
      statusBanner.innerText = `✅ Encontrada(s) ${data.tracks.length} canción(es) en el servidor.`;
      loadTracks();
    } else if (data.status === 'downloading' || data.status === 'queued') {
      statusBanner.className = 'status-banner downloading';
      statusBanner.innerText = `⚡ ${data.message}`;
    }
  } catch (err) {
    statusBanner.className = 'status-banner';
    statusBanner.innerText = '❌ Error al comunicarse con el servidor.';
  }
}

// Sockets en tiempo real
socket.on('queue_update', (data) => {
  const log = document.getElementById('active-queue-log');
  log.innerHTML = `<div>[${new Date().toLocaleTimeString()}] ${data.message}</div>` + log.innerHTML;
});

socket.on('track_completed', (data) => {
  loadTracks();
});

// Inicializar gráfica
const ctx = document.getElementById('downloadChart')?.getContext('2d');
if (ctx) {
  new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
      datasets: [{
        label: 'Canciones Procesadas',
        data: [15, 42, 88, 120, 160, 210],
        borderColor: '#3b82f6',
        tension: 0.4
      }]
    }
  });
}

loadTracks();
