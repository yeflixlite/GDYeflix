/**
 * ============================================================
 *  controllers/proxyController.js
 *  Sirve el contenido del video evitando CORS.
 *  Optimizado para Filemoon (Persistencia de tokens de sesión).
 * ============================================================
 */

'use strict';

const axios               = require('axios');
const http                = require('http');
const https               = require('https');
const { getMediaHeaders } = require('../utils/browserHeaders');

// Agentes con Keep-Alive para rendimiento
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const AD_BLOCKLIST = [
    'tiktokcdn.com', 'doubleclick.net', 'adnxs.com', 'advertising.com',
    'quantserve.com', 'scorecardresearch.com', 'clisky.xyz', 'trbt.it'
];

/**
 * Resuelve URLs relativas conservando los Query Params de la base.
 * CRÍTICO para Filemoon y similares donde los segmentos dependen del token de la playlist.
 */
function resolveUrl(target, base) {
  if (target.startsWith('http')) return target;
  
  const baseUrl = new URL(base);
  let resolved;

  if (target.startsWith('//')) {
    resolved = new URL(`${baseUrl.protocol}${target}`);
  } else if (target.startsWith('/')) {
    resolved = new URL(`${baseUrl.origin}${target}`);
  } else {
    const dirPath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
    resolved = new URL(`${baseUrl.origin}${dirPath}${target}`);
  }

  // SI LA BASE TIENE PARÁMETROS (?, t=, s=, e=) Y EL TARGET NO, SE LOS PASAMOS
  if (baseUrl.search && !resolved.search) {
    resolved.search = baseUrl.search;
  }

  return resolved.toString();
}

function rewriteM3u8(content, originalUrl, proxyBase, referer) {
  const encodedReferer = encodeURIComponent(referer || '');
  
  // 1. Líneas de segmentos
  let rewritten = content.replace(
    /^(?!#)(.+)$/gm,
    (line) => {
      line = line.trim();
      if (!line) return line;
      const abs = resolveUrl(line, originalUrl);
      const isAd = AD_BLOCKLIST.some(domain => abs.includes(domain));
      if (isAd) return abs; 
      return `${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}`;
    }
  );

  // 2. Atributos URI (Audio, Key, etc.)
  rewritten = rewritten.replace(
    /URI=["']([^"']+)["']/g,
    (match, captured) => {
      const abs = resolveUrl(captured, originalUrl);
      return `URI="${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}&forceM3u8=1"`;
    }
  );

  return rewritten;
}

async function proxyHandler(req, res, next) {
  try {
    const { url, referer = '', forceM3u8 = '0' } = req.query;

    if (!url) return res.status(400).end();

    const decodedUrl = decodeURIComponent(url);
    const decodedReferer = referer ? decodeURIComponent(referer) : '';
    
    let origin = '';
    try { origin = new URL(decodedUrl).origin; } catch {}

    const isAd = AD_BLOCKLIST.some(domain => decodedUrl.includes(domain));
    if (isAd) return res.status(404).end();

    // Log para depuración de rutas (solo para m3u8)
    if (decodedUrl.includes('.m3u8') || forceM3u8 === '1') {
       console.log(`[Proxy] 📄 Manifest: ${decodedUrl.substring(0, 70)}...`);
    }

    const headers = getMediaHeaders(decodedReferer || origin, origin);
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstream = await axios.get(decodedUrl, {
      headers,
      responseType: 'stream',
      httpAgent,
      httpsAgent,
      maxRedirects: 10,
      timeout: 15_000, 
      validateStatus: (status) => status < 400,
    });

    const isM3u8 = decodedUrl.includes('.m3u') || 
                   (upstream.headers['content-type'] || '').includes('mpegurl') ||
                   forceM3u8 === '1';

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    if (!isM3u8) {
      const contentType = upstream.headers['content-type'] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      const forwardHeaders = ['content-length','content-range','accept-ranges','last-modified','etag'];
      forwardHeaders.forEach(h => { if (upstream.headers[h]) res.setHeader(h, upstream.headers[h]); });
      upstream.data.pipe(res);
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    let body = '';
    upstream.data.on('data',  chunk => { body += chunk; });
    upstream.data.on('end',   () => {
      res.end(rewriteM3u8(body, decodedUrl, '/proxy', decodedReferer));
    });

  } catch (err) {
    if (!res.headersSent) res.status(404).end();
  }
}

module.exports = { proxyHandler };
