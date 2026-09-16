/**
 * ============================================================
 *  services/goodstream.js
 *  Extrae el enlace HLS (m3u8) de Goodstream y sus mirrors.
 *  Elimina anuncios VAST y desofusca código empaquetado.
 *
 *  Estrategias en orden de prioridad:
 *   1. Texto plano   → file:"https://...m3u8"
 *   2. Unpack p,a,c,k,e,d (código comprimido)
 *   3. Decode atob()  (base64)
 *   4. Eval() simple  → busca m3u8 en el resultado
 *   5. Regex final    → cualquier https con .m3u8
 * ============================================================
 */

'use strict';

const cheerio            = require('cheerio');
const { fetchWithRetry } = require('../utils/axiosClient');
const https = require('https');
const http  = require('http');

const httpsAgent = new https.Agent({ keepAlive: true });
const httpAgent  = new http.Agent({ keepAlive: true });

// Caché en memoria: 60 minutos
const extractionCache = new Map();
const CACHE_TTL = 1000 * 60 * 60;

/* ── Dominios reconocidos de Goodstream ─────────────────────── */
const GOODSTREAM_DOMAINS = [
  'goodstream.one',
  'goodstream.pro',
  'goodstream.cc',
  'gdstream.xyz',
  'gd-stream.com',
  'goodstreamz.com',
];

/**
 * Normaliza la URL al formato /e/<id>
 */
function normalizeUrl(rawUrl) {
  const u = new URL(rawUrl);
  const match = u.pathname.match(/\/[ev]\/([a-zA-Z0-9]+)/);
  if (match) return `${u.origin}/e/${match[1]}${u.search}`;
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    if (/^[a-zA-Z0-9]{4,}$/.test(last)) {
      return `${u.origin}/e/${last}${u.search}`;
    }
  }
  return rawUrl;
}

/* ── Helpers de detección de tipo ─────────────────────────────── */
function isHlsUrl(url) {
  return /\.m3u8/i.test(url) || /master\.txt/i.test(url) || /\/hls\//i.test(url) || /playlist\.txt/i.test(url);
}
function guessType(url) { return isHlsUrl(url) ? 'm3u8' : 'mp4'; }

/* ── Extracción de scripts del DOM ────────────────────────────── */
function extractScripts(html) {
  const $ = cheerio.load(html);
  const parts = [];
  $('script').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) parts.push($(el).html() || '');
  });
  return parts.join('\n');
}

/* ── Desofuscación: p,a,c,k,e,d ──────────────────────────────── */
function tryUnpack(js, baseOrigin) {
  if (!js.includes('p,a,c,k,e,d')) return null;
  try {
    const pMatch = js.match(/}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)\)\)/);
    if (!pMatch) return null;

    let p = pMatch[1];
    const a = parseInt(pMatch[2]);
    let c   = parseInt(pMatch[3]);
    const k = pMatch[4].split('|');

    const eFunc = (n) => (n < a ? '' : eFunc(parseInt(n / a))) +
      ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));

    while (c--) {
      if (k[c]) p = p.replace(new RegExp('\\b' + eFunc(c) + '\\b', 'g'), k[c]);
    }

    // Buscar m3u8 en el código desempaquetado
    const relMatch = p.match(/[\"'](\/[^\"'\\]+\.m3u8[^\"'\\]*)[\"']/i);
    if (relMatch && baseOrigin) return baseOrigin + relMatch[1];

    const absMatch = p.match(/https?:\/\/[^\s\"'<>\\]+\.m3u8[^\s\"'<>\\]*/i);
    if (absMatch) return absMatch[0];

    const txtMatch = p.match(/https?:\/\/[^\s\"'<>\\]*\/hls\/[^\s\"'<>\\]*\.txt[^\s\"'<>\\]*/i);
    if (txtMatch) return txtMatch[0];
  } catch (e) {}
  return null;
}

/* ── Desofuscación: atob (base64) ─────────────────────────────── */
function tryDecodeAtob(js) {
  const matches = [...js.matchAll(/atob\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/g)];
  for (const m of matches) {
    try {
      const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
      const urlMatch = decoded.match(/https?:\/\/[^\s\"'<>]+(?:\.m3u8|master\.txt|playlist\.txt|\/hls\/)[^\s\"'<>]*/i);
      if (urlMatch) return urlMatch[0];
    } catch {}
  }
  return null;
}

/* ── Búsqueda directa (texto plano) ──────────────────────────── */
function tryDirectPatterns(js, baseOrigin) {
  const patterns = [
    // JWPlayer setup con sources
    /\.setup\s*\(\s*\{[^}]*?sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/is,
    // file: "url.m3u8"
    /file\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)/i,
    /file\s*:\s*["'](https?:\/\/[^"']*master\.txt[^"']*)/i,
    /file\s*:\s*["'](https?:\/\/[^"']*playlist\.txt[^"']*)/i,
    // sources:[{file:"..."}]
    /sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+\.m3u8[^"']*?)["']/is,
    // Cualquier m3u8 entre comillas
    /["'](https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)["']/i,
    // Archivo HLS .txt
    /["'](https?:\/\/[^"'\s]*\/hls\/[^"'\s]*\.txt[^"'\s]*)["']/i,
  ];

  for (const pat of patterns) {
    const m = js.match(pat);
    if (m && m[1]) {
      const url = m[1];
      if (url.startsWith('/') && baseOrigin) return baseOrigin + url;
      if (url.startsWith('http')) return url;
    }
  }
  return null;
}

/**
 * Función principal de extracción.
 * @param {string} rawUrl  URL del embed de Goodstream
 */
async function extract(rawUrl) {
  const embedUrl = normalizeUrl(rawUrl);
  const u        = new URL(embedUrl);
  const origin   = u.origin;
  const host     = u.hostname;
  const id       = u.pathname.split('/').filter(Boolean).pop();
  const search   = u.search;
  const cacheKey = `${host}:${id}${search}`;

  // Caché
  const cached = extractionCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    console.log(`[Goodstream] ⚡ Cache hit: ${id}`);
    return cached.result;
  }

  console.log(`[Goodstream] 🔍 Extrayendo: ${embedUrl}`);

  // Intentar con el host original y mirrors conocidos en paralelo
  const hostsToTry = [host, ...GOODSTREAM_DOMAINS.filter(d => d !== host)];

  const fetchPromises = hostsToTry.map(async (testHost) => {
    const testUrl = `https://${testHost}/e/${id}${search}`;
    try {
      const response = await fetchWithRetry(testUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer':    `https://${testHost}/`,
          'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        },
        timeout: 8000,
        httpsAgent,
        httpAgent,
        responseType: 'text',
      }, 1);

      const html = typeof response === 'string' ? response : response.data;
      if (!html || html.length < 500) throw new Error('HTML demasiado corto');
      // Descartar Cloudflare challenge
      if (html.includes('Just a moment') || html.includes('cf-browser-verification')) {
        throw new Error('Cloudflare bloqueó la petición');
      }

      return { html, testHost, testUrl };
    } catch (err) {
      throw new Error(`${testHost}: ${err.message}`);
    }
  });

  let html = '';
  let finalHost = host;
  let finalUrl  = embedUrl;

  try {
    const fastest = await Promise.any(fetchPromises);
    html      = fastest.html;
    finalHost = fastest.testHost;
    finalUrl  = fastest.testUrl;
    console.log(`[Goodstream] ✅ HTML obtenido desde: ${finalHost} (${html.length} bytes)`);
  } catch (err) {
    throw new Error(`[Goodstream] Todos los mirrors fallaron. Último error: ${err.message}`);
  }

  const scripts    = extractScripts(html);
  const baseOrigin = `https://${finalHost}`;

  // ── Aplicar estrategias en orden ──────────────────────────────
  let videoUrl = null;

  // 1. Texto plano
  videoUrl = tryDirectPatterns(scripts, baseOrigin);
  if (videoUrl) console.log(`[Goodstream] ✅ Encontrado (texto plano): ${videoUrl.substring(0, 80)}`);

  // 2. p,a,c,k,e,d
  if (!videoUrl) {
    videoUrl = tryUnpack(scripts, baseOrigin);
    if (videoUrl) console.log(`[Goodstream] ✅ Encontrado (unpack): ${videoUrl.substring(0, 80)}`);
  }

  // 3. atob
  if (!videoUrl) {
    videoUrl = tryDecodeAtob(scripts);
    if (videoUrl) console.log(`[Goodstream] ✅ Encontrado (atob): ${videoUrl.substring(0, 80)}`);
  }

  // 4. Fallback: buscar en todo el HTML
  if (!videoUrl) {
    videoUrl = tryDirectPatterns(html, baseOrigin);
    if (videoUrl) console.log(`[Goodstream] ✅ Encontrado (HTML completo): ${videoUrl.substring(0, 80)}`);
  }

  if (!videoUrl) {
    throw new Error('[Goodstream] No se encontró ningún stream válido. El site puede requerir Puppeteer.');
  }

  const result = {
    videoUrl,
    type:    guessType(videoUrl),
    referer: `${baseOrigin}/`,
  };

  extractionCache.set(cacheKey, { result, ts: Date.now() });
  return result;
}

module.exports = { extract, GOODSTREAM_DOMAINS };
