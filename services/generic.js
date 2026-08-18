/**
 * ============================================================
 *  services/generic.js
 *  Extractor genérico para sitios desconocidos o URLs directas
 * ============================================================
 *
 *  Estrategias en orden de prioridad:
 *  1. Si la URL ya es un .mp4 o .m3u8 → la devuelve directamente
 *  2. Busca <source src="..."> en el HTML
 *  3. Busca patrones JS comunes (file: "...", src: "...")
 *  4. Busca meta og:video
 */

'use strict';

const cheerio            = require('cheerio');
const { fetchWithRetry } = require('../utils/axiosClient');

const DIRECT_EXTENSIONS = /\.(mp4|m3u8|webm|mkv|ts)(\?|$)/i;
const M3U8_RE           = /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi;
const MP4_RE            = /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi;

/**
 * @param {string} url
 * @returns {Promise<{videoUrl: string, type: string}>}
 */
async function extract(url) {
  // ── Estrategia 0: URL directa ────────────────────────────────
  if (DIRECT_EXTENSIONS.test(url)) {
    const type = url.includes('.m3u8') ? 'm3u8' : 'mp4';
    console.log(`[Generic] URL directa detectada: ${type}`);
    return { videoUrl: url, type, referer: '' };
  }

  const origin = (() => {
    try { return new URL(url).origin; } catch { return ''; }
  })();

  console.log(`[Generic] Scraping de página: ${url}`);

  const pageRes = await fetchWithRetry(url, {
    referer: 'https://www.google.com/',
    origin,
  });

  const html = typeof pageRes.data === 'string' ? pageRes.data : '';
  const $    = cheerio.load(html);

  // ── Estrategia 1: <video> / <source> ────────────────────────
  const videoSrc = $('video source, video').attr('src');
  if (videoSrc && videoSrc.startsWith('http')) {
    const type = videoSrc.includes('.m3u8') ? 'm3u8' : 'mp4';
    console.log(`[Generic] ✔ <video src> encontrado`);
    return { videoUrl: videoSrc, type, referer: origin };
  }

  // ── Estrategia 2: og:video meta ──────────────────────────────
  const ogVideo = $('meta[property="og:video:url"], meta[property="og:video"]').attr('content');
  if (ogVideo && ogVideo.startsWith('http')) {
    const type = ogVideo.includes('.m3u8') ? 'm3u8' : 'mp4';
    console.log(`[Generic] ✔ og:video encontrado`);
    return { videoUrl: ogVideo, type, referer: origin };
  }

  // ── Estrategia 3: m3u8 en el HTML ───────────────────────────
  const m3u8Matches = html.match(M3U8_RE);
  if (m3u8Matches && m3u8Matches.length) {
    console.log(`[Generic] ✔ m3u8 encontrado en HTML`);
    return { videoUrl: m3u8Matches[0], type: 'm3u8', referer: origin };
  }

  // ── Estrategia 4: mp4 en el HTML ────────────────────────────
  const mp4Matches = html.match(MP4_RE);
  if (mp4Matches && mp4Matches.length) {
    console.log(`[Generic] ✔ mp4 encontrado en HTML`);
    return { videoUrl: mp4Matches[0], type: 'mp4', referer: origin };
  }

  // ── Estrategia 5: patrones JS file: "..." ───────────────────
  const fileMatch = html.match(/file\s*:\s*["'](https?:\/\/[^"']+)/i);
  if (fileMatch) {
    const videoUrl = fileMatch[1];
    const type     = videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4';
    console.log(`[Generic] ✔ file: encontrado en JS`);
    return { videoUrl, type, referer: origin };
  }

  throw new Error(`No se pudo extraer un enlace de video de: ${url}`);
}

module.exports = { extract };
