const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

async function downloadAudioMP3(searchQuery, outputFilename) {
  return new Promise((resolve, reject) => {
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    const outputPath = path.join(tmpDir, `${outputFilename}.mp3`);
    const cookiesPath = path.join(process.cwd(), 'cookies.txt');

    // Limpieza de caracteres para ejecución segura de comando
    const cleanQuery = searchQuery.replace(/["'$`]/g, '');

    let cookieFlag = '';
    if (fs.existsSync(cookiesPath)) {
      cookieFlag = `--cookies "${cookiesPath}"`;
    }

    const cmd = `yt-dlp "ytsearch1:${cleanQuery}" --extract-audio --audio-format mp3 --audio-quality 0 ${cookieFlag} -o "${outputPath}" --no-playlist --no-check-certificates`;

    console.log(`[yt-dlp Executing]: ${cmd}`);

    exec(cmd, { timeout: 180000 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[yt-dlp Error]: ${stderr || error.message}`);
        return reject(new Error(`Error en descarga yt-dlp: ${stderr || error.message}`));
      }
      if (!fs.existsSync(outputPath)) {
        return reject(new Error('El archivo MP3 descargado no fue generado en disco.'));
      }
      resolve(outputPath);
    });
  });
}

module.exports = { downloadAudioMP3 };
