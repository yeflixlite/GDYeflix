/**
 * ============================================================
 *  services/dailymotion.js
 *  Extrae el enlace HLS de Dailymotion mediante su API pública
 * ============================================================
 */

'use strict';

const { fetchWithRetry } = require('../utils/axiosClient');

/**
 * Extrae el ID del video de Dailymotion desde distintos formatos de URL.
 */
function extractId(url) {
  const u = new URL(url);
  // Formatos: /video/x7abc12  /embed/video/x7abc12  dai.ly/x7abc12
  const match = u.pathname.match(/(?:video\/|embed\/video\/|\/)?([a-zA-Z0-9]+)(?:_[^/]*)?$/);
  return match ? match[1] : null;
}

/**
 * @param {string} url
 * @returns {Promise<{videoUrl: string, type: 'm3u8'}>}
 */
async function extract(url) {
  const id = extractId(url);
  if (!id) throw new Error('ID de Dailymotion no encontrado.');

  // API pública gratuita de Dailymotion
  const apiUrl = `https://www.dailymotion.com/player/metadata/video/${id}?embedder=https%3A%2F%2Fwww.dailymotion.com&locale=es&dmV1st=&dmTs=0&is_native_app=0&app=com.dailymotion.neon&client_type=webapp&section_type=player&component_style=_`;

  console.log(`[Dailymotion] Consultando metadata del video: ${id}`);

  const apiRes = await fetchWithRetry(apiUrl, {
    referer: 'https://www.dailymotion.com/',
    origin:  'https://www.dailymotion.com',
    headers: { 'Accept': 'application/json' },
    responseType: 'json',
  });

  if (apiRes.status !== 200) {
    throw new Error(`Dailymotion API respondió con status ${apiRes.status}`);
  }

  const data = apiRes.data;

  // Extrae las calidades disponibles
  const qualities = data?.qualities;
  if (!qualities) throw new Error('Dailymotion no devolvió calidades de video.');

  // Prioridad: auto (m3u8 adaptativo) → 1080 → 720 → 480
  const auto = qualities.auto;
  if (auto && auto.length && auto[0].url) {
    const m3u8 = auto[0].url;
    console.log(`[Dailymotion] ✔ m3u8 adaptativo obtenido`);
    return { videoUrl: m3u8, type: 'm3u8', referer: 'https://www.dailymotion.com' };
  }

  // Fallback: primera calidad disponible
  for (const key of ['1080', '720', '480', '380', '240']) {
    if (qualities[key]?.[0]?.url) {
      const videoUrl = qualities[key][0].url;
      const type     = videoUrl.includes('.m3u8') ? 'm3u8' : 'mp4';
      console.log(`[Dailymotion] ✔ URL en calidad ${key} obtenida`);
      return { videoUrl, type, referer: 'https://www.dailymotion.com' };
    }
  }

  throw new Error('No se encontró ningún enlace de video en la respuesta de Dailymotion.');
}

module.exports = { extract };
