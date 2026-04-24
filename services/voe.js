/**
 * ============================================================
 *  services/voe.js
 *  Extractor para VOE y sus mirrors (charlestoughrace.com, etc.)
 * ============================================================
 */

'use strict';

const { fetchWithRetry } = require('../utils/axiosClient');

/* ── Dominios reconocidos de VOE ────────── */
const VOE_DOMAINS = [
    'voe.sx',
    'charlestoughrace.com',
    'reitshof.com',
    'v-o-e.com',
    'voe-video.com'
];

/**
 * Decodifica el JSON ofuscado de VOE.
 * Basado en la lógica de loader.bc4a6543429.js
 */
function decodeVoeConfig(encoded) {
    try {
        // 1. ROT13
        let str = encoded.replace(/[a-zA-Z]/g, function(c) {
            return String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26);
        });
        
        // 2. Character replacements (limpieza de ruido)
        const noisyTags = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
        noisyTags.forEach(tag => {
            str = str.split(tag).join('');
        });
        
        // 3. Base64 decode 1
        let decoded1 = Buffer.from(str, 'base64').toString('binary');
        
        // 4. Offset de caracteres (-3)
        let offsetStr = '';
        for (let i = 0; i < decoded1.length; i++) {
            offsetStr += String.fromCharCode(decoded1.charCodeAt(i) - 3);
        }
        
        // 5. Reverse
        let reversed = offsetStr.split('').reverse().join('');
        
        // 6. Base64 decode 2
        let finalJson = Buffer.from(reversed, 'base64').toString('utf-8');
        
        return JSON.parse(finalJson);
    } catch (err) {
        console.error('[VOE] Error decodificando config:', err.message);
        return null;
    }
}

/**
 * @param {string} url  URL de la página embed de VOE
 * @returns {Promise<{ videoUrl: string, type: 'm3u8'|'mp4', referer: string }>}
 */
async function extract(url) {
    const u = new URL(url);
    const origin = u.origin;
    const host = u.hostname;
    const searchParams = u.search; // Guardar tokens ?t=...&s=...

    console.log(`[VOE/${host}] 🔍 Extrayendo (Estrategia Directa)...`);

    let response = await fetchWithRetry(url, {
        referer: 'https://google.com/',
        origin
    });

    let html = response.data;

    // Manejo de Loading Shell (SPA)
    if (html.length < 5000 && (html.includes('Page is loading') || html.includes('loading'))) {
        console.log(`[VOE/${host}] ⏳ Detectada shell de carga, intentando bypass...`);
        const cookies = response.headers['set-cookie'];
        response = await fetchWithRetry(url, {
            referer: url,
            origin,
            headers: { 'Cookie': cookies ? cookies.join('; ') : '' }
        });
        html = response.data;
    }

    let finalVideoUrl = null;

    // ESTRATEGIA 1: Buscar JSON ofuscado (NUEVA)
    const jsonMatch = html.match(/<script type="application\/json">\["([^"]+)"\]<\/script>/);
    if (jsonMatch) {
        const config = decodeVoeConfig(jsonMatch[1]);
        if (config && (config.source || config.file)) {
            finalVideoUrl = config.source || config.file;
            console.log(`[VOE/${host}] ⚡ Decodificación exitosa.`);
        }
    }

    // Fallback 1: buscar m3u8 directo (Base64 simple)
    if (!finalVideoUrl) {
        const b64Candidates = html.match(/['"]([A-Za-z0-9+/=]{50,})['"]/g) || [];
        for (const match of b64Candidates) {
            try {
                const cleanStr = match.replace(/['"]/g, '');
                const decoded = Buffer.from(cleanStr, 'base64').toString('utf-8');
                if (decoded.includes('.m3u8') && (decoded.startsWith('http') || decoded.includes('master.m3u8'))) {
                    finalVideoUrl = decoded;
                    break;
                }
            } catch (e) {}
        }
    }

    // Fallback 2: buscar m3u8 directo en HTML
    if (!finalVideoUrl) {
        const directMatch = html.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
        if (directMatch) finalVideoUrl = directMatch[1];
    }

    if (finalVideoUrl) {
        // Asegurar que los tokens de seguridad originales se mantengan si no están presentes
        if (searchParams && !finalVideoUrl.includes('t=')) {
            const separator = finalVideoUrl.includes('?') ? '&' : '?';
            finalVideoUrl += separator + searchParams.substring(1);
            console.log(`[VOE/${host}] 🛡️ Tokens de seguridad inyectados.`);
        }

        console.log(`[VOE/${host}] ✅ Extraído: ${finalVideoUrl.substring(0, 80)}...`);
        return { 
            videoUrl: finalVideoUrl, 
            type: finalVideoUrl.includes('.m3u8') ? 'm3u8' : 'mp4', 
            referer: origin 
        };
    }

    throw new Error(`No se pudo extraer el enlace de video de VOE (${host}). Es posible que el sitio haya cambiado su estructura.`);
}

module.exports = { extract, VOE_DOMAINS };

