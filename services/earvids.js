/**
 * ============================================================
 *  services/earvids.js
 *  Extractor para Earvids (minochinos.com)
 * ============================================================
 */

'use strict';

const { fetchWithRetry } = require('../utils/axiosClient');

/**
 * @param {string} url  URL de la página de Earvids
 * @returns {Promise<{ videoUrl: string, type: 'm3u8'|'mp4', referer: string }>}
 */
async function extract(url) {
    const host = new URL(url).hostname;
    console.log(`[Earvids] 🔍 Extrayendo desde: ${url}`);

    // Intentamos obtener la página. Earvids puede tener una loading shell.
    let response = await fetchWithRetry(url, {
        referer: 'https://google.com/',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
        }
    });

    let html = response.data;

    // Bypass de Loading Shell (si existe)
    if (html.includes('Page is loading') || html.length < 1500) {
        console.log('[Earvids] ⏳ Shell de carga detectada, reintentando con cookies...');
        const cookies = response.headers['set-cookie'];
        response = await fetchWithRetry(url, {
            referer: url,
            headers: {
                'Cookie': cookies ? cookies.join('; ') : '',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            }
        });
        html = response.data;
    }

    // Earvids suele tener el m3u8 directo en el HTML o en un script
    const m3u8Match = html.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
    
    if (m3u8Match) {
        let finalVideoUrl = m3u8Match[1];
        const searchParams = new URL(url).search;

        // Inyectar tokens si existen
        if (searchParams && !finalVideoUrl.includes('t=')) {
            const videoU = new URL(finalVideoUrl);
            const originalParams = new URLSearchParams(searchParams);
            originalParams.forEach((val, key) => {
                if (!videoU.searchParams.has(key)) videoU.searchParams.set(key, val);
            });
            finalVideoUrl = videoU.toString();
            console.log(`[Earvids] 🛡️ Tokens de seguridad inyectados.`);
        }

        console.log(`[Earvids] ✅ Enlace m3u8 encontrado: ${finalVideoUrl.substring(0, 60)}...`);
        return {
            videoUrl: finalVideoUrl,
            type: 'm3u8',
            referer: url
        };
    }

    throw new Error('No se pudo encontrar el enlace m3u8 en la página de Earvids.');
}

module.exports = { extract };
