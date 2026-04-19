/**
 * ============================================================
 *  controllers/proxyController.js
 *  Sirve el contenido del video evitando CORS.
 *  Soporta:
 *    - Peticiones normales (MP4 completo)
 *    - Range requests (adelantar/retroceder en MP4)
 *    - Archivos M3U8 con reescritura de segmentos TS
 *    - Archivos .txt que son playlists HLS (forceM3u8=1)
 * ============================================================
 */

'use strict';

const axios               = require('axios');
const { getMediaHeaders } = require('../utils/browserHeaders');

/**
 * Resuelve una URL relativa a absoluta basándose en la URL original.
 */
function resolveUrl(target, base) {
  if (target.startsWith('http')) return target;
  
  const baseUrl = new URL(base);
  if (target.startsWith('//')) {
    return `${baseUrl.protocol}${target}`;
  }
  
  if (target.startsWith('/')) {
    return `${baseUrl.origin}${target}`;
  }
  
  // Relativa al directorio
  const dirPath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
  return `${baseUrl.origin}${dirPath}${target}`;
}

/**
 * Reescribe un M3U8 para que todos los segmentos pasen
 * también por el proxy local.
 */
function rewriteM3u8(content, originalUrl, proxyBase, referer) {
  const encodedReferer = encodeURIComponent(referer || '');
  
  // 1. Reemplaza URLs en líneas que no empiezan por #
  let rewritten = content.replace(
    /^(?!#)(.+)$/gm,
    (line) => {
      line = line.trim();
      if (!line) return line;
      const abs = resolveUrl(line, originalUrl);
      return `${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}`;
    }
  );

  // 2. Reemplaza atributos URI="xxx" (común en #EXT-X-MEDIA, #EXT-X-KEY, etc.)
  rewritten = rewritten.replace(
    /URI=["']([^"']+)["']/g,
    (match, captured) => {
      const abs = resolveUrl(captured, originalUrl);
      // Forzamos forceM3u8=1 para asegurar que las sub-playlists de audio/calidad
      // también sean procesadas por este proxy recursivamente.
      return `URI="${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}&forceM3u8=1"`;
    }
  );

  return rewritten;
}

/**
 * Determina si la URL/ContentType corresponde a un flujo HLS.
 */
function detectIsM3u8(url, contentType, forceFlag) {
  if (forceFlag) return true;
  if (contentType.includes('mpegurl') || contentType.includes('m3u8')) return true;
  if (url.includes('.m3u8')) return true;

  if (/\.txt/i.test(url)) {
    if (/\/hls\//i.test(url))         return true;
    if (/master|playlist/i.test(url)) return true;
  }

  return false;
}

/**
 * GET /proxy?url=<encoded-url>[&referer=<encoded-referer>][&forceM3u8=1]
 */
async function proxyHandler(req, res, next) {
  try {
    const { url, referer = '', forceM3u8 = '0' } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Parámetro "url" requerido.' });
    }

    let decodedUrl;
    try {
      decodedUrl = decodeURIComponent(url);
      new URL(decodedUrl);
    } catch {
      return res.status(400).json({ error: 'URL inválida.' });
    }

    const decodedReferer = referer ? decodeURIComponent(referer) : '';
    const origin = (() => {
      try { return new URL(decodedUrl).origin; } catch { return ''; }
    })();

    const headers = getMediaHeaders(decodedReferer || origin, origin);

    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    console.log(`[Proxy] → ${decodedUrl.substring(0, 100)}`);

    const upstream = await axios.get(decodedUrl, {
      headers,
      responseType: 'stream',
      maxRedirects: 10,
      timeout: 60_000,
      validateStatus: () => true,
    });

    const contentType = upstream.headers['content-type'] || 'application/octet-stream';
    const isM3u8 = detectIsM3u8(decodedUrl, contentType, forceM3u8 === '1');

    const forwardHeaders = [
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ];

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    if (!isM3u8) {
      res.setHeader('Content-Type', contentType);
      forwardHeaders.forEach(h => {
        if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]);
      });
      upstream.data.pipe(res);
      upstream.data.on('error', next);
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');

    let body = '';
    upstream.data.on('data',  chunk => { body += chunk.toString(); });
    upstream.data.on('error', next);
    upstream.data.on('end',   () => {
      const proxyBase     = `${req.protocol}://${req.get('host')}/proxy`;
      const rewrittenM3u8 = rewriteM3u8(body, decodedUrl, proxyBase, decodedReferer);
      res.end(rewrittenM3u8);
    });

  } catch (err) {
    console.error('[Proxy Error]', err.message);
    next(err);
  }
}

module.exports = { proxyHandler };
