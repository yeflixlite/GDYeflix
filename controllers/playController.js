/**
 * ============================================================
 *  controllers/playController.js
 *  Orquesta la detección del proveedor y llama al servicio
 *  correcto para obtener el enlace real del video.
 *  JSON response endpoint.
 * ============================================================
 */

'use strict';

const { detectProvider }   = require('../utils/urlDetector');
const { tryExpandShortcut } = require('../utils/shortcut');

/** Mapa proveedor → servicio HTTP (Lazy loaded inside handler) */
let HTTP_SERVICE_MAP = null;

function getServiceMap() {
  if (HTTP_SERVICE_MAP) return HTTP_SERVICE_MAP;
  
  // Lazy require to avoid crashes on Vercel/Serverless
  HTTP_SERVICE_MAP = {
    streamwish  : require('../services/streamwish'),
    hgcloud     : require('../services/streamwish'),
    vidhide     : require('../services/vidhide'),
    filemoon    : require('../services/filemoon'),
    voe         : require('../services/voe'),
    nupload     : require('../services/nupload'),
  };
  return HTTP_SERVICE_MAP;
}

/** Mapa proveedor → servicio HTTP */
async function playHandler(req, res, next) {
  try {
    const { url, mode = 'auto' } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Parámetro "url" requerido.' });
    }

    let decodedUrl;
    try {
      decodedUrl = decodeURIComponent(url);
      new URL(decodedUrl);
    } catch {
      // Atajo "proveedor=ID" (ej. streamwish=abc123, vidhide=xyz789)
      const expanded = tryExpandShortcut(decodeURIComponent(url));
      if (!expanded) {
        return res.status(400).json({ error: 'La URL proporcionada no es válida.' });
      }
      decodedUrl = expanded;
    }

    const serviceMap = getServiceMap();
    const provider = detectProvider(decodedUrl);

    console.log(`\n[Play] Proveedor detectado: ${provider} → ${decodedUrl}`);

    let result = null;
    let method = null;

    // Lógica de extracción optimizada para VELOCIDAD
    if (mode === 'puppeteer') {
      const puppeteerExtractor = require('../services/puppeteerExtractor');
      result = await puppeteerExtractor.extract(decodedUrl);
      method = 'puppeteer';
    } else if (mode === 'http') {
      const service = serviceMap[provider];
      if (!service) throw new Error(`Proveedor HTTP no soportado: ${provider}`);
      result = await service.extract(decodedUrl);
      method = 'http';
    } else {
      // MODO AUTO: Siempre intenta HTTP primero (1s) antes de ir a Puppeteer (15s)
      try {
        const service = serviceMap[provider];
        if (!service) throw new Error(`Proveedor HTTP no soportado: ${provider}`);
        result = await service.extract(decodedUrl);
        method = 'http';
      } catch (err) {
        // Si el servicio ya usa Puppeteer por dentro y falló, no tiene sentido usar el genérico 
        if (provider === 'doodstream') {
            throw new Error(`Fallo en la extracción dedicada: ${err.message}`);
        }

        console.warn(`[Play] HTTP falló para ${provider}, intentando Puppeteer como fallback...`);
        try {
          const puppeteerExtractor = require('../services/puppeteerExtractor');
          result = await puppeteerExtractor.extract(decodedUrl);
          method = 'puppeteer';
        } catch (puppErr) {
          // Si falla el require de puppeteer (en Vercel por ejemplo)
          if (puppErr.message.includes('Cannot find module')) {
             throw new Error(`Fallo en HTTP: ${err.message}. Puppeteer no está disponible en este servidor.`);
          }
          throw new Error(`Fallo total. HTTP: ${err.message}. Puppeteer: ${puppErr.message}`);
        }
      }
    }

    // Construye la URL de proxy (relativa para evitar problemas de HTTPS/Mixed Content)
    const encodedVideoUrl = encodeURIComponent(result.videoUrl);
    const encodedReferer  = encodeURIComponent(result.referer || '');
    const encodedCookie   = encodeURIComponent(result.cookie || '');
    const isHlsTxt        = /\.txt(\?|$)/i.test(result.videoUrl);
    // wrapLevel: cuando el servicio indica que el m3u8 es single-level (sin #EXT-X-STREAM-INF)
    // el proxy generará un master sintético con la calidad indicada (ej. "720p")
    const wrapParam       = result.wrapLevel ? `&wrapM3u8=${encodeURIComponent(result.wrapLevel)}` : '';
    // streamwish/hgcloud: el espejo /stream/ es intermitente. El proxy necesita
    // saber el proveedor (para el reenvío XFF) y el embed original (para poder
    // re-extraer en caliente si el manifest cae con ECONNABORTED/404).
    const swParams =
      (provider === 'streamwish' || provider === 'hgcloud')
        ? `&provider=streamwish&embed_url=${encodeURIComponent(decodedUrl)}`
        : '';
    
    let proxyUrl = `/proxy?url=${encodedVideoUrl}&referer=${encodedReferer}${encodedCookie ? `&cookie=${encodedCookie}` : ''}${isHlsTxt ? '&forceM3u8=1' : ''}${wrapParam}${swParams}`;

    // ÓPTIMO DE BANDA (VidHide / Filemoon): el proveedor ya
    // entrega un HLS/m3u8 completo y reproducible, así que el reproductor puede
    // consumir ese HLS DIRECTAMENTE desde el CDN del proveedor (sus segmentos NO
    // pasan por Vercel, Data Transfer ≈ 0). El proxy solo se usa como respaldo si
    // el navegador bloquea el directo (CORS/403/tokens).
    //
    // VOE excluido (16/09/2026): su CDN *.cloudwindow-route.com ya NO responde
    // Access-Control-Allow-Origin desde el navegador y los tokens quedan ligados
    // a la IP del servidor → 403/CORS en directo. Todo el tráfico VOE pasa por
    // /proxy (con hot-swap en caso de 403).
    //
    // StreamWish/HGCloud excluido (25/09/2026): sus CDNs (premilkyway.com,
    // auronamedicalgroup.*, digitalstorehouse.*, ...) usan TLS-fingerprinting
    // que bloquea peticiones del servidor y ya no envían ACAO al navegador. Y el
    // espejo /stream/ tampoco envía ACAO → TODO el tráfico pasa por /proxy con
    // las cookies (file_id/aff/ref_url) y el referer del espejo.
    //
    // VidHide: m3u8 absoluto de dramiyos-cdn.com (ACAO: * y sin exigencia de
    // referer) → directo OK.
    // Filemoon: m3u8 de *.r66nv9ed.com (ACAO: * en master/variante/segmento,
    // sin cifrado EXT-X-KEY) → directo OK.
    const directPlay =
      (provider === 'vidhide'    || provider === 'filemoon') &&
      result.type === 'm3u8';

    // ── FIN DE LÓGICA INLINE BYPASS (REMOVIDO POR CORS/RELATIVE_PATH ISSUES) ──

    return res.json({
      videoUrl : result.videoUrl,
      proxyUrl,
      directPlay,
      type     : result.type,
      provider,
      method,
    });

  } catch (err) {
    console.error('[Play Error]', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { playHandler };
