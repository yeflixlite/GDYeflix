/**
 * ============================================================
 *  services/voe.js
 *  Extractor para VOE y sus mirrors (charlestoughrace.com, etc.)
 * ============================================================
 */

'use strict';

const cheerio            = require('cheerio');
const { fetchWithRetry } = require('../utils/axiosClient');

/* ── Dominios reconocidos de VOE ────────── */
const VOE_DOMAINS = [
    'voe.sx',
    'charlestoughrace.com',
    'reitshof.com',
    'v-o-e.com'
];

/**
 * @param {string} url  URL de la página embed de VOE
 * @returns {Promise<{ videoUrl: string, type: 'm3u8'|'mp4', referer: string }>}
 */
async function extract(url) {
    const u = new URL(url);
    const origin = u.origin;
    const host = u.hostname;

    console.log(`[VOE/${host}] 🔍 Accediendo a: ${url}`);

    let response = await fetchWithRetry(url, {
        referer: 'https://google.com/',
        origin
    });

    let html = response.data;

    // Manejo de Loading Shell (SPA)
    if (html.length < 2000 && (html.includes('Page is loading') || html.includes('loading'))) {
        console.log(`[VOE/${host}] ⏳ Detectada shell de carga, intentando bypass...`);
        const cookies = response.headers['set-cookie'];
        response = await fetchWithRetry(url, {
            referer: url,
            origin,
            headers: { 'Cookie': cookies ? cookies.join('; ') : '' }
        });
        html = response.data;
    }

    // VOE suele esconder el m3u8 en Base64 dentro de los scripts
    // El string base64 suele empezar por 'aHR0c' (que es 'http' en B64)
    const b64Match = html.match(/['"](aHR0c[a-zA-Z0-9+/=]{10,})['"]/g);
    
    if (b64Match) {
        for (const match of b64Match) {
            try {
                const cleanStr = match.replace(/['"]/g, '');
                const decoded = Buffer.from(cleanStr, 'base64').toString('utf-8');
                if (decoded.includes('.m3u8')) {
                    console.log(`[VOE/${host}] ✅ Extraído vía Base64: ${decoded.substring(0, 80)}...`);
                    return { videoUrl: decoded, type: 'm3u8', referer: origin };
                }
            } catch (e) {}
        }
    }

    // Fallback: buscar m3u8 directo en el HTML
    const directMatch = html.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
    if (directMatch) {
        console.log(`[VOE/${host}] ✅ Extraído vía Regex Directo: ${directMatch[1].substring(0, 80)}...`);
        return { videoUrl: directMatch[1], type: 'm3u8', referer: origin };
    }

    throw new Error(`No se pudo extraer el enlace de video de VOE (${host}).`);
}

module.exports = { extract, VOE_DOMAINS };
