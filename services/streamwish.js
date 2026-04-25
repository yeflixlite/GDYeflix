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
 *   1. Patrón jwplayer  → jwplayer().setup({sources:[{file:"..."}]})
 *   2. Patrón file:     → file:"https://...m3u8" / file:"...master.txt"
 *   3. Función eval()   → código JS ofuscado con atob/eval
 *   4. Patrón sources[] → sources:[{file:"..."}]
 *   5. Any https .txt   → URL que contenga /hls/ o master
 */

'use strict';

const cheerio            = require('cheerio');
const { fetchWithRetry } = require('../utils/axiosClient');

/* ── Dominios reconocidos de la familia StreamWish ────────── */
const STREAMWISH_DOMAINS = [
  'streamwish.com',
  'streamwish.to',
  'embedwish.com',
  'wishembed.net',
  'flaswish.com',
  'sfastwish.com',
  'sfastwish.com',
  'wishfast.top',
  'hgcloud.to',        // ← nuevo
  'hgcloud.net',
  'awish.pro',
  'dwish.pro',
  'cilootv.store',
  'bestx.stream',
  'moviesapi.club',
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

/**
 * Intenta decodificar strings base64 anidados en el JS
 * (patrón común en páginas que ofuscan con eval(atob(...)))
 */
function tryDecodeEval(js) {
  const atobMatch = js.match(/atob\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/g);
  if (!atobMatch) return null;

  for (const expr of atobMatch) {
    try {
      const b64 = expr.match(/['"]([A-Za-z0-9+/=]+)['"]/)[1];
      const decoded = Buffer.from(b64, 'base64').toString('utf-8');
      // Busca m3u8 / master.txt en el decoded
      const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+(?:\.m3u8|master\.txt|playlist\.txt|\/hls\/)[^\s"'<>]*/i);
      if (urlMatch) return urlMatch[0];
    } catch { /* ignorar */ }
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
async function extract(url) {
  const embedUrl = normalizeUrl(url);
  const u        = new URL(embedUrl);
  const origin   = u.origin;
  const host     = u.hostname;
  const search   = u.search;

  console.log(`[StreamWish/${host}] 🔍 Accediendo a: ${embedUrl}`);

  let response;
  try {
      response = await fetchWithRetry(embedUrl, {
        referer : 'https://www.google.com/',
        origin,
        timeout: 4000 // 4s timeout para fallar RAPIDISIMO si Cloudflare dropea la conexión
      }, 1); // 1 solo intento
  } catch(e) {
      console.log(`[StreamWish/${host}] 🛡️ Error HTTP/Timeout. Probable bloqueo de Cloudflare. Usando Puppeteer directamente.`);
      throw new Error('Bloqueo HTTP detectado. Requiere Puppeteer.');
  }

  let html = response.data;

  // DETECCIÓN DE CLOUDFLARE EN RENDER
  if (html.includes('Just a moment...') || html.includes('cf-browser-verification') || html.includes('challenge-platform')) {
      console.log(`[StreamWish/${host}] 🛡️ Cloudflare detectado. Saltando mirrors HTTP y usando Puppeteer directamente.`);
      throw new Error('Cloudflare detectado. Requiere Puppeteer.');
  }

  // DETECCIÓN DE LOADING SHELL (SPA)
  if (html.length < 2000 && (html.includes('Page is loading') || html.includes('Redirecting'))) {
    console.log(`[StreamWish/${host}] ⏳ Detectada shell de carga en ${host}. Probando espejos rápidos...`);
    
    const id = u.pathname.split('/').filter(Boolean).pop();
    const mirrors = ['wishembed.net', 'hglamioz.com', 'embedwish.com', 'awish.pro'];
    
    for (const mirror of mirrors) {
      if (mirror === host) continue;
      try {
        const mirrorUrl = `https://${mirror}/e/${id}${u.search}`;
        const mRes = await fetchWithRetry(mirrorUrl, { 
            referer: 'https://google.com/', 
            timeout: 3000 // Intentos rápidos
        }, 1); // ¡SOLO 1 INTENTO PARA EVITAR RETRASOS!
        
        if (mRes.data.includes('Just a moment...') || mRes.data.includes('cf-browser-verification')) {
            console.log(`[StreamWish] 🛡️ Cloudflare en mirror ${mirror}. Abortando mirrors.`);
            throw new Error('CLOUDFLARE_DETECTED'); // Lanza un error específico
        }
        if (mRes.data.length > 5000 && !mRes.data.includes('Page is loading')) {
          html = mRes.data;
          console.log(`[StreamWish] ✅ Éxito con espejo rápido: ${mirror}`);
          break;
        }
      } catch (e) {
          if (e.message === 'CLOUDFLARE_DETECTED') {
              throw new Error('Cloudflare detectado en espejos. Requiere Puppeteer.');
          }
          // Si es timeout, ignora y prueba el siguiente espejo
      }
    }

    // Si aún es shell, intentar el bypass de cookies original
    if (html.length < 2000 && html.includes('Page is loading')) {
        const cookies = response.headers['set-cookie'];
        response = await fetchWithRetry(embedUrl, {
            referer: embedUrl,
            origin,
            headers: { 'Cookie': cookies ? cookies.join('; ') : '' }
        });
        html = response.data;
    }
  }

  const scripts = extractScripts(html);
  console.log(`[StreamWish/${host}] 📄 HTML obtenido (${html.length} bytes), analizando...`);

  /* ── Estrategia 1: jwplayer setup  ─────────────────────── */
  // jwplayer("player").setup({sources:[{file:"..."}]})
  let m = scripts.match(
    /\.setup\s*\(\s*\{[^}]*?sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/is
  );
  if (m && m[1].startsWith('http')) {
    let videoUrl = m[1];
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 1 (jwplayer setup) → ${videoUrl.substring(0, 80)}`);
    return { videoUrl, type: guessType(videoUrl), referer: origin };
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
      return { videoUrl, type: guessType(videoUrl), referer: origin };
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
    return { videoUrl, type: guessType(videoUrl), referer: origin };
  }

  /* ── Estrategia 4: sources array completo ───────────────── */
  m = scripts.match(/sources\s*:\s*\[\s*\{[^[\]]*?file\s*:\s*["'](https?:\/\/[^"']+)/is);
  if (m && m[1]) {
    let videoUrl = m[1];
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 4 (sources[]) → ${videoUrl.substring(0, 80)}`);
    return { videoUrl, type: guessType(videoUrl), referer: origin };
  }

  /* ── Estrategia 5: cualquier URL con /hls/ o .txt en el HTML */
  const hlsInHtml = html.match(/https?:\/\/[^\s"'<>]*(?:\/hls\/|master\.txt|playlist\.txt)[^\s"'<>]*/i);
  if (hlsInHtml) {
    let videoUrl = hlsInHtml[0];
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 5 (HLS en HTML) → ${videoUrl.substring(0, 80)}`);
    return { videoUrl, type: 'm3u8', referer: origin };
  }

  /* ── Estrategia 6: cualquier m3u8 en todo el documento ──── */
  const anyM3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
  if (anyM3u8) {
    let videoUrl = anyM3u8[0];
    if (search && !videoUrl.includes('t=')) {
        videoUrl += (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    console.log(`[StreamWish/${host}] ✅ Estrategia 6 (m3u8 en HTML) → ${videoUrl.substring(0, 80)}`);
    return { videoUrl, type: 'm3u8', referer: origin };
  }

  /* ── No encontrado ─────────────────────────────────────── */
  console.error(`[StreamWish/${host}] ❌ No se encontró ningún enlace de video`);
  console.error(`[StreamWish/${host}] 📋 Primeros 2000 chars del HTML:\n${html.substring(0, 2000)}`);
  throw new Error(`No se pudo extraer el enlace de video de StreamWish (${host}).`);
}

module.exports = { extract, STREAMWISH_DOMAINS };
