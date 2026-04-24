/**
 * ============================================================
 *  controllers/extractController.js
 *  Endpoint dedicado: GET /extract?url=...
 * ============================================================
 */

'use strict';

const { detectProvider }    = require('../utils/urlDetector');
const streamwish            = require('../services/streamwish');
const doodstream            = require('../services/doodstream');
const streamtape            = require('../services/streamtape');
const filemoon              = require('../services/filemoon');
const voe                   = require('../services/voe');
const dailymotion           = require('../services/dailymotion');
const earvids               = require('../services/earvids');
const vidhide               = require('../services/vidhide');
const generic               = require('../services/generic');
const puppeteerExtractor    = require('../services/puppeteerExtractor');

const HTTP_SERVICE_MAP = {
  streamwish,
  hgcloud    : streamwish,
  vidhide,
  doodstream,
  streamtape,
  filemoon,
  voe,
  dailymotion,
  earvids,
  direct     : generic,
  unknown    : generic,
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
      result = await puppeteerExtractor.extract(decodedUrl);
      method = 'puppeteer';
    } else if (mode === 'http') {
      const service = HTTP_SERVICE_MAP[provider] || generic;
      result = await service.extract(decodedUrl);
      method = 'http';
    } else {
      const service = HTTP_SERVICE_MAP[provider] || generic;
      try {
        result = await service.extract(decodedUrl);
        method = 'http';
      } catch (err) {
        result = await puppeteerExtractor.extract(decodedUrl);
        method = 'puppeteer';
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
