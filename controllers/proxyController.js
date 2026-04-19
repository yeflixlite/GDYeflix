/**
 * ============================================================
 *  controllers/proxyController.js
 *  Sirve el contenido del video evitando CORS.
 * ============================================================
 */

'use strict';

const axios               = require('axios');
const { getMediaHeaders } = require('../utils/browserHeaders');

function resolveUrl(target, base) {
  if (target.startsWith('http')) return target;
  const baseUrl = new URL(base);
  if (target.startsWith('//')) return `${baseUrl.protocol}${target}`;
  if (target.startsWith('/')) return `${baseUrl.origin}${target}`;
  const dirPath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
  return `${baseUrl.origin}${dirPath}${target}`;
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

    const upstream = await axios.get(decodedUrl, {
      headers,
      responseType: 'stream',
      maxRedirects: 10,
      timeout: 60_000,
      validateStatus: () => true,
    });

    const contentType = upstream.headers['content-type'] || 'application/octet-stream';
    const isM3u8 = detectIsM3u8(decodedUrl, contentType, forceM3u8 === '1');

    res.status(upstream.status);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');

    if (!isM3u8) {
      res.setHeader('Content-Type', contentType);
      const forwardHeaders = ['content-length','content-range','accept-ranges','last-modified','etag'];
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
    upstream.data.on('end',   () => {
      // USAMOS RUTA RELATIVA AL HOST
      const proxyBase = '/proxy';
      const rewrittenM3u8 = rewriteM3u8(body, decodedUrl, proxyBase, decodedReferer);
      res.end(rewrittenM3u8);
    });

  } catch (err) {
    next(err);
  }
}

module.exports = { proxyHandler };
