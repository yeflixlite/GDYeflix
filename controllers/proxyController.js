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
const zlib                = require('zlib');
const { getMediaHeaders } = require('../utils/browserHeaders');

// CONFIGURACIÓN DE AHORRO DE BANDA
// Si es 'false', los segmentos (.ts) se cargarán directo del CDN original.
// Esto ahorra el 95% del ancho de banda del servidor.
const PROXY_SEGMENTS = process.env.PROXY_SEGMENTS === 'true'; 
const IS_PROD = process.env.NODE_ENV === 'production';

// Lista de dominios que permiten carga directa (CORS abierto sin IP-binding)
// NOTA: Si un dominio bloquea por CORS en el navegador, NO debe estar aquí.
const DIRECT_DOMAINS = [
    // VOE: CORS genuinamente abierto
    'voe', 'timmaybealready.com', 'charlestoughrace.com', 'reitshof.com', 'jenniferperformer.com',
    // VidHide MIRRORS: cuando el m3u8 usa /stream/ del mirror, los segmentos
    // los sirve el mismo mirror con CORS abierto (no el CDN acek/dramiyos)
    'minochinos.com', 'callistanise.com', 'vsharea.com', 'vidhidepro.com', 'vidhide.com',
    // Otros CDNs sin restricciones conocidas
    'doodstream.com', 'dood.re',
    'filemoon.sx', 'googleusercontent.com', 'cloudfront.net',
];

// Agentes con Keep-Alive para rendimiento
const httpAgent  = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const AD_BLOCKLIST = [
    'tiktokcdn.com', 'doubleclick.net', 'adnxs.com', 'advertising.com',
    'quantserve.com', 'scorecardresearch.com', 'clisky.xyz', 'trbt.it'
];

// ── MEJORA 2: Cache en memoria para M3U8 maestros ────────────
// TTL de 8 segundos: el suficiente para absorber picos de usuarios,
// sin servir listas tan viejas que tengan segmentos expirados.
const m3u8Cache = new Map();
const M3U8_CACHE_TTL = 8_000; // 8 segundos

function getCached(key) {
    const entry = m3u8Cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > M3U8_CACHE_TTL) {
        m3u8Cache.delete(key);
        return null;
    }
    return entry.body;
}

function setCache(key, body) {
    // Limitar el tamaño del caché para no agotar la RAM de Vercel
    if (m3u8Cache.size > 100) {
        const firstKey = m3u8Cache.keys().next().value;
        m3u8Cache.delete(firstKey);
    }
    m3u8Cache.set(key, { body, ts: Date.now() });
}

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
    const baseParams   = baseUrl.searchParams;
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
      
      // Bloqueo de anuncios
      const isAd = AD_BLOCKLIST.some(domain => abs.includes(domain));
      if (isAd) return abs; 

      // LÓGICA DE AHORRO: ¿Debemos saltarnos el proxy para este segmento?
      const isSegment = abs.includes('.ts') || abs.includes('.m4s') || abs.includes('.mp4') || abs.includes('/seg-') || abs.includes('.woff2');
      const canBeDirect = DIRECT_DOMAINS.some(d => abs.includes(d));

      if (isSegment && !PROXY_SEGMENTS && canBeDirect) {
          // Devolvemos la URL directa. Ahorramos 100% de banda en este fragmento.
          return abs;
      }
      
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

      let res  = '1280x720';
      let name = '"720p"';
      const resMatch = attributes.match(/RESOLUTION=(\d+)x(\d+)/i);
      if (resMatch) {
        const height = parseInt(resMatch[2]);
        res = `${resMatch[1]}x${resMatch[2]}`;
        if      (height >= 2160) name = '"4K"';
        else if (height >= 1080) name = '"1080p"';
        else if (height >= 720)  name = '"720p"';
        else if (height >= 480)  name = '"480p"';
        else if (height >= 360)  name = '"360p"';
        else                     name = `"${height}p"`;
      } else {
        if      (attributes.includes('1080p') || attributes.includes('1920x1080')) { res = '1920x1080'; name = '"1080p"'; }
        else if (attributes.includes('480p')  || attributes.includes('854x480'))   { res = '854x480';   name = '"480p"'; }
        else if (attributes.includes('360p')  || attributes.includes('640x360'))   { res = '640x360';   name = '"360p"'; }
        else if (attributes.includes('4K')    || attributes.includes('2160p'))     { res = '3840x2160'; name = '"4K"'; }
      }

      newAttributes = newAttributes.replace(/,?RESOLUTION=[^\s,]+/gi, '');
      newAttributes = newAttributes.replace(/,?NAME=[^\s,]+/gi, '');
      newAttributes += `,RESOLUTION=${res},NAME=${name}`;

      return `#EXT-X-STREAM-INF:${newAttributes}`;
    }
  );

  return rewritten;
}

// ── MEJORA 5: Fetch con reintento ────────────────────────────
async function fetchUpstream(url, headers, timeout) {
    const config = {
        headers,
        responseType: 'stream',
        httpAgent,
        httpsAgent,
        maxRedirects: 10,
        timeout,
        validateStatus: (status) => status < 400,
    };

    try {
        return await axios.get(url, config);
    } catch (err) {
        // Un solo reintento automático antes de rendirse
        if (!IS_PROD) console.log(`[Proxy] ⚠️ Reintentando: ${url.substring(0, 60)}...`);
        return await axios.get(url, config);
    }
}

async function proxyHandler(req, res, next) {
  try {
    const { url, referer = '', forceM3u8 = '0', wrapM3u8 = '' } = req.query;

    if (!url) return res.status(400).end();

    const decodedUrl     = decodeURIComponent(url);
    const decodedReferer = referer ? decodeURIComponent(referer) : '';
    
    let origin = '';
    try { origin = new URL(decodedUrl).origin; } catch {}

    const isAd = AD_BLOCKLIST.some(domain => decodedUrl.includes(domain));
    if (isAd) return res.status(404).end();

    const isM3u8Request = decodedUrl.includes('.m3u') ||
                          forceM3u8 === '1';

    // ── MEJORA 4: Log solo en desarrollo ─────────────────────
    if (!IS_PROD && isM3u8Request) {
       console.log(`[Proxy] 📄 Manifest: ${decodedUrl.substring(0, 70)}...`);
    }

    // ── MEJORA 2: Servir desde caché si existe ────────────────
    if (isM3u8Request) {
        const cached = getCached(decodedUrl);
        if (cached) {
            res.status(200);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            res.setHeader('X-Cache', 'HIT');
            return sendCompressed(req, res, cached);
        }
    }

    // LOGICA DE REFERER
    let targetOrigin = '';
    try { targetOrigin = new URL(decodedUrl).origin; } catch {}
    const effectiveReferer = decodedReferer || targetOrigin;

    const headers = getMediaHeaders(effectiveReferer, targetOrigin);
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // ── MEJORA 3: Timeout diferenciado ───────────────────────
    // M3U8/playlists son archivos pequeños → fallar rápido (8s)
    // Segmentos de video pueden ser pesados → más tiempo (15s)
    const isSegment = decodedUrl.includes('.ts') || 
                      decodedUrl.includes('.m4s') ||
                      decodedUrl.includes('.mp4');
    const timeout = isM3u8Request ? 8_000 : (isSegment ? 15_000 : 20_000);

    const upstream = await fetchUpstream(decodedUrl, headers, timeout);

    const isM3u8 = isM3u8Request || 
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

    // Recopilar el cuerpo M3U8 y procesarlo
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('X-Cache', 'MISS');
    let body = '';
    upstream.data.on('data',  chunk => { body += chunk; });
    upstream.data.on('end',   () => {
      let processed = rewriteM3u8(body, decodedUrl, '/proxy', decodedReferer);

      // wrapM3u8: Si el m3u8 es una playlist de un solo nivel (sin #EXT-X-STREAM-INF),
      // lo envolvemos en un master sintético para que el reproductor muestre la calidad correcta.
      if (wrapM3u8 && processed.includes('#EXTINF') && !processed.includes('#EXT-X-STREAM-INF')) {
        const levelName = decodeURIComponent(wrapM3u8);  // ej. "720p"
        const resMap    = { '1080p': '1920x1080', '720p': '1280x720', '480p': '854x480', '360p': '640x360' };
        const res2      = resMap[levelName] || '1280x720';
        const bwMap     = { '1080p': '4000000', '720p': '2000000', '480p': '1000000', '360p': '500000' };
        const bw        = bwMap[levelName] || '2000000';
        // La playlist real ya está reescrita con rutas de proxy; la apuntamos directamente
        const innerUrl  = `/proxy?url=${encodeURIComponent(decodedUrl)}&referer=${encodeURIComponent(decodedReferer)}&forceM3u8=1`;
        processed = [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          `#EXT-X-STREAM-INF:BANDWIDTH=${bw},RESOLUTION=${res2},NAME="${levelName}"`,
          innerUrl,
        ].join('\n');
        setCache(decodedUrl + '?wrap=' + levelName, processed);
      } else if (processed.includes('#EXT-X-STREAM-INF') || processed.includes('#EXT-X-MEDIA')) {
        setCache(decodedUrl, processed);
      }

      sendCompressed(req, res, processed);
    });

  } catch (err) {
    if (!res.headersSent) res.status(404).end();
  }
}

// ── MEJORA 1: Envío con compresión gzip si el cliente la soporta ──
function sendCompressed(req, res, text) {
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (acceptEncoding.includes('gzip')) {
        zlib.gzip(Buffer.from(text, 'utf8'), (err, compressed) => {
            if (err) {
                res.end(text);
                return;
            }
            res.setHeader('Content-Encoding', 'gzip');
            res.setHeader('Content-Length', compressed.length);
            res.end(compressed);
        });
    } else {
        res.end(text);
    }
}

module.exports = { proxyHandler };
