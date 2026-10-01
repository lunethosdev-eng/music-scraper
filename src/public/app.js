const socket = io();
let currentLyrics = "Selecciona una canción para ver la letra sincronizada.";

// Inicialización de Gráfica
const ctx = document.getElementById('downloadChart').getContext('2d');
const downloadChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
    datasets: [{
      label: 'Canciones Procesadas',
      data: [12, 34, 48, 50, 65, 80],
      borderColor: '#6366f1',
      tension: 0.4
    }]
  }
});

//Sockets
socket.on('queue_update', (data) => {
  const log = document.getElementById('active-queue-log');
  log.innerHTML = `<div>[${new Date().toLocaleTimeString()}] ${data.message}</div>` + log.innerHTML;
});

socket.on('track_completed', (data) => {
  loadTracks();
  const log = document.getElementById('active-queue-log');
  log.innerHTML = `<div style="color: #34d399">[COMPLETADA] ${data.message}</div>` + log.innerHTML;
});

// Navegación por Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(`tab-${tabId}`).classList.add('active');
  event.target.classList.add('active');
}

function switchDoc(docId) {
  document.querySelectorAll('.doc-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.doc-tab-btn').forEach(el => el.classList.remove('active'));
  
  document.getElementById(`doc-${docId}`).classList.add('active');
  event.target.classList.add('active');
}

// Cargar catálogo de canciones
async function loadTracks() {
  const res = await fetch('/api/tracks');
  const tracks = await res.json();
  const tbody = document.getElementById('tracks-list');
  tbody.innerHTML = '';

  tracks.forEach(track => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><img src="${track.static_cover_url}" class="thumb"></td>
      <td><strong>${track.title}</strong></td>
      <td>${track.artist_name}</td>
      <td>${track.album || 'Single'}</td>
      <td>${track.synced_lyrics_lrc ? '✅ Disponible' : '❌ N/A'}</td>
      <td><button class="btn-primary" onclick="playTrack('${track.audio_url}', '${escapeQuotes(track.title)}', '${escapeQuotes(track.artist_name)}', '${track.static_cover_url}', \`${escapeQuotes(track.synced_lyrics_lrc)}\`)">▶ Reproducir</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function playTrack(url, title, artist, cover, lyrics) {
  const player = document.getElementById('audio-player');
  document.getElementById('current-title').innerText = title;
  document.getElementById('current-artist').innerText = artist;
  document.getElementById('current-cover').src = cover;
  currentLyrics = lyrics || "Letra no disponible";
  player.src = url;
  player.play();
}

// Buscador On-Demand (Roku / Web Auto Scraper)
async function handleOnDemandSearch(e) {
  e.preventDefault();
  const query = document.getElementById('search-input').value;
  const resultBox = document.getElementById('search-result-box');
  resultBox.classList.remove('hidden');
  resultBox.innerHTML = '<p>🔍 Verificando backend y encolando descarga...</p>';

  const res = await fetch('/api/search-or-download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const data = await res.json();

  if (data.status === 'available') {
    resultBox.innerHTML = `<p style="color:#10b981">✅ Canción disponible en biblioteca: <strong>${data.track.artist_name} - ${data.track.title}</strong></p>`;
    playTrack(data.track.audio_url, data.track.title, data.track.artist_name, data.track.static_cover_url, data.track.synced_lyrics_lrc);
  } else {
    resultBox.innerHTML = `<p style="color:#f59e0b">⚡ ${data.message}</p>`;
  }
}

function toggleLyricsModal() {
  const modal = document.getElementById('lyrics-modal');
  document.getElementById('lyrics-text').innerText = currentLyrics;
  modal.classList.toggle('hidden');
}

function escapeQuotes(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

loadTracks();
