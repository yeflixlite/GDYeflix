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
const { getMediaHeaders, getBrowserHeaders } = require('../utils/browserHeaders');

// CONFIGURACIÓN DE AHORRO DE BANDA
// Si es 'false', los segmentos (.ts) se cargarán directo del CDN original.
// Esto ahorra el 95% del ancho de banda del servidor.
const PROXY_SEGMENTS = process.env.PROXY_SEGMENTS === 'true'; 
const IS_PROD = process.env.NODE_ENV === 'production';

// Lista de dominios que permiten carga directa (CORS abierto sin IP-binding)
// NOTA: Si un dominio bloquea por CORS en el navegador, NO debe estar aquí.
const DIRECT_DOMAINS = [
    // NOTA: VOE (*.cloudwindow-route.com) fue RETIRADO de esta lista (16/09/2026):
    // el CDN ya no envía Access-Control-Allow-Origin desde el navegador y los
    // tokens quedan ligados a la IP del servidor (403/CORS en directo). El
    // tráfico VOE DEBE pasar por el proxy (hot-swap incluido).
    // Filemoon CDN: *.r66nv9ed.com responde ACAO: * en master/variante/segmentos
    // sin cifrado EXT-X-KEY → se puede saltar el proxy.
    'r66nv9ed.com',
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

function rewriteM3u8(content, originalUrl, proxyBase, referer, cookie, embedUrl = '') {
  const encodedReferer = encodeURIComponent(referer || '');
  const encodedCookie  = cookie ? `&cookie=${encodeURIComponent(cookie)}` : '';
  const encodedEmbed   = embedUrl ? `&embed_url=${encodeURIComponent(embedUrl)}` : '';
  
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
      
      return `${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}${encodedCookie}${encodedEmbed}`;
    }
  );

  // 2. Atributos URI (Audio, Key, etc.)
  rewritten = rewritten.replace(
    /URI=["']([^"']+)["']/g,
    (match, captured) => {
      const abs = resolveUrl(captured, originalUrl);
      return `URI="${proxyBase}?url=${encodeURIComponent(abs)}&referer=${encodedReferer}${encodedCookie}${encodedEmbed}&forceM3u8=1"`;
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
async function fetchUpstream(url, headers, timeout, req, retries = 1, retryDelayMs = 0) {
    const controller = new AbortController();

    if (req) {
        req.on('close', () => {
            controller.abort();
        });
    }

    const config = {
        headers,
        responseType: 'stream',
        httpAgent,
        httpsAgent,
        maxRedirects: 10,
        timeout,
        signal: controller.signal,
        validateStatus: (status) => status < 400 || status === 403,
    };

    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await axios.get(url, config);
        } catch (err) {
            if (axios.isCancel(err)) throw err;
            lastErr = err;
            if (attempt < retries) {
                if (!IS_PROD) console.log(`[Proxy] ⚠️ Reintentando (${attempt + 1}/${retries}): ${url.substring(0, 60)}...`);
                // Los espejos /stream/ de StreamWish caen respuestas en ráfagas:
                // un breve lapso entre reintentos ayuda a esquivar el throttling.
                if (retryDelayMs > 0) await new Promise(r => setTimeout(r, retryDelayMs));
            }
        }
    }
    throw lastErr;
}

// Hot-Swap de StreamWish: re-extrae el embed (FORZANDO página fresca para
// saltarse la caché) y devuelve un fetch nuevo con la URL/cookie/referer nuevos.
// Se usa cuando un manifest cae (ECONNABORTED/404) o cuando llega un playlist
// "solo-anuncios" (castigo anti-bot del espejo /stream/).
async function streamwishHotSwap(swEmbedUrl, curUrl, curCookie, curReferer, effReferer, req, timeout) {
  const swService = require('../services/streamwish');
  const swResult = await swService.extract(swEmbedUrl, true);
  if (!swResult || !swResult.videoUrl) throw new Error('re-extracción sin videoUrl');

  const wasSame = swResult.videoUrl === curUrl;
  console.log(`[Proxy] ✅ ${wasSame ? 'Re-extracción dio la misma URL' : 'Re-extracción fresca obtenida'}. Reintentando manifest...`);

  curUrl = swResult.videoUrl;
  if (swResult.cookie)   curCookie = swResult.cookie;
  if (swResult.referer)  { curReferer = swResult.referer; effReferer = swResult.referer; }

  let newOrigin = '';
  try { newOrigin = new URL(curUrl).origin; } catch {}
  if (/premilkyway/i.test(curUrl)) newOrigin = '';
  const newHeaders = getMediaHeaders(effReferer, newOrigin);
  if (curCookie) newHeaders['Cookie'] = curCookie;
  if (req.headers['x-forwarded-for']) newHeaders['X-Forwarded-For'] = req.headers['x-forwarded-for'];
  if (req.headers['x-real-ip'])       newHeaders['X-Real-IP']       = req.headers['x-real-ip'];

  // Si el espejo es el mismo y sigue throttled, dar 2.5s de respiro
  if (wasSame) await new Promise(r => setTimeout(r, 2500));

  const upstream = await fetchUpstream(curUrl, newHeaders, timeout, req, 2, 1200);
  // Último intento: si premilkyway aún responde 403 (o devuelve algo que no es
  // un manifest), repetir con headers de navegador en modo documento (sin
  // Origin): exactamente el perfil del probe base que sí pasa su WAF.
  if (upstream.status === 403 || !String(upstream.data || '').includes('#EXTM3U')) {
    console.log(`[Proxy] 🔁 Hot-Swap: reintento con headers de navegador (documento) tras ${upstream.status}`);
    const docHeaders = getBrowserHeaders(effReferer, '');
    if (curCookie) docHeaders['Cookie'] = curCookie;
    const u2 = await fetchUpstream(curUrl, docHeaders, timeout, req, 1, 0)
      .catch(err => ({ status: 0, data: '', statusText: err.message }));
    if (u2.status >= 200 && u2.status < 300 && String(u2.data || '').includes('#EXTM3U')) {
      return { upstream: u2, decodedUrl: curUrl, decodedCookie: curCookie, decodedReferer: curReferer, effectiveReferer: effReferer };
    }
    return { upstream, decodedUrl: curUrl, decodedCookie: curCookie, decodedReferer: curReferer, effectiveReferer: effReferer };
  }
  return { upstream, decodedUrl: curUrl, decodedCookie: curCookie, decodedReferer: curReferer, effectiveReferer: effReferer };
}

async function proxyHandler(req, res, next) {
  try {
    const { url, referer = '', cookie = '', forceM3u8 = '0', wrapM3u8 = '', provider = '', embed_url = '' } = req.query;

    if (!url) return res.status(400).end();

    let decodedUrl       = decodeURIComponent(url);
    let decodedReferer   = referer ? decodeURIComponent(referer) : '';
    let decodedCookie    = cookie ? decodeURIComponent(cookie) : '';
    
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
    let effectiveReferer = decodedReferer || targetOrigin;
    // premilkyway (CDN hls2/hls3): un navegador jamás enviaría Origin con su
    // propio dominio; IP de datacenter + Origin artificial dispara su WAF (403).
    // Solo el Referer https://streamwish.to es necesario.
    if (/premilkyway/i.test(decodedUrl)) targetOrigin = '';
    const headers = getMediaHeaders(effectiveReferer, targetOrigin);
    if (decodedCookie) {
      headers['Cookie'] = decodedCookie;
    }
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    // StreamWish: los espejos /stream/ y los CDNs son sensibles a la IP real
    // del cliente (rate-limit de "IP dual"): reenviamos la IP desde Vercel.
    // En VOE estropea la comprobación de IP y causa 403, por eso solo aquí.
    const isStreamwish =
      provider === 'streamwish' ||
      /streamwish|hgcloud|premilkyway|auronamedicalgroup|digitalstorehouse|goldenfieldcreativeworks/.test(decodedUrl) ||
      /streamwish|hgcloud/.test(decodedReferer);
    if (isStreamwish) {
      if (req.headers['x-forwarded-for']) headers['X-Forwarded-For'] = req.headers['x-forwarded-for'];
      if (req.headers['x-real-ip'])       headers['X-Real-IP']       = req.headers['x-real-ip'];
    }

    // ── MEJORA 3: Timeout diferenciado ───────────────────────
    // M3U8/playlists son archivos pequeños → fallar rápido (8s)
    // Segmentos de video pueden ser pesados → más tiempo (15s)
    const isSegment = decodedUrl.includes('.ts') || 
                      decodedUrl.includes('.m4s') ||
                      decodedUrl.includes('.mp4');
    const timeout = isM3u8Request ? (isStreamwish ? 20_000 : 8_000) : (isSegment ? 15_000 : 20_000);

    let upstream;
    try {
      // StreamWish: más reintentos (3) y con un lapso entre ellos para esquivar
      // el throttling por ráfagas del espejo /stream/.
      upstream = await fetchUpstream(decodedUrl, headers, timeout, req, isStreamwish ? 3 : 1, isStreamwish ? 1200 : 0);
    } catch (upstreamErr) {
      // StreamWish: los espejos /stream/ (playnixes/hglamioz/medixiru) responden en
      // ráfagas agresivas (ECONNABORTED/404 ~50%). Si un manifest cae, re-extraemos
      // el embed original (FORZANDO página fresca para saltarnos la caché) y
      // reintentamos con una URL de stream nueva (Hot-Swap), igual que con VOE.
      const swEmbedUrl = embed_url ? decodeURIComponent(embed_url) : '';
      if (isStreamwish && isM3u8Request && swEmbedUrl) {
        console.log(`[Proxy] ⚠️ Fallo de StreamWish en manifest (${upstreamErr.code || upstreamErr.message}). Hot-Swap...`);
        try {
          const hs = await streamwishHotSwap(swEmbedUrl, decodedUrl, decodedCookie, decodedReferer, effectiveReferer, req, timeout);
          decodedUrl = hs.decodedUrl; decodedCookie = hs.decodedCookie;
          decodedReferer = hs.decodedReferer; effectiveReferer = hs.effectiveReferer;
          upstream = hs.upstream;
        } catch (retryErr) {
          console.error(`[Proxy] ❌ Falló el Hot-Swap de StreamWish:`, retryErr.message);
          throw retryErr;
        }
      } else {
        throw upstreamErr;
      }
    }

    // ── RE-EXTRACCIÓN PARA VOE (ERROR 403 IP-BINDING M3U8 y TS) ──
    if (upstream.status === 403) {
        const { detectProvider } = require('../utils/urlDetector');
        // StreamWish/HGCloud: premilkyway *.hls2 responde 403 a veces (nodos que
        // rotan y rechazan IPs de datacenter). Hot-swap: força re-extracción
        // fresca (token/nodo nuevos) y reintenta el manifest antes de rendirse.
        if (isStreamwish && isM3u8Request && embed_url) {
            console.log(`[Proxy] ⚠️ Error 403 en manifest StreamWish. Hot-Swap...`);
            try {
                const hs = await streamwishHotSwap(decodeURIComponent(embed_url), decodedUrl, decodedCookie, decodedReferer, effectiveReferer, req, timeout);
                decodedUrl = hs.decodedUrl; decodedCookie = hs.decodedCookie;
                decodedReferer = hs.decodedReferer; effectiveReferer = hs.effectiveReferer;
                upstream = hs.upstream;
            } catch (retryErr) {
                console.error(`[Proxy] ❌ Falló el Hot-Swap de StreamWish por 403:`, retryErr.message);
                throw retryErr;
            }
        } else if (detectProvider(effectiveReferer) === 'voe' || detectProvider(decodedUrl) === 'voe') {
            console.log(`[Proxy] ⚠️ Error 403 en VOE para ${isM3u8Request ? 'M3U8' : 'Fragmento TS'}. Iniciando re-extracción en caliente (Hot-Swap)...`);
            try {
                const voeService = require('../services/voe');
                
                // Extraer el ID real del video de la URL del CDN si es posible
                let extractTarget = effectiveReferer;
                const videoIdMatch = decodedUrl.match(/\/([a-zA-Z0-9]+)_[a-zA-Z0-9,]*\.urlset\//);
                if (videoIdMatch && videoIdMatch[1]) {
                    extractTarget = 'https://voe.sx/e/' + videoIdMatch[1];
                    console.log(`[Proxy] 🔍 ID de VOE detectado en la URL: ${videoIdMatch[1]}`);
                }

                const result = await voeService.extract(extractTarget);
                
                if (result && result.videoUrl) {
                    if (isM3u8Request) {
                        // Es un M3U8 maestro, usamos la nueva URL entera
                        if (result.videoUrl !== decodedUrl) {
                            console.log(`[Proxy] ✅ Re-extracción M3U8 exitosa. Reintentando...`);
                            decodedUrl = result.videoUrl;
                            let newOrigin = '';
                            try { newOrigin = new URL(decodedUrl).origin; } catch {}
                            const newHeaders = getMediaHeaders(effectiveReferer, newOrigin);
                            upstream = await fetchUpstream(decodedUrl, newHeaders, timeout, req);
                        }
                    } else if (isSegment) {
                        // Es un fragmento TS. Hacemos HOT-SWAPPING de los tokens del query string
                        const newMasterUrl = new URL(result.videoUrl);
                        const oldSegmentUrl = new URL(decodedUrl);
                        
                        // Mantenemos la ruta del segmento viejo pero le inyectamos los tokens criptográficos nuevos
                        oldSegmentUrl.search = newMasterUrl.search;
                        decodedUrl = oldSegmentUrl.toString();
                        
                        console.log(`[Proxy] ✅ Hot-Swap de TS exitoso. Reintentando fragmento con nueva IP local...`);
                        let newOrigin = '';
                        try { newOrigin = new URL(decodedUrl).origin; } catch {}
                        const newHeaders = getMediaHeaders(effectiveReferer, newOrigin);
                        upstream = await fetchUpstream(decodedUrl, newHeaders, timeout, req);
                    }
                }
            } catch (retryErr) {
                console.error(`[Proxy] ❌ Falló el Hot-Swap de VOE:`, retryErr.message);
            }
        }
    }

    const isM3u8 = isM3u8Request || 
                   (upstream.headers['content-type'] || '').includes('mpegurl') ||
                   forceM3u8 === '1';

    // Para VOE, si después del reintento sigue siendo 403 y enviando HTML, cortamos aquí
    if (upstream.status === 403 && isM3u8) {
        return res.status(403).end();
    }

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

    // Recopilar el cuerpo M3U8 y procesarlo (con lazo anti-anuncios de StreamWish)
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('X-Cache', 'MISS');
    const swEmbedUrl = embed_url ? decodeURIComponent(embed_url) : '';

    let processed = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = await readBody(upstream.data);

      // ── VALIDACIÓN ESTRICTA M3U8 (Evitar parsear HTML de error) ──
      if (!body.includes('#EXTM3U')) {
        console.error(`[Proxy] ❌ Contenido M3U8 Inválido (Posible 403 HTML oculto).`);
        if (isStreamwish && swEmbedUrl && attempt === 0) {
          console.log(`[Proxy] ⚠️ Manifest StreamWish inválido. Hot-Swap...`);
          try {
            const hs = await streamwishHotSwap(swEmbedUrl, decodedUrl, decodedCookie, decodedReferer, effectiveReferer, req, timeout);
            decodedUrl = hs.decodedUrl; decodedCookie = hs.decodedCookie;
            decodedReferer = hs.decodedReferer; effectiveReferer = hs.effectiveReferer;
            upstream = hs.upstream;
            continue;
          } catch (retryErr) {
            console.error(`[Proxy] ❌ Falló Hot-Swap por manifest inválido:`, retryErr.message);
          }
        }
        return res.end(); // Retorna vacío en lugar de enviar basura
      }

      // StreamWish anti-bot: puede responder un playlist válido pero de SOLO
      // anuncios (tiktokcdn) cuando castiga la IP. Lo detectamos y hot-swaperamos.
      if (body.includes('#EXTINF') && isStreamwish && swEmbedUrl && attempt === 0) {
        const mediaLines = body.split('\n').filter(l => l && !l.startsWith('#'));
        const realLines  = mediaLines.filter(l => !AD_BLOCKLIST.some(d => l.includes(d)));
        if (mediaLines.length > 0 && realLines.length === 0) {
          console.log(`[Proxy] ⚠️ Manifest StreamWish solo-anuncios (${mediaLines.length} líneas). Hot-Swap...`);
          try {
            const hs = await streamwishHotSwap(swEmbedUrl, decodedUrl, decodedCookie, decodedReferer, effectiveReferer, req, timeout);
            decodedUrl = hs.decodedUrl; decodedCookie = hs.decodedCookie;
            decodedReferer = hs.decodedReferer; effectiveReferer = hs.effectiveReferer;
            upstream = hs.upstream;
            continue;
          } catch (retryErr) {
            console.error(`[Proxy] ❌ Falló Hot-Swap por playlist de anuncios:`, retryErr.message);
          }
        }
      }

      processed = rewriteM3u8(body, decodedUrl, '/proxy', decodedReferer, decodedCookie, swEmbedUrl);
      break;
    }

    if (processed === null) return res.end();
    // wrapM3u8: Si el m3u8 es una playlist de un solo nivel (sin #EXT-X-STREAM-INF),
    // lo envolvemos en un master sintético para que el reproductor muestre la calidad correcta.
    {
      if (wrapM3u8 && processed.includes('#EXTINF') && !processed.includes('#EXT-X-STREAM-INF')) {
        const levelName = decodeURIComponent(wrapM3u8);  // ej. "720p"
        const resMap    = { '1080p': '1920x1080', '720p': '1280x720', '480p': '854x480', '360p': '640x360' };
        const res2      = resMap[levelName] || '1280x720';
        const bwMap     = { '1080p': '4000000', '720p': '2000000', '480p': '1000000', '360p': '500000' };
        const bw        = bwMap[levelName] || '2000000';
        // La playlist real ya está reescrita con rutas de proxy; la apuntamos directamente
        const innerUrl  = `/proxy?url=${encodeURIComponent(decodedUrl)}&referer=${encodeURIComponent(decodedReferer)}${decodedCookie ? `&cookie=${encodeURIComponent(decodedCookie)}` : ''}${swEmbedUrl ? `&embed_url=${encodeURIComponent(swEmbedUrl)}` : ''}&forceM3u8=1`;
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
    }

    sendCompressed(req, res, processed);

  } catch (err) {
    if (!res.headersSent) res.status(404).end();
  }
}

/** Lee un stream de axios completo y devuelve su contenido como string. */
function readBody(stream) {
  return new Promise((resolve, reject) => {
    let data = '';
    stream.on('data', chunk => { data += chunk; });
    stream.on('end', () => resolve(data));
    stream.on('error', reject);
  });
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
