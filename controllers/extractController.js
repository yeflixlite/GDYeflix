/**
 * ============================================================
 *  controllers/extractController.js
 *  Endpoint dedicado: GET /extract?url=...
 *
 *  Estrategia de extracción:
 *  1. Intenta el servicio HTTP rápido (streamwish.js / generic.js)
 *  2. Si falla → fallback automático con Puppeteer (navegador real)
 * ============================================================
 */

'use strict';

const { detectProvider }    = require('../utils/urlDetector');
const streamwish            = require('../services/streamwish');
const doodstream            = require('../services/doodstream');
const streamtape            = require('../services/streamtape');
const filemoon              = require('../services/filemoon');
const dailymotion           = require('../services/dailymotion');
const generic               = require('../services/generic');
const puppeteerExtractor    = require('../services/puppeteerExtractor');

/** Mapa rápido HTTP (sin navegador) */
const HTTP_SERVICE_MAP = {
  streamwish,
  hgcloud    : streamwish,
  vidhide    : streamwish,
  doodstream,
  streamtape,
  filemoon,
  dailymotion,
  direct     : generic,
  unknown    : generic,
};

/**
 * Proveedores que nacesitan Puppeteer como primera opción
 * (sitios con JS challenge / Cloudflare JS).
 * Se sigue intentando HTTP primero, Puppeteer solo como fallback.
 */
const PUPPETEER_FIRST = new Set(['hgcloud']);

/**
 * GET /extract?url=<encoded-url>[&mode=http|puppeteer|auto]
 *
 * mode=auto      (default) → HTTP primero, Puppeteer si falla
 * mode=http      → solo HTTP (rápido, puede fallar en JS sites)
 * mode=puppeteer → Puppeteer directo (lento pero seguro)
 *
 * Respuesta JSON:
 * {
 *   ok         : true,
 *   videoUrl   : "https://cdn.../master.txt",
 *   proxyUrl   : "http://localhost:3000/proxy?url=...&referer=...",
 *   type       : "m3u8",
 *   provider   : "hgcloud",
 *   isHlsTxt   : true,
 *   method     : "puppeteer" | "http"
 * }
 */
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

    const provider     = detectProvider(decodedUrl);
    const usePuppeteer = PUPPETEER_FIRST.has(provider);

    console.log(`\n[Extract] Proveedor: ${provider} | Modo: ${mode} | puppeteerFirst: ${usePuppeteer}`);
    console.log(`[Extract] URL: ${decodedUrl}`);

    let result  = null;
    let method  = null;
    let lastErr = null;

    // ── Modo Puppeteer directo ───────────────────────────────
    if (mode === 'puppeteer') {
      result = await puppeteerExtractor.extract(decodedUrl);
      method = 'puppeteer';

    // ── Modo HTTP directo ────────────────────────────────────
    } else if (mode === 'http') {
      const service = HTTP_SERVICE_MAP[provider] || generic;
      result = await service.extract(decodedUrl);
      method = 'http';

    // ── Modo auto: HTTP → Puppeteer si falla ─────────────────
    } else {
      const service = HTTP_SERVICE_MAP[provider] || generic;

      try {
        console.log(`[Extract] 🌐 Intentando extracción HTTP...`);
        result = await service.extract(decodedUrl);
        method = 'http';
        console.log(`[Extract] ✅ HTTP exitoso`);
      } catch (err) {
        lastErr = err;
        console.warn(`[Extract] ⚠ HTTP falló: ${err.message}`);
        console.log(`[Extract] 🤖 Cambiando a Puppeteer...`);

        result = await puppeteerExtractor.extract(decodedUrl);
        method = 'puppeteer';
        console.log(`[Extract] ✅ Puppeteer exitoso`);
      }
    }

    const { videoUrl, type, referer = '' } = result;

    // Detecta si el enlace es un .txt que actúa como m3u8
    const isHlsTxt = /\.txt(\?|$)/i.test(videoUrl) &&
                     (type === 'm3u8' || /\/hls\/|master|playlist/i.test(videoUrl));

    // Construye proxyUrl
    const proxyUrl = `${req.protocol}://${req.get('host')}/proxy` +
      `?url=${encodeURIComponent(videoUrl)}` +
      `&referer=${encodeURIComponent(referer)}` +
      (isHlsTxt ? '&forceM3u8=1' : '');

    console.log(`[Extract] ✔ method=${method} type=${type} isHlsTxt=${isHlsTxt}`);
    console.log(`[Extract] ✔ videoUrl: ${videoUrl.substring(0, 100)}`);

    return res.json({
      ok       : true,
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
