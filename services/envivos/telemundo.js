/**
 * services/envivos/telemundo.js
 * Extractor para Telemundo Deportes (Señal Cloudfront)
 */

'use strict';

/**
 * Devuelve el enlace HLS (.m3u8) para Telemundo Deportes
 * @returns {Promise<{ videoUrl: string, type: 'm3u8', referer: string }>}
 */
async function extract() {
    const channelId = 'telemundo';
    const videoUrl = 'https://d1rqgw5gocwo9i.cloudfront.net/manifest/3fec3e5cac39a52b2132f9c66c83dae043dc17d4/prod_default_xumo-nbcu-stitched/6a4c908e-7980-4fcb-93e3-584472a5f9a3/4.m3u8';

    console.log(`[TV/${channelId}] ✅ Fuente estática detectada.`);

    return {
        videoUrl,
        type: 'm3u8',
        referer: 'https://www.tvguatemalaenvivo.com/'
    };
}

module.exports = { extract };
