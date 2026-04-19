/**
 * ============================================================
 *  services/streamtape.js
 *  Extrae el enlace de descarga real de Streamtape
 * ============================================================
 *
 *  Streamtape ofusca la URL de descarga en el JS de su página embed.
 *  El patrón típico es:
 *    document.getElementById('norobotlink').innerHTML = 
 *      "https://streamtape.com/get_video?id=..." + "token..."
 */

'use strict';

const { fetchWithRetry } = require('../utils/axiosClient');

/**
 * Normaliza la URL al formato embed.
 */
function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(e|v|video)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Streamtape no encontrado en la URL.');
  const id = match[2];
  return `${u.origin}/e/${id}`;
}

/**
 * Extrae el enlace real de Streamtape.
 * @param {string} url
 * @returns {Promise<{videoUrl: string, type: 'mp4'}>}
 */
async function extract(url) {
  const embedUrl = normalizeUrl(url);
  const origin   = new URL(embedUrl).origin;

  console.log(`[Streamtape] Accediendo a embed: ${embedUrl}`);

  const pageRes = await fetchWithRetry(embedUrl, {
    referer: 'https://www.google.com/',
    origin,
  });

  if (pageRes.status !== 200) {
    throw new Error(`Streamtape respondió con status ${pageRes.status}`);
  }

  const html = pageRes.data;

  // ── Patrón 1: concatenación JS clásica ──────────────────────
  // innerHTML = '/get_video?id=abc&expires=...' + '&token=xyz...'
  let match = html.match(
    /innerHTML\s*=\s*["']([^"']+)["']\s*\+\s*["']([^"']+)["']/
  );

  if (match) {
    const rawUrl = (match[1] + match[2]).trim();
    const videoUrl = rawUrl.startsWith('http')
      ? rawUrl
      : `https://streamtape.com${rawUrl}`;
    console.log(`[Streamtape] ✔ URL obtenida (patrón 1)`);
    return { videoUrl, type: 'mp4', referer: origin };
  }

  // ── Patrón 2: robotlink directo ──────────────────────────────
  match = html.match(/id=['"]robotlink['"][^>]*>([^<]+)<\/[a-z]+>/i);
  if (match) {
    const rawUrl = match[1].trim();
    const videoUrl = rawUrl.startsWith('http')
      ? rawUrl
      : `https://streamtape.com${rawUrl}`;
    console.log(`[Streamtape] ✔ URL obtenida (patrón 2)`);
    return { videoUrl, type: 'mp4', referer: origin };
  }

  // ── Patrón 3: get_video en src ───────────────────────────────
  match = html.match(/src:\s*["']([^"']*get_video[^"']+)["']/);
  if (match) {
    const rawUrl = match[1].trim();
    const videoUrl = rawUrl.startsWith('http')
      ? rawUrl
      : `https://streamtape.com${rawUrl}`;
    console.log(`[Streamtape] ✔ URL obtenida (patrón 3)`);
    return { videoUrl, type: 'mp4', referer: origin };
  }

  throw new Error('No se pudo extraer el enlace de Streamtape.');
}

module.exports = { extract };
