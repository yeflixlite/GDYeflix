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
    'voe-video.com',
    'richardquestionbuilding.com',
    'jenniferperformer.com'
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
    let embedUrl = url;
    let u = new URL(embedUrl);
    const id = u.pathname.split('/').filter(Boolean).pop();

    // Espejos limpios de VOE y nuevos dominios detectados
    const CLEAN_MIRRORS = [
        'timmaybealready.com', 
        'charlestoughrace.com', 
        'reitshof.com',
        'richardquestionbuilding.com',
        'jenniferperformer.com',
        'p-v-o-e.com'
    ];
    
    // Lista de hosts a probar
    let hostsToTry = [u.host, ...CLEAN_MIRRORS];
    let uniqueHosts = [...new Set(hostsToTry)];

    let html = '';
    let finalOrigin = '';
    let finalEmbedUrl = embedUrl;

    console.log(`[VOE] 🔍 Iniciando búsqueda rápida por HTTP en espejos...`);

    for (const testHost of uniqueHosts) {
        const testUrl = `https://${testHost}/e/${id}${u.search}`;
        try {
            const response = await fetchWithRetry(testUrl, {
                referer: 'https://google.com/',
                origin: `https://${testHost}`,
                timeout: 5000
            }, 1);

            let testHtml = response.data;

            // DETECCIÓN DE REDIRECCIÓN POR JS (NUEVA ESTRATEGIA)
            const jsRedirect = testHtml.match(/window\.location\.href\s*=\s*['"](https?:\/\/[^'"]+)['"]/i);
            if (jsRedirect && !testHtml.includes('sources') && !testHtml.includes('voe-video')) {
                const newUrl = jsRedirect[1];
                console.log(`[VOE] ↪️ Siguiendo redirección JS: ${newUrl}`);
                const redirRes = await fetchWithRetry(newUrl, { referer: testUrl });
                testHtml = redirRes.data;
                const newHost = new URL(newUrl).host;
                if (!uniqueHosts.includes(newHost)) uniqueHosts.push(newHost);
            }

            // Verificamos si es una página real de video
            if ((testHtml.includes('sources') || testHtml.includes('voe-video') || testHtml.includes('decodeVoeConfig') || testHtml.includes('application/json') || testHtml.includes('decodeURI(')) && !testHtml.includes('Just a moment...')) {
                console.log(`[VOE] ✅ ¡ÉXITO HTTP! Host funcional: ${testHost}`);
                html = testHtml;
                finalOrigin = `https://${testHost}`;
                finalEmbedUrl = testUrl;
                break;
            }
        } catch (e) {
            // Siguiente host
        }
    }

    if (!html) {
        throw new Error(`Bloqueo total en VOE (${u.host}). Los espejos no respondieron con contenido válido.`);
    }

    const host = new URL(finalEmbedUrl).host;
    const origin = finalOrigin;
    const searchParams = new URL(finalEmbedUrl).search;

    let finalVideoUrl = null;

    // ESTRATEGIA 1: Buscar JSON ofuscado (Tradicional)
    const jsonMatch = html.match(/<script type="application\/json">\["([^"]+)"\]<\/script>/);
    if (jsonMatch) {
        const config = decodeVoeConfig(jsonMatch[1]);
        if (config && (config.source || config.file)) {
            finalVideoUrl = config.source || config.file;
            console.log(`[VOE/${host}] ⚡ Decodificación exitosa (Strategy 1).`);
        }
    }

    // ESTRATEGIA 2: Buscar decodeURI ofuscado (NUEVA - 2024/2025)
    if (!finalVideoUrl) {
        const uriMatch = html.match(/decodeURI\(['"]([^'"]+)['"]\)/i);
        if (uriMatch) {
            console.log(`[VOE/${host}] 🧪 Intentando decodificar via decodeURI (Strategy 2)...`);
            try {
                let str = decodeURIComponent(uriMatch[1]);
                
                // Aplicar el mismo offset de la función tradicional (-3) y reverse
                let offsetStr = '';
                for (let i = 0; i < str.length; i++) {
                    offsetStr += String.fromCharCode(str.charCodeAt(i) - 3);
                }
                let reversed = offsetStr.split('').reverse().join('');
                
                // Intentar encontrar una URL o un Base64 dentro
                const b64Match = reversed.match(/[A-Za-z0-9+/=]{50,}/);
                if (b64Match) {
                    const decoded = Buffer.from(b64Match[0], 'base64').toString('utf-8');
                    if (decoded.includes('.m3u8') || decoded.includes('.mp4')) {
                        const json = JSON.parse(decoded);
                        finalVideoUrl = json.file || json.source || json.url;
                        console.log(`[VOE/${host}] ⚡ Decodificación exitosa (Strategy 2).`);
                    }
                }
            } catch (e) {
                // Siguiente estrategia
            }
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

