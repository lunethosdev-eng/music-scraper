require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const axios = require('axios');

const execPromise = util.promisify(exec);

const app = express();
app.use(cors());
app.use(express.json());

// Variables de entorno de Supabase
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ajbmpgnzkgtcmulocftd.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws }
});

const TEMP_DIR = path.join(__dirname, 'tmp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const COOKIES_PATH = path.join(TEMP_DIR, 'cookies.txt');

// ---------------------------------------------------------------------------
// COOKIES EN CADENA RAW (INCRUSTADAS DIRECTAMENTE)
// ---------------------------------------------------------------------------
const RAW_COOKIES = `__Secure-YNID=22.YT=r58GsOmsXze4lDZQRPWMtlWDwZnr9Ezmf-n08YILW_L6XY57fetYR7PwIs4IZlaivpuWbgoTh1GNM1ganJtOsiDJ6T1McsmO0CHzGMJEEJihApXELnEFUPC9ec1xZFGt9lmU9m0Ga1lKaDyvLS7UIJ-4YJvA2c6Z3D6zZXvZdL22dFyVrV-76Yv3XcLY165ZwkGgQ8oiocGIqXmgr8rIghhWUIW-5M76jaD7RvXvQjX_DMD9O4ZSiDuZqxa5fCsByqJBEYUG_-jqtLYNak_GoJTO1dNqvnB5knpbQYbg-JYZLi2ykEDYtt25oxUXtTUA3oDTQunL4Runo0OorGAVeA;VISITOR_INFO1_LIVE=BxKm35EsG5Q;VISITOR_PRIVACY_METADATA=CgJTVhIEGgAgLw%3D%3D;PREF=f4=4000000&f6=40000000&tz=America.El_Salvador;ST-106zlbk=csn=3Ha7SzOZccoZQSzm&itct=COYFEIf2BBgBIhMI06HLn6mAlwMVYcY_BB17symnWg9GRXdoYXRfdG9fd2F0Y2iaAQUIJBCOHsoBBMclzEo%3D;ST-1svmrcp=csn=3Ha7SzOZccoZQSzm&itct=CIEFELOmCiITCNOhy5-pgJcDFWHGPwQde7Mpp8oBBMclzEo%3D;ST-116m6d6=csn=SDc8GI4Q0Nd59JWd&itct=CLQEENwwIhMI8Ka4pqmAlwMVzTeQBh3rtznKMgpnLWhpZ2gtcmVjWg9GRXdoYXRfdG9fd2F0Y2iaAQYQjh4YngHKAQTHJcxK;ST-hcbf8d=session_logininfo=AFmmF2swRAIgY4enVVEgzzGBr5VdBXzr3SPUzshGuk4YBjYeVSvtSa8CIGawZb10rnFdDL219iFJlepS8MIww2Szc460S7n_q3nj%3AQUQ3MjNmeVgyNDF1ZkpiY2p5NEpjRXB1RUtkTjFBWVRaaVpMRXNwQWpsRm5VSGNpZ1Y4UWJ3Ul9jMF91T2NnMzdIbzU1ZVBfb25zdlJZNDZZMWZra0FPV0R0Si1ZZzdlajJISXVDbHJOU2RFamk1WGhVQlZnVDlvb2Y5OU9TaWt4UXplQjJQdElLVzVaUTNnZzBmN2dkbDRJN0xuTnBKS3pB;CONSISTENCY=AJDB8J-zS4s-iLt4ka5_7BKpLErl6VkMoWKcYUgaksgi00PD0WBz47ToGVLYkPyHKc_kvLhdl3ie2esS50vmPlxdPX2_kt7f4TSOrubnORaHENPnza29e44nD6wisyPJXCX3HJFcegb3J01FM2fmDFCx;NID=CvkBCAESqwEBOxGDSDOxY2wSO_SDLP8_FBJMJW-eOrxcA3EejCbwqW_zZQYGnCsmkWifgVEAWCUELcXsSQp3yZ7FROQAkkv3Wyfek6jUVeQUXPa6wnREbyekTMeQ17aT53Mi3ZCIiqJHgXHMK4LktRO7Xt8Jgc9L3l3UrrTDyvDfpkwIAnp1tLpdc1QZztenYd5DHkjCEKAFm5RhZDrBmrXPiunQK5PKSPYEmKSq0gvkH2EoATJFAdKsB89bLzZgXTUIak0sGfoxDr4CWzX6pffUd8XfDY235VyjSt4wJtTgFYJ_d82aswSS2QHyOc_hvh6XeA9cXkRRlv4P;ST-2us7v6=csn=yZqZsvr_rU-ew3a5&itct=COoDENwwIhMIlsiTy6mAlwMVWuRyCR1UIBBYMgpnLWhpZ2gtcmVjWg9GRXdoYXRfdG9fd2F0Y2iaAQYQjh4YngHKAQTHJcxK;ST-uwicob=session_logininfo=AFmmF2swRAIgY4enVVEgzzGBr5VdBXzr3SPUzshGuk4YBjYeVSvtSa8CIGawZb10rnFdDL219iFJlepS8MIww2Szc460S7n_q3nj%3AQUQ3MjNmeVgyNDF1ZkpiY2p5NEpjRXB1RUtkTjFBWVRaaVpMRXNwQWpsRm5VSGNpZ1Y4UWJ3Ul9jMF91T2NnMzdIbzU1ZVBfb25zdlJZNDZZMWZra0FPV0R0Si1ZZzdlajJISXVDbHJOU2RFamk1WGhVQlZnVDlvb2Y5OU9TaWt4UXplQjJQdElLVzVaUTNnZzBmN2dkbDRJN0xuTnBKS3pB;ST-wfba0p=csn=q8gmqDSic-E0dSqR&itct=COMBEKSBBBgCIhMIhdar866AlwMVq-vjBx0PVSWiygEExyXMSg%3D%3D&endpoint=%7B%22clickTrackingParams%22%3A%22COMBEKSBBBgCIhMIhdar866AlwMVq-vjBx0PVSWiygEExyXMSg%3D%3D%22%2C%22commandMetadata%22%3A%7B%22webCommandMetadata%22%3A%7B%22url%22%3A%22%2Flogout%22%2C%22webPageType%22%3A%22WEB_PAGE_TYPE_UNKNOWN%22%2C%22rootVe%22%3A83769%7D%7D%2C%22signOutEndpoint%22%3A%7B%22hack%22%3Atrue%7D%7D&session_logininfo=AFmmF2swRAIgY4enVVEgzzGBr5VdBXzr3SPUzshGuk4YBjYeVSvtSa8CIGawZb10rnFdDL219iFJlepS8MIww2Szc460S7n_q3nj%3AQUQ3MjNmeVgyNDF1ZkpiY2p5NEpjRXB1RUtkTjFBWVRaaVpMRXNwQWpsRm5VSGNpZ1Y4UWJ3Ul9jMF91T2NnMzdIbzU1ZVBfb25zdlJZNDZZMWZra0FPV0R0Si1ZZzdlajJISXVDbHJOU2RFamk1WGhVQlZnVDlvb2Y5OU9TaWt4UXplQjJQdElLVzVaUTNnZzBmN2dkbDRJN0xuTnBKS3pB;GPS=1;ST-1s651f4=gs_l=youtube.3..0i512i433k1l3j0i512k1j0i512i433k1j0i512i433i131k1j0i512k1j0i512i433k1l2j0i512k1j0i512i433k1j0i512i433i47k1j0i512i433k1j0i512i433i131i650k1...0.6368......0.496.980.4-2..........4.......0..0i512i47k1.1387&oq=hola&itct=CA0Q7VAiEwj755DNwpSXAxVGS0IHHc1SKS3KAQR_xoX1&csn=M_sBIuIzkcp9_nbA&endpoint=%7B%22clickTrackingParams%22%3A%22CA0Q7VAiEwj755DNwpSXAxVGS0IHHc1SKS3KAQR_xoX1%22%2C%22commandMetadata%22%3A%7B%22webCommandMetadata%22%3A%7B%22url%22%3A%22%2Fresults%3Fsearch_query%3Dhola%22%2C%22webPageType%22%3A%22WEB_PAGE_TYPE_SEARCH%22%2C%22rootVe%22%3A4724%7D%7D%2C%22searchEndpoint%22%3A%7B%22query%22%3A%22hola%22%7D%7D;__Secure-1PSIDTS=sidts-CjUBkldj_5TZzF50217bHP8Z-655IzP7GyaXvMFYc93plFBWe92f1SUSjN55whL9qxYFB5rUhBAA;__Secure-3PSIDTS=sidts-CjUBkldj_5TZzF50217bHP8Z-655IzP7GyaXvMFYc93plFBWe92f1SUSjN55whL9qxYFB5rUhBAA;HSID=At_WAouxvVpP4Fezm;SSID=AxmwmoUn_nsVV3X1H;APISID=F8ojrPMfi80w8WqL/AX_qsUp36PRdoSKNM;SAPISID=ky4PfLYVtvpVYpFT/A9gHxWcsL2ikTA8ar;__Secure-1PAPISID=ky4PfLYVtvpVYpFT/A9gHxWcsL2ikTA8ar;__Secure-3PAPISID=ky4PfLYVtvpVYpFT/A9gHxWcsL2ikTA8ar;SID=g.a000DAl90ILP5Hj_KJeNM55NRJZmH3hfMxlW3ISjVNcyMqQ_8b4JYVsvX1pxseJPSynRerH3FAACgYKAcgSARESFQHGX2MinSB3JoXZbJnJP16d0XXFABoVAUF8yKqJTeFfIrA57MeSJHl3NVrJ0076;__Secure-1PSID=g.a000DAl90ILP5Hj_KJeNM55NRJZmH3hfMxlW3ISjVNcyMqQ_8b4JVV4bKhxqW9qIJyC0mvx-3wACgYKAQcSARESFQHGX2MihS6zzGBUtA3aH-trL1HefxoVAUF8yKqNXRix-fhBPV_9zNME_jRh0076;__Secure-3PSID=g.a000DAl90ILP5Hj_KJeNM55NRJZmH3hfMxlW3ISjVNcyMqQ_8b4JYSd5j4ZmVs0pIkg_3FBkIAACgYKAdoSARESFQHGX2Mik0fgvXZnRXYeb0EGB7c-KxoVAUF8yKqStMSWiWzpUz-6RbFpVKyV0076;LOGIN_INFO=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo:QUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB;SIDCC=AKEyXzWLNj6nzYT5tBxhT5c5voKz5nXvBe-tum4IMj0Q3M9fawmjOHJvRFtdEOXxMCZFv5be;__Secure-1PSIDCC=AKEyXzXVj3xd91mOqekCJDHctHnMjvdIR6oQiHm_jLCw5aJVQaZWYzEavrmEzF9Ds4AmHIbRJg;__Secure-3PSIDCC=AKEyXzXJQwZMBbkRNSS44qBgn2A-z2TzA-vvA6LQEKxcVpQ8bQh8AC8DBku5o_CleNCAcSg_YA;ST-l3hjtt=session_logininfo=AFmmF2swRAIgYfhgfDrXLAJIGxdR_xmurautk3nM-2kiooGd7rIXEBsCICdjGTxLjluIlA_Kper6Gqkud6OWBUB6bU2zMrzOoTNm%3AQUQ3MjNmd09keEpjS0NOaFJWY2RpZkpBbHplSGVVSTIyUkpwVEZlM0E1OTlZeHlVUUZKaTBpNWpMX21lY2JPUVIxVnZta2RnaTMxd2VwUFdzb1ZsU1NETS1YTUtSVHVmV09LRTdMWWg3ZWVOT3o2Z21QSlJKZEpRczdUMjFULUMxQmRVUEx2U3E3V1lYcXE5OFpoMmI5MDNONnpNd2llTWN3;ST-1mzmz3u=csn=vP2Vb1-xAnn0Zhph&itct=CIIFELOmCiITCPOxmO7ClJcDFewVTwgdQ0cIIcoBBMclzEo%3D;ST-1baidrg=csn=vP2Vb1-xAnn0Zhph&itct=CNUBENwwIhMI87GY7sKUlwMV7BVPCB1DRwghMgpnLWhpZ2gtcmVjWg9GRXdoYXRfdG9fd2F0Y2iaAQYQjh4YngHKAQTHJcxK;ST-v6xsf6=csn=vP2Vb1-xAnn0Zhph&itct=CKoDEIf2BBgBIhMI87GY7sKUlwMV7BVPCB1DRwghWg9GRXdoYXRfdG9fd2F0Y2iaAQUIJBCOHsoBBMclzEo%3D;ST-pi9i8c=session_logininfo=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo%3AQUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB;__Secure-BUCKET=CGE;YSC=iptGQkPdKvM;ST-3m3ncp=session_logininfo=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo%3AQUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB;ST-1b=disableCache=true&session_logininfo=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo%3AQUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB&endpoint=%7B%22browseEndpoint%22%3A%7B%22browseId%22%3AFEwhat_to_watch%22%7D%2C%22commandMetadata%22%3A%7B%22webCommandMetadata%22%3A%7B%22url%22%3A%22%2F%22%2C%22rootVe%22%3A3854%2C%22webPageType%22%3A%22WEB_PAGE_TYPE_BROWSE%22%7D%7D%7D;ST-yve142=session_logininfo=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo%3AQUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB;ST-3opvp5=session_logininfo=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo%3AQUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB;ST-tladcw=session_logininfo=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo%3AQUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB;ST-xuwub9=session_logininfo=AFmmF2swRgIhANrIfaa9aqsg8M5zRzDkbHnqL3HVUWSz_SbqcE-VSuptAiEA0_yg9igHlb85ujBCdnAx-hOu7-byiaa7PTWVdNTulbo%3AQUQ3MjNmd0RneDRjcG5XYllwTUw2Wnk5U0FaSzd5UWlBSzhFa252eDNuNnlNbFZKRm1KaXo3YkFkszVjNFJEWFJleERyYnFPVXRyTXlwZUM3eV9GM3EzTGtVQzh3ZjJBTU4taGREaDJhOW9tazFNSDNLUV94ZGJIYU9XRjJGQkZlcUxaN0EydnRTcERBYmhaUjhYOGlEUnF6aE9YUUhTZFpB`;

function generateNetscapeCookieFile(rawCookies, outputPath) {
  const fileHeader = "# Netscape HTTP Cookie File\n# http://curl.haxx.se/rfc/cookie_spec.html\n\n";
  const entries = rawCookies.split(';').map(cookiePair => {
    const trimmed = cookiePair.trim();
    if (!trimmed) return null;
    const separatorIdx = trimmed.indexOf('=');
    if (separatorIdx === -1) return null;

    const name = trimmed.substring(0, separatorIdx);
    const value = trimmed.substring(separatorIdx + 1);
    const isSecure = name.startsWith('__Secure-') ? 'TRUE' : 'FALSE';
    return `.youtube.com\tTRUE\t/\t${isSecure}\t2147483647\t${name}\t${value}`;
  }).filter(Boolean);

  fs.writeFileSync(outputPath, fileHeader + entries.join('\n'), 'utf8');
}

function getCookieFlag() {
  try {
    generateNetscapeCookieFile(RAW_COOKIES, COOKIES_PATH);
    return `--cookies "${COOKIES_PATH}"`;
  } catch (err) {
    console.error('Error al generar cookies:', err.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// COLA DE DESCARGAS
// ---------------------------------------------------------------------------
let downloadQueue = [];
let isProcessingQueue = false;

const INITIAL_SEED_ARTISTS = [
  "Laufey - From The Start",
  "Laufey - Valentine",
  "Hers - What Once Was",
  "Grupo Frontera - un X100to",
  "Eve - Kaikai Kitan",
  "Coqueta - Grupo Frontera"
];

function addToQueue(query) {
  const existing = downloadQueue.find(item => item.query.toLowerCase() === query.toLowerCase());
  if (existing) return existing;

  const newItem = {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 5),
    query,
    status: 'pending',
    progressMessage: 'En espera',
    addedAt: new Date()
  };
  downloadQueue.push(newItem);
  processQueue();
  return newItem;
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (true) {
    const item = downloadQueue.find(i => i.status === 'pending');
    if (!item) break;

    item.status = 'downloading';
    item.progressMessage = 'Descargando audio y metadatos...';

    try {
      await autoScrapeAndSave(item.query);
      item.status = 'completed';
      item.progressMessage = '¡Completado con éxito!';
    } catch (err) {
      console.error(`Error procesando "${item.query}":`, err.message);
      item.status = 'failed';
      item.progressMessage = `Error: ${err.message}`;
    }
  }

  isProcessingQueue = false;
}

// ---------------------------------------------------------------------------
// OBTENCIÓN DE METADATOS Y COVERS ANIMADOS DE APPLE MUSIC
// ---------------------------------------------------------------------------
async function fetchAppleMusicData(term) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=1`;
    const response = await axios.get(url, { timeout: 5000 });
    if (response.data.results && response.data.results.length > 0) {
      const track = response.data.results[0];
      const highResCover = track.artworkUrl100 ? track.artworkUrl100.replace('100x100bb', '1000x1000bb') : null;
      
      // Si Apple Music provee video preview lo tomamos como cover animado (MP4/M4V)
      const animatedCover = track.previewUrl || null;

      return {
        coverUrl: highResCover,
        animatedCoverUrl: animatedCover,
        album: track.collectionName,
        artist: track.artistName,
        title: track.trackName
      };
    }
  } catch (err) {
    console.error('Apple Music API fallback:', err.message);
  }
  return { coverUrl: null, animatedCoverUrl: null, album: null, artist: null, title: null };
}

function parseLrc(lrcText) {
  if (!lrcText) return [];
  const lines = lrcText.split('\n');
  const result = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = parseInt(match[3].padEnd(3, '0'), 10);
      const timeInSeconds = min * 60 + sec + ms / 1000;
      const text = line.replace(timeRegex, '').trim();
      if (text) result.push({ time: timeInSeconds, text });
    }
  }
  return result;
}

async function fetchSyncedLyrics(artist, title) {
  try {
    const response = await axios.get('https://lrclib.net/api/get', {
      params: { artist_name: artist, track_name: title },
      timeout: 4000
    });
    if (response.data && response.data.syncedLyrics) {
      return parseLrc(response.data.syncedLyrics);
    }
  } catch (err) {
    try {
      const searchRes = await axios.get('https://lrclib.net/api/search', {
        params: { q: `${artist} ${title}` },
        timeout: 4000
      });
      if (searchRes.data && searchRes.data.length > 0 && searchRes.data[0].syncedLyrics) {
        return parseLrc(searchRes.data[0].syncedLyrics);
      }
    } catch (e) {}
  }
  return [];
}

// ---------------------------------------------------------------------------
// EXTRACCIÓN Y DESCARGA CON YT-DLP ROBUTIZADA
// ---------------------------------------------------------------------------
async function autoScrapeAndSave(searchQuery) {
  const trackId = Date.now().toString();
  const outputPath = path.join(TEMP_DIR, `${trackId}.mp3`);
  const cookieFlag = getCookieFlag();
  const userAgent = '"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"';

  try {
    // 1. Obtener metadatos mediante JSON para evitar bloqueos por salida multilinea
    let ytTitle = searchQuery;
    let ytThumbnail = null;

    try {
      const metaCmd = `yt-dlp "ytsearch1:${searchQuery.replace(/"/g, '')}" ${cookieFlag} --user-agent ${userAgent} --dump-json --no-playlist --no-check-certificates`;
      const { stdout: metaJson } = await execPromise(metaCmd);
      const parsedMeta = JSON.parse(metaJson);
      ytTitle = parsedMeta.title || searchQuery;
      ytThumbnail = parsedMeta.thumbnail || null;
    } catch (metaErr) {
      console.warn('Metadatos directos de YouTube fallaron, procediendo a descarga directa:', metaErr.message);
    }

    // 2. Descarga del audio y conversión limpia a MP3 mediante FFmpeg
    const downloadCmd = `yt-dlp "ytsearch1:${searchQuery.replace(/"/g, '')}" ${cookieFlag} --user-agent ${userAgent} --js-runtimes node --no-playlist --no-check-certificates -x --audio-format mp3 --audio-quality 0 -o "${outputPath}"`;
    await execPromise(downloadCmd);

    if (!fs.existsSync(outputPath)) {
      throw new Error('yt-dlp finalizó pero no generó el archivo de audio MP3.');
    }

    // 3. Obtener metadatos enriquecidos de Apple Music
    const appleData = await fetchAppleMusicData(searchQuery);
    const finalTitle = appleData.title || ytTitle.split('-')[1]?.trim() || ytTitle;
    const finalArtist = appleData.artist || ytTitle.split('-')[0]?.trim() || 'Artista';
    const finalCover = appleData.coverUrl || ytThumbnail;
    const finalAnimatedCover = appleData.animatedCoverUrl || null;

    // 4. Obtener letras sincronizadas
    const lyrics = await fetchSyncedLyrics(finalArtist, finalTitle);

    // 5. Subida a Supabase Storage
    const fileBuffer = fs.readFileSync(outputPath);
    const audioStoragePath = `tracks/${trackId}_${finalArtist.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;

    const { error: uploadErr } = await supabase.storage
      .from('audio-files')
      .upload(audioStoragePath, fileBuffer, { contentType: 'audio/mpeg', upsert: true });

    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (uploadErr) throw uploadErr;

    // 6. Registro en base de datos Supabase
    const { data: dbTrack, error: dbErr } = await supabase
      .from('tracks')
      .insert([{
        title: finalTitle,
        artist: finalArtist,
        album: appleData.album || 'Single',
        audio_path: audioStoragePath,
        cover_url: finalCover,
        animated_cover_url: finalAnimatedCover,
        lyrics: lyrics,
        source_platform: 'auto-scraped'
      }])
      .select()
      .single();

    if (dbErr) throw dbErr;
    return dbTrack;
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ENDPOINTS DE LA API
// ---------------------------------------------------------------------------

app.get('/api/ping', (req, res) => res.send('PONG'));

app.get('/api/queue', (req, res) => {
  res.json(downloadQueue.slice(-15).reverse());
});

app.get('/api/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Parámetro de búsqueda "q" requerido' });

  try {
    const { data: existingTracks } = await supabase
      .from('tracks')
      .select('*')
      .or(`title.ilike.%${q}%,artist.ilike.%${q}%`);

    if (existingTracks && existingTracks.length > 0) {
      return res.json({ status: 'found', source: 'database', tracks: existingTracks });
    }

    const queueItem = addToQueue(q);
    return res.json({
      status: 'queued',
      message: `"${q}" se agregó a la cola de descargas automáticas.`,
      queueItem
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tracks', async (req, res) => {
  const { data, error } = await supabase
    .from('tracks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  
  // Mapear con URLs públicas de audio completas para clientes externos
  const tracksWithUrls = data.map(track => ({
    ...track,
    audio_stream_url: `${req.protocol}://${req.get('host')}/api/tracks/${track.id}/stream`
  }));

  res.json(tracksWithUrls);
});

app.get('/api/tracks/:id/stream', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: track, error: dbError } = await supabase
      .from('tracks')
      .select('audio_path')
      .eq('id', id)
      .single();

    if (dbError || !track) return res.status(404).json({ error: 'Canción no encontrada' });

    const { data: fileBlob, error: downloadErr } = await supabase.storage
      .from('audio-files')
      .download(track.audio_path);

    if (downloadErr) throw downloadErr;

    const arrayBuffer = await fileBlob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------------------------------------------------------------------------
// DASHBOARD WEB CON APOYO DE PLAYER Y COVERS ANIMADOS
// ---------------------------------------------------------------------------
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Music Server - Dashboard</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; padding-bottom: 120px; }
        header { background: #161e2e; padding: 1.25rem 2rem; border-bottom: 1px solid #1e293b; display: flex; justify-content: space-between; align-items: center; }
        h1 { font-size: 1.3rem; color: #38bdf8; }
        .container { max-width: 1100px; margin: 2rem auto; padding: 0 1rem; display: grid; grid-template-columns: 2fr 1fr; gap: 2rem; }
        @media (max-width: 768px) { .container { grid-template-columns: 1fr; } }
        .search-box { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; }
        input[type="text"] { flex: 1; padding: 0.85rem; background: #1e293b; border: 1px solid #334155; border-radius: 8px; color: #fff; font-size: 0.95rem; outline: none; }
        button { background: #0284c7; color: white; border: none; padding: 0.85rem 1.25rem; border-radius: 8px; font-weight: 600; cursor: pointer; }
        .catalog-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; }
        .track-card { background: #1e293b; border: 1px solid #334155; border-radius: 10px; overflow: hidden; cursor: pointer; }
        .cover-img { width: 100%; aspect-ratio: 1; object-fit: cover; background: #0f172a; }
        .track-info { padding: 0.75rem; }
        .queue-panel { background: #161e2e; border: 1px solid #1e293b; border-radius: 12px; padding: 1.25rem; }
        .queue-item { background: #1e293b; padding: 0.75rem; border-radius: 8px; margin-bottom: 0.75rem; border-left: 4px solid #64748b; font-size: 0.85rem; }
        .queue-item.pending { border-color: #f59e0b; }
        .queue-item.downloading { border-color: #3b82f6; animation: pulse 1.5s infinite; }
        .queue-item.completed { border-color: #10b981; }
        .queue-item.failed { border-color: #ef4444; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .player-bar { position: fixed; bottom: 0; left: 0; right: 0; background: #161e2e; border-top: 1px solid #1e293b; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; }
        .player-left { display: flex; align-items: center; gap: 1rem; }
        .player-cover { width: 50px; height: 50px; border-radius: 6px; object-fit: cover; }
        audio { flex: 1; max-width: 450px; height: 36px; }
      </style>
    </head>
    <body>
      <header>
        <h1>🎵 Music Scraper & Server</h1>
        <span style="font-size: 0.85rem; color: #34d399;">● Servidor Activo</span>
      </header>
      <div class="container">
        <div>
          <div class="search-box">
            <input type="text" id="searchInput" placeholder="Buscar canción..." />
            <button onclick="handleSearch()">Buscar / Descargar</button>
          </div>
          <h2 style="margin-bottom: 1rem; font-size: 1.1rem; color: #94a3b8;">Catálogo</h2>
          <div id="catalogGrid" class="catalog-grid"></div>
        </div>
        <div class="queue-panel">
          <h3>⚡ Cola de Descargas <span id="queueCount">(0)</span></h3>
          <div id="queueList">Cargando...</div>
        </div>
      </div>
      <div class="player-bar">
        <div class="player-left">
          <img id="playerCover" class="player-cover" src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" />
          <div>
            <h4 id="playerTitle">Selecciona una canción</h4>
            <p id="playerArtist" style="font-size: 0.75rem; color: #94a3b8;">-</p>
          </div>
        </div>
        <audio id="audioPlayer" controls></audio>
      </div>
      <script>
        async function loadCatalog() {
          const res = await fetch('/api/tracks');
          const tracks = await res.json();
          const grid = document.getElementById('catalogGrid');
          grid.innerHTML = '';
          tracks.forEach(track => {
            const card = document.createElement('div');
            card.className = 'track-card';
            card.onclick = () => playTrack(track);
            card.innerHTML = \`
              <img class="cover-img" src="\${track.cover_url || 'https://via.placeholder.com/300'}" />
              <div class="track-info">
                <div style="font-weight: 600; font-size: 0.9rem;">\${track.title}</div>
                <div style="font-size: 0.78rem; color: #94a3b8;">\${track.artist}</div>
              </div>
            \`;
            grid.appendChild(card);
          });
        }
        async function loadQueue() {
          const res = await fetch('/api/queue');
          const items = await res.json();
          const list = document.getElementById('queueList');
          document.getElementById('queueCount').innerText = \`(\${items.length})\`;
          if (items.length === 0) { list.innerHTML = '<p style="font-size:0.8rem;">Sin descargas activas.</p>'; return; }
          list.innerHTML = '';
          items.forEach(item => {
            const div = document.createElement('div');
            div.className = \`queue-item \${item.status}\`;
            div.innerHTML = \`<div style="font-weight:600;">\${item.query}</div><div style="font-size:0.75rem; color:#94a3b8;">\${item.progressMessage}</div>\`;
            list.appendChild(div);
          });
        }
        async function handleSearch() {
          const query = document.getElementById('searchInput').value.trim();
          if (!query) return;
          const res = await fetch(\`/api/search?q=\${encodeURIComponent(query)}\`);
          const data = await res.json();
          if (data.status === 'found') playTrack(data.tracks[0]);
          loadQueue();
        }
        function playTrack(track) {
          document.getElementById('playerCover').src = track.cover_url || '';
          document.getElementById('playerTitle').innerText = track.title;
          document.getElementById('playerArtist').innerText = track.artist;
          const audio = document.getElementById('audioPlayer');
          audio.src = track.audio_stream_url || \`/api/tracks/\${track.id}/stream\`;
          audio.play();
        }
        loadCatalog(); loadQueue();
        setInterval(loadQueue, 3000);
        setInterval(loadCatalog, 10000);
      </script>
    </body>
    </html>
  `);
});

async function seedInitialQueue() {
  for (const song of INITIAL_SEED_ARTISTS) {
    addToQueue(song);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor de música activo en puerto ${PORT}`);
  setTimeout(seedInitialQueue, 3000);
  setInterval(() => { axios.get(`http://localhost:${PORT}/api/ping`).catch(() => {}); }, 10 * 60 * 1000);
});
