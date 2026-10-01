const socket = io();
const ctx = document.getElementById('downloadChart').getContext('2d');

// Gráfica de velocidad
const downloadChart = new Chart(ctx, {
  type: 'line',
  data: {
    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'],
    datasets: [{
      label: 'Canciones Procesadas',
      data: [120, 340, 480, 500, 490, 510],
      borderColor: '#3b82f6',
      tension: 0.4
    }]
  }
});

// Logs en vivo con Socket.IO
socket.on('queue_update', (data) => {
  const log = document.getElementById('active-queue-log');
  log.innerHTML = `<div>[${new Date().toLocaleTimeString()}] ${data.message}</div>` + log.innerHTML;
});

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
      <td>${track.title}</td>
      <td>${track.artist_name}</td>
      <td>${track.album || '-'}</td>
      <td>${track.synced_lyrics_lrc ? 'LRC Sincronizado' : 'N/A'}</td>
      <td><button onclick="playTrack('${track.audio_url}', '${track.title}', '${track.artist_name}', '${track.static_cover_url}')">▶ Reproducir</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function playTrack(url, title, artist, cover) {
  const player = document.getElementById('audio-player');
  document.getElementById('current-title').innerText = title;
  document.getElementById('current-artist').innerText = artist;
  document.getElementById('current-cover').src = cover;
  player.src = url;
  player.play();
}

loadTracks();
