/**
 * ============================================================
 *  utils/urlDetector.js
 *  Detecta el proveedor de video a partir de la URL
 * ============================================================
 */

'use strict';

const PROVIDERS = {
  doodstream: [
    /dood\.(re|so|watch|to|la|pm|sh|ws|one|stream|video|cx|li|wf)/i,
    /doodstream\.com/i,
    /ds2play\.com/i,
    /dooood\.com/i,
  ],
  streamtape: [
    /streamtape\.com/i,
    /streamtape\.net/i,
    /tapecontent\.net/i,
  ],
  streamwish: [
    /streamwish\.(com|to)/i,
    /flaswish\.com/i,
    /sfastwish\.com/i,
    /embedwish\.com/i,
    /wishembed\.net/i,
    /wishfast\.top/i,
    /awish\.pro/i,
    /dwish\.pro/i,
    /cilootv\.store/i,
    /bestx\.stream/i,
    /moviesapi\.club/i,
    /hglamioz\.com/i,
    /streamhg\.com/i,
    /hgcloud\.(to|net|cc|me)/i,
  ],
  vidhide: [
    /vidhide\.com/i,
    /vidhidepro\.com/i,
    /vidhidevip\.com/i,
    /vidhideplay\.com/i,
    /ahvide\.com/i,
    /vhid\.to/i,
    /vplay\.to/i,
    /vidhide\.net/i,
    /hveembed\.com/i,
    /vsharea\.com/i,
    /minochinos\.com/i,
  ],
  filemoon: [
    /filemoon\.(sx|com|to)/i,
    /filemooon\.com/i,
    /moonplayer\.net/i,
    /bysejikuar\.com/i,
    /bysesukior\.com/i,
    /398fitus\.com/i,
  ],
  earvids: [
    /earvids\.com/i,
  ],
  voe: [
    /voe\.sx/i,
    /charlestoughrace\.com/i,
    /reitshof\.com/i,
    /v-o-e\.com/i,
    /voe-video\.com/i,
  ],
  mp4upload: [
    /mp4upload\.com/i,
  ],
  dailymotion: [
    /dailymotion\.com/i,
    /dai\.ly/i,
  ],
  direct: [
    /\.m3u8(\?|$)/i,
    /\.mp4(\?|$)/i,
    /\.webm(\?|$)/i,
    /\.ts(\?|$)/i,
  ],
};

/**
 * Detecta el proveedor de la URL dada.
 * @param {string} url
 * @returns {string}  proveedor detectado
 */
function detectProvider(url) {
  if (!url) return 'unknown';
  for (const [provider, patterns] of Object.entries(PROVIDERS)) {
    if (Array.isArray(patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(url)) return provider;
      }
    }
  }
  return 'unknown';
}

/**
 * Extrae el ID del video según el proveedor.
 */
function extractVideoId(url, provider) {
  try {
    const u = new URL(url);
    switch (provider) {
      case 'doodstream': {
        const match = u.pathname.match(/\/(d|e|f|v)\/([a-zA-Z0-9]+)/);
        return match ? match[2] : null;
      }
      case 'streamtape': {
        const match = u.pathname.match(/\/(e|v|video)\/([a-zA-Z0-9]+)/);
        return match ? match[2] : null;
      }
      case 'streamwish':
      case 'vidhide':
      case 'filemoon':
      case 'earvids': {
        const match = u.pathname.match(/\/[ev]\/([a-zA-Z0-9]+)/);
        return match ? match[1] : u.pathname.split('/').filter(Boolean)[0];
      }
      case 'dailymotion': {
        const match = u.pathname.match(/\/video\/([a-zA-Z0-9]+)/);
        return match ? match[1] : u.pathname.split('/').filter(Boolean).pop();
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

module.exports = { detectProvider, extractVideoId, PROVIDERS };
