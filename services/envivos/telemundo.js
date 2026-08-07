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
    // URL directa extraída desde tvtvhd.com para uso nativo
    const videoUrl = 'https://live-oneapp-prd-news.akamaized.net/Content/CMAF_OL2-CTR-4s/Live/channel(WNJU)/master.mpd';
    const drm = {
        keyId: 'c71fe7bc82f037c6af21fd299d6341b0',
        key: '13223c98886ff43d3c5f271eeb457cc6'
    };

    console.log(`[TV/${channelId}] ✅ Fuente DASH detectada con DRM.`);

    return {
        videoUrl,
        type: 'dash',
        drm,
        referer: 'https://tvtvhd.com/'
    };
}

module.exports = { extract };
