/**
 * ============================================================
 *  services/nupload.js
 *  Extrae el enlace HLS (m3u8) de Nupload (nupload.me / nupload.top).
 *
 *  CÓMO FUNCIONA:
 *  La página /watch contiene un array ofuscado de 21 elementos (base64).
 *  Cada elemento es "textoœdígitos" y, restándole un offset dinámico
 *  (también embebido en la página), se obtiene char a char la base URL
 *  del CDN (p. ej. https://sv3.ibra.lat/). El m3u8 real es:
 *      baseURL + '?s=' + sesz   (sesión única por página)
 *
 *  IMPORTANTE: el CDN exige el Referer de nupload para devolver la
 *  playlist real (sin él responde un body de error de 63 bytes y sin
 *  CORS). Por eso se resuelve SIEMPRE vía proxy; NO va a directPlay.
 * ============================================================
 */

'use strict';

const { fetchWithRetry } = require('../utils/axiosClient');

/**
 * Normaliza la URL al formato /watch/<id>
 * El referer de reproducción es SIEMPRE nupload.top: el CDN valida que el
 * referer sea un host nupload aceptado (.top/.me funcionan; .my hace timeout).
 * La sesión (?s=) no está ligada al dominio de la página, así que sirve igual.
 */
function normalizeUrl(rawUrl) {
    const u = new URL(rawUrl);
    const match = u.pathname.match(/\/watch\/([a-zA-Z0-9]+)/);
    const id = match ? match[1] : u.pathname.split('/').filter(Boolean).pop();
    if (!id) throw new Error('ID de Nupload no encontrado en la URL.');
    return {
        watchUrl: `${u.origin}/watch/${id}`,
        id,
        origin: u.origin,
        referer: 'https://nupload.top/',
    };
}

/**
 * Decodifica el array ofuscado: cada elemento es base64 de
 * "texto<dígitos>"; digits - offset = charCode de la base URL.
 */
function decodeVideoUrlArray(array, offset) {
    let url = '';
    for (const item of array) {
        const decoded = Buffer.from(item, 'base64').toString('utf8');
        const digits = parseInt(decoded.replace(/\D/g, ''), 10);
        url += String.fromCharCode(digits - offset);
    }
    if (!/^https?:\/\//i.test(url)) {
        throw new Error('Base URL de Nupload inválida (offset del array incorrecto).');
    }
    return url;
}

/**
 * Extrae el m3u8 (URL con sesión) de un HTML de página /watch.
 */
function extractFromHtml(html) {
    const arrMatch = html.match(/=\s*\[("[A-Za-z0-9+/=]+"(?:,\s*"[A-Za-z0-9+/=]+")*)\s*\];/);
    const offsetMatch = html.match(/atob\(value\)\.replace\(\/\\D\/g,\s*''\)\)\s*-\s*(\d+)/);
    const sessionMatch = html.match(/sesz\s*=\s*"([A-Za-z0-9=]+)"/);
    if (!arrMatch || !offsetMatch || !sessionMatch) return null;

    const array = arrMatch[1].match(/"([^"]+)"/g).map(s => s.replace(/"/g, ''));
    const offset = parseInt(offsetMatch[1], 10);
    const session = sessionMatch[1];

    const base = decodeVideoUrlArray(array, offset);
    return `${base}?s=${session}`;
}

/**
 * Extractor Principal
 * NOTA: sin caché. La sesión (?s=) rota en cada carga de página y
 * expira en segundos, así que cada extracción debe ser fresca.
 */
async function extract(url) {
    const { watchUrl, id, origin, referer } = normalizeUrl(url);

    let html = '';
    try {
        const response = await fetchWithRetry(watchUrl, {
            referer,
            origin,
            timeout: 8000,
        }, 2);
        html = response.data;
    } catch (err) {
        throw new Error(`No se pudo acceder a la página de Nupload (${id}): ${err.message}`);
    }

    const videoUrl = extractFromHtml(html);
    if (!videoUrl) {
        throw new Error('No se pudo extraer el enlace de video de Nupload (estructura no reconocida).');
    }

    return { videoUrl, type: 'm3u8', referer };
}

module.exports = { extract };