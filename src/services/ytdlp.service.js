const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

async function downloadAudioMP3(searchQuery, outputFilename) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(__dirname, '../../tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const outputPath = path.join(tmpDir, `${outputFilename}.mp3`);
    const cookiesPath = path.join(__dirname, '../../cookies.txt');

    // Comando yt-dlp extrayendo mejor audio y convirtiendo a MP3 a través de FFmpeg
    const cmd = `yt-dlp "ytsearch1:${searchQuery}" --extract-audio --audio-format mp3 --audio-quality 0 --cookies "${cookiesPath}" -o "${outputPath}" --no-playlist`;

    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`[yt-dlp error]: ${stderr}`);
        return reject(error);
      }
      resolve(outputPath);
    });
  });
}

module.exports = { downloadAudioMP3 };
