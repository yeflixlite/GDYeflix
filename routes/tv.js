/**
 * ============================================================
 *  routes/tv.js
 *  Rutas para extracción de TV en vivo
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

// Mapa de servicios de TV (Lazy Loading)
const TV_SERVICES = {
    'espn2': () => require('../services/envivos/espn2'),
    'tudn' : () => require('../services/envivos/tudn'),
    'tycsports' : () => require('../services/envivos/tycsports'),
    'telemundo' : () => require('../services/envivos/telemundo')
};

/**
 * GET /api/tv/extract?id=<channelId>
 */
router.get('/extract', async (req, res) => {
    const { id } = req.query;

    if (!id || !TV_SERVICES[id]) {
        return res.status(404).json({ error: 'Canal no encontrado o no soportado.' });
    }

    try {
        console.log(`[TV API] Petición para canal: ${id}`);
        const service = TV_SERVICES[id]();
        const result = await service.extract();

        // Construir URL de proxy
        const encodedUrl = encodeURIComponent(result.videoUrl);
        const encodedReferer = encodeURIComponent(result.referer || '');
        const proxyUrl = `/proxy?url=${encodedUrl}&referer=${encodedReferer}`;

        res.json({
            videoUrl: result.videoUrl,
            proxyUrl: proxyUrl,
            type: result.type,
            provider: id
        });

    } catch (err) {
        console.error('[TV API Error]', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
