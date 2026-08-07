/**
 * ============================================================
 *  services/envivos/ksdExtractor.js
 *  Extractor genérico para canales de ksdjugfsddeports.com
 * ============================================================
 */

'use strict';

const { fetchWithRetry } = require('../../utils/axiosClient');

/**
 * Extrae el enlace HLS (.m3u8) para un canal específico
 * @param {string} channelId 
 * @returns {Promise<{ videoUrl: string, type: 'm3u8', referer: string }>}
 */
async function extractChannel(channelId) {
    const baseUrl = 'https://embed.ksdjugfsddeports.com';
    const embedUrl = `${baseUrl}/embed2/${channelId}.html`;

    console.log(`[TV/${channelId}] 🔍 Iniciando extracción...`);

    try {
        // Paso 1: Obtener HTML del iframe principal
        const res1 = await fetchWithRetry(embedUrl, {
            referer: 'https://google.com/'
        });
        const html1 = res1.data;

        // Paso 2: Extraer URL de stream.php
        const iframeMatch = html1.match(/<iframe.*?src=["']([^"']*stream\.php[^"']*)["']/i);
        if (!iframeMatch) {
            throw new Error('No se encontró el iframe de stream.php');
        }
        
        let streamUrl = iframeMatch[1];
        if (streamUrl.startsWith('/')) {
            const urlObj = new URL(embedUrl);
            streamUrl = `${urlObj.origin}${streamUrl}`;
        }

        // Paso 3: Obtener HTML de stream.php
        const res2 = await fetchWithRetry(streamUrl, {
            referer: embedUrl
        });
        const html2 = res2.data;

        // Paso 4: Extraer M3U8 de setupPlayer
        const m3u8Match = html2.match(/setupPlayer\s*\(\s*["']([^"']+)["']/i);
        if (!m3u8Match) {
            const jwMatch = html2.match(/file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
            if (jwMatch) {
                return {
                    videoUrl: jwMatch[1],
                    type: 'm3u8',
                    referer: streamUrl
                };
            }
            throw new Error('No se encontró el enlace .m3u8 final');
        }

        return {
            videoUrl: m3u8Match[1],
            type: 'm3u8',
            referer: streamUrl
        };

    } catch (err) {
        throw new Error(`Fallo en ksdExtractor (${channelId}): ${err.message}`);
    }
}

module.exports = { extractChannel };
