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

function normalizeUrl(rawUrl) {
    const u = new URL(rawUrl);
    // VidHide suele usar /v/ o /e/ indistintamente, pero algunos clones fallan si fuerzas /e/
    // Por lo tanto, mantenemos el path original si ya es /v/ o /e/
    if (u.pathname.startsWith('/v/') || u.pathname.startsWith('/e/')) {
        return rawUrl;
    }
    
    // Fallback
    const match = u.pathname.match(/\/(?:v|e)\/([a-zA-Z0-9]+)/);
    if (match) return `${u.origin}/v/${match[1]}${u.search}`;
    
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length) return `${u.origin}/v/${segments[0]}${u.search}`;

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

function tryUnpack(js) {
    // Unpacker muy básico para p,a,c,k,e,d
    if (!js.includes('p,a,c,k,e,d')) return null;
    try {
        const pMatch = js.match(/return\s*p}\s*\(\s*['"](.*?)['"]\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"](.*?)['"]\.split/);
        if (pMatch) {
            let p = pMatch[1];
            const a = parseInt(pMatch[2]);
            const c = parseInt(pMatch[3]);
            const k = pMatch[4].split('|');
            
            let e = function(c) {
                return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
            };
            
            let c_counter = c;
            while (c_counter--) {
                if (k[c_counter]) {
                    p = p.replace(new RegExp('\\b' + e(c_counter) + '\\b', 'g'), k[c_counter]);
                }
            }
            
            const urlMatch = p.match(/https?:\/\/[^\s"'<>]+(?:\.m3u8|master\.txt|playlist\.txt|\/hls\/)[^\s"'<>]*/i);
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

    console.log(`[VidHide/${host}] 🔍 Accediendo a: ${embedUrl}`);

    let response = await fetchWithRetry(embedUrl, {
        referer : 'https://google.com/',
        origin,
        timeout: 15000
    });

    let html = response.data;

    if (html.length < 2000 && (html.includes('Page is loading') || html.includes('Redirecting'))) {
        console.log(`[VidHide/${host}] ⏳ Detectada shell de carga, intentando bypass de cookies...`);
        const cookies = response.headers['set-cookie'];
        response = await fetchWithRetry(embedUrl, {
            referer: embedUrl,
            origin,
            headers: { 'Cookie': cookies ? cookies.join('; ') : '' }
        });
        html = response.data;
    }

    const scripts = extractScripts(html);
    console.log(`[VidHide/${host}] 📄 HTML obtenido (${html.length} bytes)`);

    let m = scripts.match(/\.setup\s*\(\s*\{[^}]*?sources\s*:\s*\[\s*\{[^}]*?file\s*:\s*["']([^"']+)["']/is);
    if (m && m[1].startsWith('http')) return { videoUrl: addTokens(m[1], search), type: guessType(m[1]), referer: origin };

    const filePatterns = [
        /file\s*:\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)/i,
        /file\s*:\s*["'](https?:\/\/[^"']*master\.txt[^"']*)/i,
        /file\s*:\s*["'](https?:\/\/[^"']*playlist\.txt[^"']*)/i,
        /file\s*:\s*["'](https?:\/\/[^"']*\/hls\/[^"']+)/i,
        /file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i,
    ];

    for (const pat of filePatterns) {
        m = scripts.match(pat) || html.match(pat);
        if (m && m[1]) return { videoUrl: addTokens(m[1], search), type: guessType(m[1]), referer: origin };
    }

    const evalDecoded = tryDecodeEval(scripts);
    if (evalDecoded) return { videoUrl: addTokens(evalDecoded, search), type: guessType(evalDecoded), referer: origin };

    const unpacked = tryUnpack(scripts);
    if (unpacked) return { videoUrl: addTokens(unpacked, search), type: guessType(unpacked), referer: origin };

    m = scripts.match(/sources\s*:\s*\[\s*\{[^[\]]*?file\s*:\s*["'](https?:\/\/[^"']+)/is);
    if (m && m[1]) return { videoUrl: addTokens(m[1], search), type: guessType(m[1]), referer: origin };

    const hlsInHtml = html.match(/https?:\/\/[^\s"'<>]*(?:\/hls\/|master\.txt|playlist\.txt)[^\s"'<>]*/i);
    if (hlsInHtml) return { videoUrl: addTokens(hlsInHtml[0], search), type: 'm3u8', referer: origin };

    const anyM3u8 = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
    if (anyM3u8) return { videoUrl: addTokens(anyM3u8[0], search), type: 'm3u8', referer: origin };

    throw new Error(`No se pudo extraer el enlace de video de VidHide (${host}).`);
}

function addTokens(videoUrl, search) {
    if (search && !videoUrl.includes('t=')) {
        return videoUrl + (videoUrl.includes('?') ? '&' : '?') + search.substring(1);
    }
    return videoUrl;
}

module.exports = { extract };
