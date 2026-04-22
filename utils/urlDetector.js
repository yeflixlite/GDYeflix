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
  ],
  // hgcloud.to es un CDN/dominio alternativo de StreamWish
  hgcloud: [
    /hgcloud\.(to|net|cc|me)/i,
  ],
  vidhide: [
    /vidhide\.com/i,
    /vidhidepro\.com/i,
    /ahvide\.com/i,
  ],
  filemoon: [
    /filemoon\.sx/i,
    /filemooon\.com/i,
    /moonplayer\.net/i,
    /bysejikuar\.com/i,
    /bysesukior\.com/i,
    /398fitus\.com/i,
  ],
  earvids: [
    /minochinos\.com/i,
  ],
  voe: [
    /voe\.sx/i,
    /charlestoughrace\.com/i,
    /reitshof\.com/i,
    /v-o-e\.com/i,
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
  for (const [provider, patterns] of Object.entries(PROVIDERS)) {
    for (const pattern of patterns) {
      if (pattern.test(url)) return provider;
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
      case 'filemoon': {
        const match = u.pathname.match(/\/e\/([a-zA-Z0-9]+)/);
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

module.exports = { detectProvider, extractVideoId };
