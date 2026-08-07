/**
 * ============================================================
 *  services/vidhide.js
 *  Extrae el enlace HLS (m3u8 / .txt) de VidHide y sus clones
 *  como minochinos.com, vsharea.com, etc.
 * ============================================================
 */

'use strict';

const cheerio            = require('cheerio');
const { fetchWithRetry } = require('../utils/axiosClient');
const https = require('https');
const http = require('http');

// Keep-alive agents para conexiones rápidas a espejos
const httpsAgent = new https.Agent({ keepAlive: true });
const httpAgent = new http.Agent({ keepAlive: true });

// Caché en memoria para evitar volver a extraer URLs resolubles
const extractionCache = new Map();
// TTL de caché: 60 minutos
const CACHE_TTL = 1000 * 60 * 60;

function normalizeUrl(rawUrl) {
    const u = new URL(rawUrl);
    
    // Buscar el ID del video en rutas comunes: /v/ID, /e/ID, /embed/ID
    const match = u.pathname.match(/\/(?:v|e|embed)\/([a-zA-Z0-9]+)/);
    if (match) {
        // El usuario reportó que las rutas /embed/ o /e/ fallan, así que forzamos /v/
        return `${u.origin}/v/${match[1]}${u.search}`;
    }
    
    // Fallback: Si no hay ruta conocida, asumimos que el último segmento es el ID
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length) {
        const id = segments.pop(); // Tomar el último segmento como ID
        return `${u.origin}/v/${id}${u.search}`;
    }

    return rawUrl;
}

function isHlsUrl(url) {
    return /\.m3u8/i.test(url) || /master\.txt/i.test(url) || /\/hls\//i.test(url) || /playlist\.txt/i.test(url);
}

function guessType(url) {
    return isHlsUrl(url) ? 'm3u8' : 'mp4';
}

function tryDecodeEval(js) {
    const atobMatch = js.match(/atob\(\s*['"]([A-Za-z0-9+/=]+)['"]\s*\)/g);
    if (!atobMatch) return null;
    for (const expr of atobMatch) {
        try {
            const b64 = expr.match(/['"]([A-Za-z0-9+/=]+)['"]/)[1];
            const decoded = Buffer.from(b64, 'base64').toString('utf-8');
            const urlMatch = decoded.match(/https?:\/\/[^\s"'<>]+(?:\.m3u8|master\.txt|playlist\.txt|\/hls\/)[^\s"'<>]*/i);
            if (urlMatch) return urlMatch[0];
        } catch { }
    }
    return null;
}

function tryUnpack(js, baseOrigin) {
    // Unpacker para p,a,c,k,e,d con soporte de URLs relativas
    if (!js.includes('p,a,c,k,e,d')) return null;
    try {
        const pMatch = js.match(/}\s*\(\s*'([\s\S]+?)',\s*(\d+),\s*(\d+),\s*'([\s\S]+?)'\.split\('\|'\)\)\)/);
        if (pMatch) {
            let p = pMatch[1];
            const a = parseInt(pMatch[2]);
            let c = parseInt(pMatch[3]);
            const k = pMatch[4].split('|');
            
            const eFunc = (n) => (n < a ? '' : eFunc(parseInt(n / a))) + ((n = n % a) > 35 ? String.fromCharCode(n + 29) : n.toString(36));
            
            while (c--) {
                if (k[c]) p = p.replace(new RegExp('\\b' + eFunc(c) + '\\b', 'g'), k[c]);
            }
            
            // Prioridad 1: URL relativa /stream/ (local, sin expiración)
            const relStreamMatch = p.match(/["'](\/stream\/[^"'\\]+\.m3u8[^"'\\]*)["']/i);
            if (relStreamMatch && baseOrigin) return baseOrigin + relStreamMatch[1];

            // Prioridad 2: URL absoluta m3u8
            const urlMatch = p.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
            if (urlMatch) return urlMatch[0];
        }
    } catch(e) {}
    return null;
}

function extractScripts(html) {
    const $ = cheerio.load(html);
    const parts = [];
    $('script').each((_, el) => {
        const src = $(el).attr('src');
        if (!src) parts.push($(el).html() || '');
    });
    return parts.join('\n');
}

async function extract(url) {
    const embedUrl = normalizeUrl(url);
    const u        = new URL(embedUrl);
    const origin   = u.origin;
    const host     = u.hostname;
    const search   = u.search;
    const id       = u.pathname.split('/').filter(Boolean).pop();

    // CACHE CHECK
    const cacheKey = id + search;
    const cached = extractionCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[VidHide] ⚡ Resultado obtenido de CACHE en memoria para ID: ${id}`);
        return cached.result;
    }

    // Espejos limpios de VidHide
    const CLEAN_MIRRORS = [
        'minochinos.com',
        'callistanise.com',
        'vsharea.com',
        'vidhidepro.com',
        'vidhide.com'
    ];
    
    let hostsToTry = [host, ...CLEAN_MIRRORS];
    let uniqueHosts = [...new Set(hostsToTry)];

    console.log(`[VidHide] 🔍 Iniciando búsqueda rápida concurrente (Race) en espejos...`);

    const fetchPromises = uniqueHosts.map(async (testHost) => {
        const testUrl = `https://${testHost}/v/${id}${search}`;
        
        let response = await fetchWithRetry(testUrl, {
            referer : 'https://google.com/',
            origin: `https://${testHost}`,
            timeout: 5000,
            httpsAgent,
            httpAgent
        }, 1);

        let testHtml = response.data;

        // Bypass de cookies (shell de carga o redirección)
        if (testHtml.length < 2000 && (testHtml.includes('Page is loading') || testHtml.includes('Redirecting'))) {
            const cookies = response.headers['set-cookie'];
            response = await fetchWithRetry(testUrl, {
                referer: testUrl,
                origin: `https://${testHost}`,
                headers: { 'Cookie': cookies ? cookies.join('; ') : '' },
                timeout: 5000,
                httpsAgent,
                httpAgent
            }, 1);
            testHtml = response.data;
        }

        // Verificamos si es un HTML válido
        if ((testHtml.includes('setup({') || testHtml.includes('eval(function') || testHtml.includes('sources:[')) && !testHtml.includes('Just a moment...')) {
            return {
                html: testHtml,
                finalOrigin: `https://${testHost}`,
                finalEmbedUrl: testUrl,
                host: testHost
            };
        }
        throw new Error(`HTML no válido en espejo ${testHost}`);
    });

    let html = '';
    let finalOrigin = '';
    let finalEmbedUrl = '';

    try {
        const fastestResult = await Promise.any(fetchPromises);
        html = fastestResult.html;
        finalOrigin = fastestResult.finalOrigin;
        finalEmbedUrl = fastestResult.finalEmbedUrl;
        console.log(`[VidHide] ✅ ¡ÉXITO HTTP! Host más rápido: ${fastestResult.host}`);
    } catch (err) {
        throw new Error(`Bloqueo total en VidHide (${host}). Los espejos no respondieron con contenido válido.`);
    }

    const scripts = extractScripts(html);
    console.log(`[VidHide/${host}] 📄 HTML obtenido (${html.length} bytes)`);

    let m = scripts.match(/\.setup\s*\(\s*\{[^}]*?sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/is);
    if (m && m[1].startsWith('http')) {
        const result = { videoUrl: addTokens(m[1], search), type: guessType(m[1]), referer: finalOrigin };
        extractionCache.set(cacheKey, { timestamp: Date.now(), result });
        return result;
    }

    const filePatterns = [
        /file\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)/i,
        /file\s*:\s*["'](https?:\/\/[^"']*master\.txt[^"']*)/i,
        /file\s*:\s*["'](https?:\/\/[^"']*playlist\.txt[^"']*)/i,
        /file\s*:\s*["'](https?:\/\/[^"']*\/hls\/[^"']+)/i,
        /file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i,
    ];

    for (const pat of filePatterns) {
        m = scripts.match(pat) || html.match(pat);
        if (m && m[1]) {
            const result = { videoUrl: addTokens(m[1], search), type: guessType(m[1]), referer: finalOrigin };
            extractionCache.set(cacheKey, { timestamp: Date.now(), result });
            return result;
        }
    }

    const evalDecoded = tryDecodeEval(scripts);
    if (evalDecoded) {
        const result = { videoUrl: addTokens(evalDecoded, search), type: guessType(evalDecoded), referer: finalOrigin };
        extractionCache.set(cacheKey, { timestamp: Date.now(), result });
        return result;
    }

    // Pasamos finalOrigin para que las URLs relativas /stream/ se resuelvan correctamente
    const unpacked = tryUnpack(scripts, finalOrigin);
    if (unpacked) {
        const result = { videoUrl: unpacked, type: guessType(unpacked), referer: finalOrigin };
        extractionCache.set(cacheKey, { timestamp: Date.now(), result });
        return result;
    }

    m = scripts.match(/sources\s*:\s*\[\s*\{[^[\]]*?file\s*:\s*["'](https?:\/\/[^"']+)/is);
    if (m && m[1]) {
        const result = { videoUrl: addTokens(m[1], search), type: guessType(m[1]), referer: finalOrigin };
        extractionCache.set(cacheKey, { timestamp: Date.now(), result });
        return result;
    }

    const hlsInHtml = html.match(/https?:\/\/[^\s"'<>]*(?:\/hls\/|master\.txt|playlist\.txt)[^\s"'<>]*/i);
    if (hlsInHtml) {
        const result = { videoUrl: addTokens(hlsInHtml[0], search), type: 'm3u8', referer: finalOrigin };
        extractionCache.set(cacheKey, { timestamp: Date.now(), result });
        return result;
    }

    const anyM3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (anyM3u8) {
        const result = { videoUrl: addTokens(anyM3u8[0], search), type: 'm3u8', referer: finalOrigin };
        extractionCache.set(cacheKey, { timestamp: Date.now(), result });
        return result;
    }

    throw new Error(`No se pudo extraer el enlace de video de VidHide (${host}).`);
}

function addTokens(videoUrl, search) {
    if (search && !videoUrl.includes('t=')) {
        return videoUrl + (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    return videoUrl;
}

module.exports = { extract };
