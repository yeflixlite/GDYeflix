/**
 * ============================================================
 *  controllers/extractController.js
 *  Endpoint dedicado: GET /extract?url=...
 * ============================================================
 */

'use strict';

const { detectProvider }    = require('../utils/urlDetector');
const streamwish            = require('../services/streamwish');
const filemoon              = require('../services/filemoon');
const voe                   = require('../services/voe');
const vidhide               = require('../services/vidhide');


const HTTP_SERVICE_MAP = {
  streamwish,
  hgcloud    : streamwish,
  vidhide,
  filemoon,
  voe,
};

async function extractHandler(req, res, next) {
  try {
    const { url, mode = 'auto' } = req.query;

    if (!url) {
      return res.status(400).json({ ok: false, error: 'Parámetro "url" requerido.' });
    }

    let decodedUrl;
    try {
      decodedUrl = decodeURIComponent(url);
      new URL(decodedUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'La URL proporcionada no es válida.' });
    }

    const provider = detectProvider(decodedUrl);

    let result  = null;
    let method  = null;

    if (mode === 'puppeteer') {
      const puppeteerExtractor = require('../services/puppeteerExtractor');
      result = await puppeteerExtractor.extract(decodedUrl);
      method = 'puppeteer';
    } else if (mode === 'http') {
      const service = HTTP_SERVICE_MAP[provider];
      if (!service) throw new Error(`Proveedor HTTP no soportado: ${provider}`);
      result = await service.extract(decodedUrl);
      method = 'http';
    } else {
      const service = HTTP_SERVICE_MAP[provider];
      try {
        if (!service) throw new Error(`Proveedor HTTP no soportado: ${provider}`);
        result = await service.extract(decodedUrl);
        method = 'http';
      } catch (err) {
        console.warn(`[Extract] HTTP falló para ${provider}, intentando Puppeteer...`);
        try {
          const puppeteerExtractor = require('../services/puppeteerExtractor');
          result = await puppeteerExtractor.extract(decodedUrl);
          method = 'puppeteer';
        } catch (puppErr) {
          throw puppErr;
        }
      }
    }

    const { videoUrl, type, referer = '' } = result;

    const isHlsTxt = /\.txt(\?|$)/i.test(videoUrl) &&
                     (type === 'm3u8' || /\/hls\/|master|playlist/i.test(videoUrl));

    // SOLUCIÓN DEFINITIVA: Usar ruta relativa. 
    // Esto evita que el navegador se queje de Mixed Content (HTTP vs HTTPS).
    const proxyUrl = `/proxy?url=${encodeURIComponent(videoUrl)}` +
                     `&referer=${encodeURIComponent(referer)}` +
                     (isHlsTxt ? '&forceM3u8=1' : '');

    return res.json({
      ok: true,
      videoUrl,
      proxyUrl,
      type,
      provider,
      isHlsTxt,
      method,
    });

  } catch (err) {
    console.error('[Extract Error]', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = { extractHandler };
