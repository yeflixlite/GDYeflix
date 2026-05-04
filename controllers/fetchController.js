/**
 * ============================================================
 *  controllers/fetchController.js
 *  Proxy ultra-ligero para HTML de PelisJuanita.
 *  - Solo permite URLs de pelisjuanita.com (whitelist)
 *  - Solo descarga text/html (rechaza binarios/video/imágenes)
 *  - Límite de tamaño de respuesta: 500KB
 *  - Consumo mínimo de ancho de banda
 * ============================================================
 */
'use strict';

const axios = require('axios');

// Dominios permitidos (whitelist estricta)
const ALLOWED_DOMAINS = ['pelisjuanita.com'];

// Tamaño máximo de respuesta en bytes (500 KB)
const MAX_RESPONSE_SIZE = 500 * 1024;

async function fetchHandler(req, res) {
    try {
        const { url } = req.query;

        if (!url) {
            return res.status(400).json({ error: 'Falta el parámetro url' });
        }

        const decodedUrl = decodeURIComponent(url);

        // Whitelist estricta: solo pelisjuanita.com
        let hostname;
        try {
            hostname = new URL(decodedUrl).hostname.replace('www.', '');
        } catch {
            return res.status(400).json({ error: 'URL inválida' });
        }

        if (!ALLOWED_DOMAINS.some(d => hostname.endsWith(d))) {
            return res.status(403).json({ error: 'Dominio no permitido' });
        }

        const response = await axios.get(decodedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
                'Referer': 'https://pelisjuanita.com/',
                'Cache-Control': 'no-cache',
            },
            // Solo descargar texto, nunca binarios
            responseType: 'text',
            maxRedirects: 5,
            timeout: 15_000,
            // Limite de tamaño: aborta si supera los 500KB
            maxContentLength: MAX_RESPONSE_SIZE,
            validateStatus: (s) => s < 400,
        });

        const contentType = response.headers['content-type'] || '';

        // Rechazar si no es texto/HTML (no queremos servir imágenes ni videos nunca)
        if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
            return res.status(415).json({ error: 'Tipo de contenido no permitido: ' + contentType });
        }

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).send(response.data);

    } catch (err) {
        const status = err.response?.status || 502;
        res.status(status).json({ error: err.message || 'Error al obtener el contenido' });
    }
}

module.exports = { fetchHandler };
