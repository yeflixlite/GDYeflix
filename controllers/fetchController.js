/**
 * controllers/fetchController.js
 * Proxy HTML ligero para PelisJuanita (sin Puppeteer).
 * Usa axios con headers de navegador real.
 */
'use strict';

const axios = require('axios');

const ALLOWED_DOMAINS = ['pelisjuanita.com'];
const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map();

async function fetchHandler(req, res) {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta url' });

    const target = decodeURIComponent(url);

    let host;
    try { host = new URL(target).hostname.replace('www.', ''); }
    catch { return res.status(400).json({ error: 'URL inválida' }); }

    if (!ALLOWED_DOMAINS.some(d => host.endsWith(d))) {
        return res.status(403).json({ error: 'Dominio no permitido' });
    }

    // Caché simple
    const hit = cache.get(target);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Cache', 'HIT');
        return res.type('html').send(hit.html);
    }

    try {
        const response = await axios.get(target, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Referer': 'https://pelisjuanita.com/',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'same-origin',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
            responseType: 'text',
            maxRedirects: 5,
            timeout: 15_000,
            maxContentLength: 512 * 1024,
            validateStatus: s => s < 500,
        });

        const html = response.data || '';

        cache.set(target, { html, ts: Date.now() });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Cache', 'MISS');
        res.type('html').status(response.status).send(html);

    } catch (err) {
        console.error('[fetch]', err.message);
        res.status(502).json({ error: err.message });
    }
}

module.exports = { fetchHandler };
