/**
 * ============================================================
 *  services/filemoon.js
 *  Extrae el enlace HLS (m3u8) de Filemoon
 * ============================================================
 */

'use strict';

const { fetchWithRetry } = require('../utils/axiosClient');

function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/e\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Filemoon no encontrado en la URL.');
  return `${u.origin}/e/${match[1]}`;
}

async function extract(url) {
  const embedUrl = normalizeUrl(url);
  const origin   = new URL(embedUrl).origin;

  console.log(`[Filemoon] Accediendo a embed: ${embedUrl}`);

  const pageRes = await fetchWithRetry(embedUrl, {
    referer: 'https://www.google.com/',
    origin,
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  const html = pageRes.data;

  // Filemoon usa jwplayer con setup({sources:[{file:"...m3u8"}]})
  let match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
  if (!match) {
    match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
  }

  if (match) {
    console.log(`[Filemoon] ✔ m3u8 encontrado`);
    return { videoUrl: match[1], type: 'm3u8', referer: origin };
  }

  // Fallback mp4
  match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i);
  if (match) {
    console.log(`[Filemoon] ✔ mp4 encontrado`);
    return { videoUrl: match[1], type: 'mp4', referer: origin };
  }

  throw new Error('No se pudo extraer el enlace de Filemoon.');
}

module.exports = { extract };
