/**
 * ============================================================
 *  services/streamwish.js
 *  Extrae el enlace HLS (m3u8 / .txt) de todos los dominios
 *  de la familia StreamWish:
 *    streamwish.com · embedwish.com · flaswish.com
 *    hgcloud.to (SF-Astwish / HGCloud) · wishfast.top · y más
 * ============================================================
 *
 *  StreamWish puede ocultar el enlace m3u8 como archivo .txt
 *  (el contenido sigue siendo una playlist HLS válida).
 *
 *  Estrategias en orden de prioridad:
 *   0. links.hls2 / links.hls3 → CDN real (premilkyway.com / *.cyou) que sirve
 *      el contenido auténtico. Verificado: responde a nuestro servidor solo con
 *      Referer: https://streamwish.to/ (sin cookies). Se valida que el master
 *      devuelva #EXTM3U antes de aceptarlo (los nodos caídos hacen fallback).
 *   1. Patrón jwplayer  → jwplayer().setup({sources:[{file:"..."}]})
 *   2. Patrón file:     → file:"https://...m3u8" / file:"...master.txt"
 *   3. Función eval()   → código JS ofuscado con atob/eval
 *   4. Patrón sources[] → sources:[{file:"..."}]
 *   5. Any https .txt   → URL que contenga /hls/ o master
 *   6. links.hls4       → fallback: /stream/ del propio espejo (puede entregar
 *      variantes SOLO-ANUNCIOS; se usa solo si el CDN real no responde)
 */

'use strict';

const cheerio            = require('cheerio');
const { fetchWithRetry } = require('../utils/axiosClient');
const https = require('https');
const http = require('http');

// Keep-alive agents para conexiones más rápidas a espejos
const httpsAgent = new https.Agent({ keepAlive: true });
const httpAgent = new http.Agent({ keepAlive: true });

// Caché en memoria para evitar volver a extraer (exclusivo para URLs resueltas válidas)
const extractionCache = new Map();
// Tiempo de expiración de la caché local: 60 minutos (para evitar caducidad de tokens m3u8)
const CACHE_TTL = 1000 * 60 * 60;

/* ── Dominios reconocidos de la familia StreamWish ────────── */
const STREAMWISH_DOMAINS = [
  'streamwish.com',
  'streamwish.to',
  'hgcloud.to',
  'hgcloud.net',
  'hglink.to',
  'hglamioz.com',
  'streamhg.com',
];

/**
 * Normaliza la URL al formato /e/<id> usando el mismo dominio.
 * Soporta rutas: /e/<id>  /v/<id>  /<id>
 */
function normalizeUrl(rawUrl) {
  const u = new URL(rawUrl);

  // Busca /e/<id>  o  /v/<id>
  let match = u.pathname.match(/\/[ev]\/([a-zA-Z0-9]+)/);
  if (match) return `${u.origin}/e/${match[1]}${u.search}`;

  // Fallback: primer segmento del path como ID
  const segments = u.pathname.split('/').filter(Boolean);
  if (segments.length) return `${u.origin}/e/${segments[0]}${u.search}`;

  throw new Error(`No se pudo normalizar la URL de StreamWish: ${rawUrl}`);
}

/* ── Helpers de extracción ───────────────────────────────── */

/** ¿Es una URL que parece ser un stream HLS? */
function isHlsUrl(url) {
  return /\.m3u8/i.test(url) ||
         /master\.txt/i.test(url) ||
         /\/hls\//i.test(url) ||
         /playlist\.txt/i.test(url);
}

/** Determina el type a devolver */
function guessType(url) {
  return isHlsUrl(url) ? 'm3u8' : 'mp4';
}

/* ── P.A.C.K.E.R decode compartido ─────────────────────────── */
const PACKER_RE = /eval\(function\(p,a,c,k,e,d\).*?\}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split\(['"]\|['"]\)/s;

function decodePacker(js) {
  const match = js.match(PACKER_RE);
  if (!match) return null;
  try {
    let [_, payload, base, count, dict] = match;
    base = parseInt(base);
    count = parseInt(count);
    const dictArr = dict.split('|');

    const dec = (c) => {
      return (c < base ? '' : dec(parseInt(c / base))) + ((c % base) > 35 ? String.fromCharCode((c % base) + 29) : (c % base).toString(36));
    };

    while (count--) {
      if (dictArr[count]) {
        const regex = new RegExp('\\b' + dec(count) + '\\b', 'g');
        payload = payload.replace(regex, dictArr[count]);
      }
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Extrae el objeto `links` (hls2/hls3/hls4) y las cookies (file_id, aff,
 * ref_url) que StreamWish setea en la página. hls2/hls3 apuntan al CDN real
 * (premilkyway.com / *.cyou) que sirve el contenido auténtico con solo
 * Referer: https://streamwish.to/; hls4 es la ruta /stream/ del espejo
 * (fallback, puede responder variantes solo-anuncios).
 */
function parsePackerLinks(js) {
  const cookiePairs = [];
  for (const m of js.matchAll(/\$\.cookie\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]*)['"]/g)) {
    const k = m[1].trim();
    if (k && !cookiePairs.some(p => p.startsWith(k + '='))) cookiePairs.push(`${k}=${m[2]}`);
  }
  const cookies = cookiePairs.join('; ');

  const links = {};
  const decoded = decodePacker(js);
  if (decoded) {
    const lm = decoded.match(/links\s*=\s*\{([\s\S]*?)\};/s);
    if (lm) {
      for (const mm of lm[1].matchAll(/"([a-zA-Z0-9]+)"\s*:\s*"([^"]*)"/g)) {
        if (mm[1] && !links[mm[1]]) links[mm[1]] = mm[2];
      }
    }
  }
  return { links, cookies };
}

/**
 * Intenta decodificar strings base64 anidados en el JS
 * (patrón común en páginas que ofuscan con eval(atob(...)))
 */
function tryDecodeEval(js) {
  // 1. Intentar atob (existente)
  const atobMatch = js.match(/atob\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/g);
  if (atobMatch) {
    for (const expr of atobMatch) {
      try {
        const b64 = expr.match(/['"]([A-Za-z0-9+/=]+)['"]/)[1];
        const decoded = Buffer.from(b64, 'base64').toString('utf-8');
        const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+(?:\.m3u8|master\.txt|playlist\.txt|\/hls\/)[^\s"'<>]*/i);
        if (urlMatch) return urlMatch[0];
      } catch { /* ignorar */ }
    }
  }

  // 2. Intentar P.A.C.K.E.R (Dean Edwards)
  // eval(function(p,a,c,k,e,d){...}('payload', base, count, 'dict'.split('|')))
  const decodedPacker = decodePacker(js);
  
  if (decodedPacker) {
    const urlMatch = decodedPacker.match(/https?:\/\/[^\s"'<>]+(?:\.m3u8|master\.txt|playlist\.txt|\/hls\/)[^\s"'<>]*/i);
    if (urlMatch) return urlMatch[0];
  }

  return null;
}

/**
 * Extrae scripts inline del HTML y los concatena.
 * @param {string} html
 */
function extractScripts(html) {
  const $ = cheerio.load(html);
  const parts = [];
  $('script').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) parts.push($(el).html() || '');
  });
  return parts.join('\n');
}

/* ── Extractor principal ─────────────────────────────────── */

/**
 * @param {string} url  URL de la página embed de StreamWish/HGCloud
 * @returns {Promise<{ videoUrl: string, type: 'm3u8'|'mp4', referer: string }>}
 */
async function extract(url, forceFresh = false) {
  let embedUrl = normalizeUrl(url);
  let u = new URL(embedUrl);
  const id = u.pathname.split('/').filter(Boolean).pop();

  // CHECK CACHE (se omite cuando el proxy hace hot-swap y necesita una URL fresca)
  const cacheKey = id + u.search;
  const cached = extractionCache.get(cacheKey);
  if (forceFresh) {
    extractionCache.delete(cacheKey);
  } else if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[StreamWish] ⚡ Resultado obtenido de CACHE en memoria para ID: ${id}`);
    return cached.result;
  }

  // Espejos limpios sin Cloudflare agresivo proporcionados por el usuario
  const CLEAN_MIRRORS = ['playnixes.com', 'hglamioz.com', 'medixiru.com'];
  
  // Agregamos el host original a la lista por si es nativo (ej. hgcloud.to o local)
  const hostsToTry = [u.host, ...CLEAN_MIRRORS];
  const uniqueHosts = [...new Set(hostsToTry)];

  console.log(`[StreamWish] 🔍 Iniciando búsqueda rápida concurrente (Race) en espejos limpios...`);

  // Lanzar peticiones concurrentes a todos los espejos para un Failover rápido
  const fetchPromises = uniqueHosts.map(async (testHost) => {
      const testUrl = `https://${testHost}/e/${id}${u.search}`;
      
      const response = await fetchWithRetry(testUrl, {
          referer: 'https://www.google.com/',
          origin: `https://${testHost}`,
          timeout: 4500, // Timeout estricto de 4.5s
          httpsAgent,
          httpAgent
      }, 1); // 1 solo intento por espejo en la carrera

      const testHtml = response.data;

      // Verificamos si el HTML es válido
      if ((testHtml.includes('setup({') || testHtml.includes('eval(function') || testHtml.includes('sources:[')) && 
          !testHtml.includes('Just a moment...') && !testHtml.includes('Page is loading')) {
          return {
              html: testHtml,
              finalOrigin: `https://${testHost}`,
              finalEmbedUrl: testUrl,
              host: testHost
          };
      }
      throw new Error(`HTML no válido en espejo ${testHost}`);
  });

  let html = '';
  let finalOrigin = '';
  let finalEmbedUrl = '';

  try {
      // Promise.any devuelve el primer espejo que responda exitosamente (el más rápido)
      const fastestResult = await Promise.any(fetchPromises);
      html = fastestResult.html;
      finalOrigin = fastestResult.finalOrigin;
      finalEmbedUrl = fastestResult.finalEmbedUrl;
      console.log(`[StreamWish] ✅ ¡ÉXITO HTTP! Espejo más rápido: ${fastestResult.host}`);
  } catch (err) {
      console.log(`[StreamWish] 🛡️ Falló la obtención concurrente. Todos los espejos bloqueados o caídos.`);
      throw new Error('Bloqueo Cloudflare total o video no encontrado en ningún espejo.');
  }

  const scripts = extractScripts(html);
  const hostToLog = new URL(finalEmbedUrl).host;
  const host = hostToLog;
  
  // Siempre forzamos el referer a streamwish.to para la reproducción, tal como indicó el usuario.
  const origin = 'https://streamwish.to';
  const search = u.search;
  
  console.log(`[StreamWish/${hostToLog}] 📄 HTML obtenido (${html.length} bytes), analizando...`);

  /* ── Estrategia 0: links.hls2 / links.hls3 (CDN real) ────── */
  // El objeto `links` del packer trae los CDN auténticos: hls2 (premilkyway.com)
  // y hls3 (bestonlinecourses.cyou y similares). Estos responden a nuestro
  // servidor únicamente con Referer: https://streamwish.to/ (la cookie no es
  // necesaria: los tokens t/s/e ya van en la URL). Como algunos nodos están
  // caídos, VALIDAMOS el master (#EXTM3U) antes de aceptar y si falla pasamos
  // al siguiente CDN; al final queda el fallback hls4 del espejo.
  const { links, cookies } = parsePackerLinks(scripts);
  for (const key of ['hls2', 'hls3']) {
    if (!links[key]) continue;
    const raw = links[key].trim();
    const cdn = raw.startsWith('http') ? raw : `https://${hostToLog}${raw.startsWith('/') ? '' : '/'}${raw}`;
    if (!/[.]m3u8|master[.]txt|playlist[.]txt|\/hls\//i.test(cdn)) {
      console.log(`[StreamWish/${hostToLog}] ⏭️ ${key} no es HLS (${cdn.substring(0, 60)}...).`);
      continue;
    }
    try {
      const probe = await fetchWithRetry(cdn, {
        referer: origin,
        origin: origin,
        timeout: 2500,
        httpsAgent,
        httpAgent,
      }, 1);
      const probeBody = String(probe.data || '');
      if (!probeBody.includes('#EXTM3U')) {
        console.log(`[StreamWish/${hostToLog}] ⏭️ ${key} respondió pero sin #EXTM3U; probando siguiente.`);
        continue;
      }
      console.log(`[StreamWish/${hostToLog}] ✅ Estrategia 0 (links.${key} CDN real, master validado) → ${cdn.substring(0, 80)}`);
      const result = { videoUrl: cdn, type: 'm3u8', referer: origin, cookie: '' };
      extractionCache.set(cacheKey, { timestamp: Date.now(), result });
      return result;
    } catch (e) {
      console.log(`[StreamWish/${hostToLog}] ⏭️ links.${key} no responde (nodo caído): ${e.message || e.code}.`);
    }
  }

  /* ── Estrategia 1: jwplayer setup  ─────────────────────── */
  // jwplayer("player").setup({sources:[{file:"..."}]})
  let m = scripts.match(
    /\.setup\s*\(\s*\{[^}]*?sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/is
  );
  if (m && m[1].startsWith('http')) {
    let videoUrl = m[1];
    if (u.search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + u.search.substring(1);
    }
    console.log(`[StreamWish/${hostToLog}] ✅ Estrategia 1 (jwplayer setup) → ${videoUrl.substring(0, 80)}`);
    const result = { videoUrl, type: guessType(videoUrl), referer: origin };
    extractionCache.set(cacheKey, { timestamp: Date.now(), result });
    return result;
  }

  /* ── Estrategia 2: file: "..." o file: '...' ────────────── */
  // Captura m3u8, .txt con /hls/, master.txt, playlist.txt
  const filePatterns = [
    /file\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)/i,
    /file\s*:\s*["'](https?:\/\/[^"']*master\.txt[^"']*)/i,
    /file\s*:\s*["'](https?:\/\/[^"']*playlist\.txt[^"']*)/i,
    /file\s*:\s*["'](https?:\/\/[^"']*\/hls\/[^"']+)/i,
    /file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i,
  ];

  for (const pat of filePatterns) {
    m = scripts.match(pat) || html.match(pat);
    if (m && m[1]) {
      let videoUrl = m[1];
      if (search && !videoUrl.includes('t=')) {
          videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
      }
      console.log(`[StreamWish/${host}] ✅ Estrategia 2 (file:) → ${videoUrl.substring(0, 80)}`);
      const result = { videoUrl, type: guessType(videoUrl), referer: origin };
      extractionCache.set(cacheKey, { timestamp: Date.now(), result });
      return result;
    }
  }

  /* ── Estrategia 3: eval(atob(...)) ofuscado ─────────────── */
  const evalDecoded = tryDecodeEval(scripts);
  if (evalDecoded) {
    let videoUrl = evalDecoded;
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 3 (eval/atob) → ${videoUrl.substring(0, 80)}`);
    const result = { videoUrl, type: guessType(videoUrl), referer: origin };
    extractionCache.set(cacheKey, { timestamp: Date.now(), result });
    return result;
  }

  /* ── Estrategia 4: sources array completo ───────────────── */
  m = scripts.match(/sources\s*:\s*\[\s*\{[^[\]]*?file\s*:\s*["'](https?:\/\/[^"']+)/is);
  if (m && m[1]) {
    let videoUrl = m[1];
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 4 (sources[]) → ${videoUrl.substring(0, 80)}`);
    const result = { videoUrl, type: guessType(videoUrl), referer: origin };
    extractionCache.set(cacheKey, { timestamp: Date.now(), result });
    return result;
  }

  /* ── Estrategia 5: cualquier URL con /hls/ o .txt en el HTML */
  const hlsInHtml = html.match(/https?:\/\/[^\s"'<>]*(?:\/hls\/|master\.txt|playlist\.txt)[^\s"'<>]*/i);
  if (hlsInHtml) {
    let videoUrl = hlsInHtml[0];
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 5 (HLS en HTML) → ${videoUrl.substring(0, 80)}`);
    const result = { videoUrl, type: 'm3u8', referer: origin };
    extractionCache.set(cacheKey, { timestamp: Date.now(), result });
    return result;
  }

  /* ── Estrategia 6: cualquier m3u8 en todo el documento ──── */
  const anyM3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
  if (anyM3u8) {
    let videoUrl = anyM3u8[0];
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 6 (m3u8 en HTML) → ${videoUrl.substring(0, 80)}`);
    const result = { videoUrl, type: 'm3u8', referer: origin };
    extractionCache.set(cacheKey, { timestamp: Date.now(), result });
    return result;
  }

  /* ── Fallback: links.hls4 del espejo (/stream/) ────────── */
  // Último recurso: la ruta /stream/ DEL MISMO ESPEJO que resolvió la página.
  // Requiere las cookies (file_id, aff, ref_url) y el referer del espejo, y su
  // variante puede llegar SOLO-ANUNCIOS; solo se usa si el CDN real no sirvió.
  if (links.hls4) {
    const rawH4 = links.hls4.trim();
    const h4 = rawH4.startsWith('http')
      ? rawH4
      : `https://${hostToLog}${rawH4.startsWith('/') ? '' : '/'}${rawH4}`;
    if (/\.m3u8/i.test(h4)) {
      console.log(`[StreamWish/${hostToLog}] ⚠️ Fallback (links.hls4 /stream/ del espejo) → ${h4.substring(0, 80)}`);
      const cookieStr = cookies || '';
      const result = { videoUrl: h4, type: 'm3u8', referer: `https://${hostToLog}/`, cookie: cookieStr };
      extractionCache.set(cacheKey, { timestamp: Date.now(), result });
      return result;
    }
  }

  /* ── No encontrado ─────────────────────────────────────── */
  console.error(`[StreamWish/${host}] ❌ No se encontró ningún enlace de video`);
  console.error(`[StreamWish/${host}] 📋 Primeros 2000 chars del HTML:\n${html.substring(0, 2000)}`);
  throw new Error(`No se pudo extraer el enlace de video de StreamWish (${host}).`);
}

module.exports = { extract, STREAMWISH_DOMAINS };
