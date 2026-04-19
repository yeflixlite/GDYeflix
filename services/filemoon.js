/**
 * ============================================================
 *  services/filemoon.js
 *  Extrae el enlace HLS (m3u8) de Filemoon (y sus mirrors como bysejikuar)
 *  Soporta tanto el patrón antiguo (JS) como el nuevo (API AES-GCM)
 * ============================================================
 */

'use strict';

const axios                = require('axios');
const crypto               = require('crypto');
const { fetchWithRetry }   = require('../utils/axiosClient');
const { getBrowserHeaders } = require('../utils/browserHeaders');

/**
 * Normaliza la URL al formato /e/<id>
 */
function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/e\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Filemoon no encontrado en la URL.');
  return { 
    embedUrl: `${u.origin}/e/${match[1]}`,
    id: match[1],
    origin: u.origin,
    hostname: u.hostname 
  };
}

/**
 * Helper para decodificar Base64 URL-safe a Buffer
 */
function base64UrlToBuffer(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64');
}

/**
 * Desencripta el payload AES-256-GCM de Filemoon
 */
function decryptPlayback(data) {
  try {
    const { iv, payload, key_parts } = data;
    if (!iv || !payload || !key_parts) return null;

    const key = Buffer.concat(key_parts.map(base64UrlToBuffer));
    const ivBuf = base64UrlToBuffer(iv);
    const payloadBuf = base64UrlToBuffer(payload);

    const tagLength = 16;
    const ciphertext = payloadBuf.slice(0, payloadBuf.length - tagLength);
    const tag = payloadBuf.slice(payloadBuf.length - tagLength);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[Filemoon] Fallo en decodificación AES:', error.message);
    return null;
  }
}

/**
 * Estrategia Nueva: Intenta obtener el enlace vía API /playback (AES-GCM)
 */
async function extractViaApi(id, origin) {
  const apiUrl = `${origin}/api/videos/${id}/playback`;
  console.log(`[Filemoon] Intentando API: ${apiUrl}`);

  try {
    const res = await axios.post(apiUrl, {}, {
      headers: {
        ...getBrowserHeaders(`${origin}/e/${id}`, origin),
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/plain, */*',
      },
      timeout: 10000
    });

    if (res.data && res.data.playback) {
      const decrypted = decryptPlayback(res.data.playback);
      if (decrypted && decrypted.sources && decrypted.sources.length > 0) {
        const videoUrl = decrypted.sources[0].url;
        console.log(`[Filemoon] ✔ Enlace encontrado vía API Decryption`);
        return { videoUrl, type: 'm3u8' };
      }
    }
  } catch (err) {
    console.warn(`[Filemoon] Fallo en API Playback: ${err.message}`);
  }
  return null;
}

/**
 * Estrategia Antigua: Scrapea el HTML buscando file: "..."
 */
async function extractViaHtml(embedUrl, origin) {
  console.log(`[Filemoon] Intentando Scraping HTML: ${embedUrl}`);
  
  const pageRes = await fetchWithRetry(embedUrl, {
    referer: 'https://www.google.com/',
    origin,
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  const html = pageRes.data;

  // Busca .m3u8
  let match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
  if (!match) match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);

  if (match) {
    console.log(`[Filemoon] ✔ m3u8 encontrado vía HTML`);
    return { videoUrl: match[1], type: 'm3u8' };
  }

  // Fallback mp4
  match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i);
  if (match) {
    console.log(`[Filemoon] ✔ mp4 encontrado vía HTML`);
    return { videoUrl: match[1], type: 'mp4' };
  }

  return null;
}

/**
 * Extractor Principal
 */
async function extract(url) {
  const { embedUrl, id, origin } = normalizeUrl(url);

  // 1. Intenta la nueva API (Más común en mirrors modernos como bysejikuar)
  const apiResult = await extractViaApi(id, origin);
  if (apiResult) return { ...apiResult, referer: origin };

  // 2. Fallback al scraping tradicional
  const htmlResult = await extractViaHtml(embedUrl, origin);
  if (htmlResult) return { ...htmlResult, referer: origin };

  throw new Error('No se pudo extraer el enlace de Filemoon (ambas estrategias fallaron).');
}

module.exports = { extract };
