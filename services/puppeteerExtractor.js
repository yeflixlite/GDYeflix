/**
 * ============================================================
 *  services/puppeteerExtractor.js
 *  Extrae el enlace m3u8 interceptando las peticiones de red
 *  de un navegador headless real (Puppeteer).
 * ============================================================
 */

'use strict';

const puppeteer = require('puppeteer');

/**
 * Extensiones que identifican un stream de video
 */
const VIDEO_PATTERNS = [
  /\.m3u8(\?|$)/i,
  /master\.txt(\?|#|$)/i,
  /playlist\.txt(\?|#|$)/i,
  /\/hls\//i,
  /\.mp4(\?|$)/i,
];

function isVideoUrl(url) {
  return VIDEO_PATTERNS.some(p => p.test(url));
}

/**
 * Lanza Puppeteer y monitorea las peticiones de red.
 * Devuelve el primer enlace de video detectado.
 */
async function extractWithPuppeteer(embedUrl, timeoutMs = 25_000) {
  console.log(`[Puppeteer] 🚀 Iniciando navegador headless...`);

  const browser = await puppeteer.launch({
    headless: 'new', // Usa el nuevo modo headless
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--ignore-certificate-errors',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();

    // Simula Chrome real
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36'
    );

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8',
      'Referer':         'https://www.google.com/',
    });

    // ── Intercepta todas las peticiones de red ───────────────
    const foundUrls = [];
    await page.setRequestInterception(true);

    page.on('request', (req) => {
      const url = req.url();
      if (isVideoUrl(url)) {
        console.log(`[Puppeteer] 📡 Interceptada petición: ${url.substring(0, 100)}`);
        foundUrls.push(url);
      }
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font'].includes(type)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // También captura respuestas
    page.on('response', (resp) => {
      const url = resp.url();
      const ct  = resp.headers()['content-type'] || '';
      if (ct.includes('mpegurl') || ct.includes('m3u8') || isVideoUrl(url)) {
        if (!foundUrls.includes(url)) {
          console.log(`[Puppeteer] 📡 Interceptada respuesta: ${url.substring(0, 100)}`);
          foundUrls.push(url);
        }
      }
    });

    console.log(`[Puppeteer] 🌐 Cargando: ${embedUrl}`);
    await page.goto(embedUrl, {
      waitUntil: 'networkidle2', // Espera a que la red esté tranquila
      timeout   : timeoutMs,
    });

    // Espera hasta que se encuentre una URL o timeout
    const found = await new Promise((resolve) => {
      const check = setInterval(() => {
        if (foundUrls.length > 0) {
          clearInterval(check);
          resolve(foundUrls[0]);
        }
      }, 500);

      setTimeout(() => {
        clearInterval(check);
        resolve(foundUrls[0] || null);
      }, timeoutMs);
    });

    if (!found) {
      throw new Error('Puppeteer no detectó ningún enlace de video.');
    }

    console.log(`[Puppeteer] ✅ Enlace encontrado: ${found.substring(0, 100)}`);
    return found;

  } finally {
    await browser.close();
    console.log(`[Puppeteer] 🔒 Navegador cerrado.`);
  }
}

/**
 * Interfaz pública: extract(url) → { videoUrl, type, referer }
 */
async function extract(url) {
  const origin   = (() => { try { return new URL(url).origin; } catch { return ''; } })();
  const videoUrl = await extractWithPuppeteer(url);

  const type = (
    /\.m3u8/i.test(videoUrl) ||
    /master\.txt/i.test(videoUrl) ||
    /playlist\.txt/i.test(videoUrl) ||
    /\/hls\//i.test(videoUrl)
  ) ? 'm3u8' : 'mp4';

  return { videoUrl, type, referer: origin };
}

module.exports = { extract };
