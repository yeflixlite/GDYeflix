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
  if (baseUrl.search) {
    const baseParams = baseUrl.searchParams;
    const targetParams = resolved.searchParams;
    
    // Parámetros críticos de StreamWish/Filemoon
    ['t', 's', 'e', 'token'].forEach(p => {
      if (baseParams.has(p) && !targetParams.has(p)) {
        targetParams.set(p, baseParams.get(p));
      }
    });
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

  // 3. Arreglo para "Nivel 0" (VOE / Filemoon)
  // Aseguramos que la línea tenga RESOLUTION y NAME válidos.
  // Algunos servidores envían RESOLUTION=0x0 que confunde al reproductor.
  rewritten = rewritten.replace(
    /#EXT-X-STREAM-INF:([^\r\n]+)/g,
    (match, attributes) => {
      let newAttributes = attributes;
      let res = '1280x720';
      let name = '"720p"';

      if (attributes.includes('1080p') || attributes.includes('1920x1080')) { res = '1920x1080'; name = '"1080p"'; }
      else if (attributes.includes('480p') || attributes.includes('854x480')) { res = '854x480'; name = '"480p"'; }
      else if (attributes.includes('360p') || attributes.includes('640x360')) { res = '640x360'; name = '"360p"'; }
      else if (attributes.includes('4K') || attributes.includes('2160p')) { res = '3840x2160'; name = '"4K"'; }

      // Limpiar etiquetas rotas (ej: RESOLUTION=0x0)
      newAttributes = newAttributes.replace(/,RESOLUTION=[^,]+/g, '');
      newAttributes = newAttributes.replace(/,NAME=[^,]+/g, '');

      // Inyectar etiquetas limpias
      newAttributes += `,RESOLUTION=${res},NAME=${name}`;

      return `#EXT-X-STREAM-INF:${newAttributes}`;
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

    // LOGICA DE REFERER: Muchos CDNs (como medixiru, dohaxe) requieren que el referer
    // sea el mismo dominio del video o el dominio embed original.
    let targetOrigin = '';
    try { targetOrigin = new URL(decodedUrl).origin; } catch {}
    
    // Si no se pasó un referer explícito, usamos el origin del video como fallback
    // Esto suele saltarse protecciones de Hotlink.
    const effectiveReferer = decodedReferer || targetOrigin;

    const headers = getMediaHeaders(effectiveReferer, targetOrigin);
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstream = await axios.get(decodedUrl, {
      headers,
      responseType: 'stream',
      httpAgent,
      httpsAgent,
      maxRedirects: 10,
      timeout: 20_000, 
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
