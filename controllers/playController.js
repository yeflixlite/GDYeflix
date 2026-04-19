/**
 * ============================================================
 *  controllers/playController.js
 *  Orquesta la detección del proveedor y llama al servicio
 *  correcto para obtener el enlace real del video.
 * ============================================================
 */

'use strict';

const { detectProvider }  = require('../utils/urlDetector');
const doodstream          = require('../services/doodstream');
const streamtape          = require('../services/streamtape');
const streamwish          = require('../services/streamwish');
const filemoon            = require('../services/filemoon');
const dailymotion         = require('../services/dailymotion');
const generic             = require('../services/generic');

/** Mapa proveedor → servicio */
const SERVICE_MAP = {
  doodstream,
  streamtape,
  streamwish,
  hgcloud  : streamwish,   // hgcloud.to es familia StreamWish
  vidhide  : streamwish,   // mismo patrón HTML que Streamwish
  filemoon,
  dailymotion,
  direct   : generic,
  unknown  : generic,
};


/**
 * GET /play?url=<encoded-url>
 *
 * Responde con JSON:
 * {
 *   videoUrl : string,   // URL real del video
 *   proxyUrl : string,   // URL de /proxy listo para usar
 *   type     : string,   // 'mp4' | 'm3u8'
 *   provider : string,   // proveedor detectado
 * }
 */
async function playHandler(req, res, next) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Parámetro "url" requerido.' });
    }

    // Valida que sea una URL real
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch {
      return res.status(400).json({ error: 'La URL proporcionada no es válida.' });
    }

    const provider = detectProvider(url);
    console.log(`\n[Play] Proveedor detectado: ${provider} → ${url}`);

    const service = SERVICE_MAP[provider] || generic;

    // Extrae el enlace real (siempre fresco, nunca cacheado)
    const result = await service.extract(url);

    // Construye la URL de proxy que usará el frontend
    const encodedVideoUrl = encodeURIComponent(result.videoUrl);
    const encodedReferer  = encodeURIComponent(result.referer || '');
    const proxyUrl = `${req.protocol}://${req.get('host')}/proxy?url=${encodedVideoUrl}&referer=${encodedReferer}`;

    return res.json({
      videoUrl : result.videoUrl,
      proxyUrl,
      type     : result.type,
      provider,
    });

  } catch (err) {
    console.error('[Play Error]', err.message);
    next(err);
  }
}

module.exports = { playHandler };
