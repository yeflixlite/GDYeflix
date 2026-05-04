/**
 * ============================================================
 *  controllers/fetchController.js
 *  Proxy HTML para PelisJuanita.
 *  Usa Puppeteer-extra-stealth para pasar el WAF de Cloudflare.
 *  Solo HTML, whitelist estricta, caché 5 min, bloqueo de media.
 * ============================================================
 */
'use strict';

const puppeteer     = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const ALLOWED_DOMAINS = ['pelisjuanita.com'];
const CACHE_TTL       = 5 * 60 * 1000; // 5 min
const cache           = new Map();

// Reutilizar una sola instancia de browser
let _browser = null;
async function getBrowser() {
    if (_browser) {
        try { await _browser.version(); return _browser; } catch { _browser = null; }
    }
    _browser = await puppeteer.launch({
        headless: 'new',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-extensions',
        ],
    });
    return _browser;
}

async function fetchHandler(req, res) {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Falta url' });

    const target = decodeURIComponent(url);

    // Whitelist
    let host;
    try { host = new URL(target).hostname.replace('www.', ''); }
    catch { return res.status(400).json({ error: 'URL inválida' }); }
    if (!ALLOWED_DOMAINS.some(d => host.endsWith(d))) {
        return res.status(403).json({ error: 'Dominio no permitido' });
    }

    // Caché
    const hit = cache.get(target);
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Cache', 'HIT');
        return res.type('html').send(hit.html);
    }

    let page;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // Bloquear imágenes, fuentes, media y scripts de terceros para ahorrar banda
        await page.setRequestInterception(true);
        page.on('request', r => {
            const t = r.resourceType();
            const u = r.url();
            if (['image','media','font','websocket'].includes(t)) return r.abort();
            // Bloquear CDNs de anuncios / analytics
            if (u.includes('google-analytics') || u.includes('doubleclick') || u.includes('cdn.mxmovies')) return r.abort();
            r.continue();
        });

        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 20_000 });

        // Esperar hasta que desaparezca el challenge de Cloudflare
        await page.waitForFunction(
            () => !document.title.toLowerCase().includes('just a moment'),
            { timeout: 12_000 }
        ).catch(() => {});

        const html = await page.content();

        cache.set(target, { html, ts: Date.now() });

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('X-Cache', 'MISS');
        res.type('html').send(html);

    } catch (err) {
        console.error('[fetch]', err.message);
        res.status(502).json({ error: err.message });
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

module.exports = { fetchHandler };
