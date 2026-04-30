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

/** Mapa proveedor → servicio HTTP (Lazy loaded inside handler) */
let HTTP_SERVICE_MAP = null;

function getServiceMap() {
  if (HTTP_SERVICE_MAP) return HTTP_SERVICE_MAP;
  
  // Lazy require to avoid crashes on Vercel/Serverless
  HTTP_SERVICE_MAP = {
    doodstream  : require('../services/doodstream'),
    streamtape  : require('../services/streamtape'),
    streamwish  : require('../services/streamwish'),
    hgcloud     : require('../services/streamwish'),
    vidhide     : require('../services/vidhide'),
    filemoon    : require('../services/filemoon'),
    voe         : require('../services/voe'),
    dailymotion : require('../services/dailymotion'),
    earvids     : require('../services/earvids'),
    direct      : require('../services/generic'),
    unknown     : require('../services/generic'),
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
      return res.status(400).json({ error: 'La URL proporcionada no es válida.' });
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
      const service = serviceMap[provider] || require('../services/generic');
      result = await service.extract(decodedUrl);
      method = 'http';
    } else {
      // MODO AUTO: Siempre intenta HTTP primero (1s) antes de ir a Puppeteer (15s)
      try {
        const service = serviceMap[provider] || require('../services/generic');
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
    const isHlsTxt        = /\.txt(\?|$)/i.test(result.videoUrl);
    
    const proxyUrl = `/proxy?url=${encodedVideoUrl}&referer=${encodedReferer}${isHlsTxt ? '&forceM3u8=1' : ''}`;

    return res.json({
      videoUrl : result.videoUrl,
      proxyUrl,
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
