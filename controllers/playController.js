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
const doodstream           = require('../services/doodstream');
const streamtape           = require('../services/streamtape');
const streamwish           = require('../services/streamwish');
const filemoon             = require('../services/filemoon');
const dailymotion          = require('../services/dailymotion');
const generic              = require('../services/generic');
const puppeteerExtractor   = require('../services/puppeteerExtractor');

/** Mapa proveedor → servicio HTTP */
const HTTP_SERVICE_MAP = {
  doodstream,
  streamtape,
  streamwish,
  hgcloud  : streamwish,
  vidhide  : streamwish,
  filemoon,
  dailymotion,
  direct   : generic,
  unknown  : generic,
};

/** Proveedores que intentamos primero con Puppeteer por ser SPAs agresivos */
const PUPPETEER_FIRST = new Set(['hgcloud']);

/**
 * GET /play?url=<encoded-url>
 * Responde con JSON: { videoUrl, proxyUrl, type, provider }
 */
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

    const provider     = detectProvider(decodedUrl);
    const usePuppeteer = PUPPETEER_FIRST.has(provider);

    console.log(`\n[Play] Proveedor detectado: ${provider} → ${decodedUrl}`);

    let result = null;
    let method = null;

    // Lógica de extracción con fallback robusto
    if (mode === 'puppeteer') {
      result = await puppeteerExtractor.extract(decodedUrl);
      method = 'puppeteer';
    } else if (mode === 'http') {
      const service = HTTP_SERVICE_MAP[provider] || generic;
      result = await service.extract(decodedUrl);
      method = 'http';
    } else {
      // Modo AUTO: Intenta HTTP, si falla va a Puppeteer
      if (usePuppeteer) {
        try {
          result = await puppeteerExtractor.extract(decodedUrl);
          method = 'puppeteer';
        } catch {
          const service = HTTP_SERVICE_MAP[provider] || generic;
          result = await service.extract(decodedUrl);
          method = 'http';
        }
      } else {
        try {
          const service = HTTP_SERVICE_MAP[provider] || generic;
          result = await service.extract(decodedUrl);
          method = 'http';
        } catch (err) {
          console.warn(`[Play] HTTP falló para ${provider}, intentando Puppeteer...`);
          result = await puppeteerExtractor.extract(decodedUrl);
          method = 'puppeteer';
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
