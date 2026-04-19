/**
 * ============================================================
 *  utils/browserHeaders.js
 *  Headers que simulan un navegador Chrome real
 * ============================================================
 */

'use strict';

/**
 * Devuelve headers similares a los de Chrome 124 en Windows 10.
 * @param {string} referer  – URL de origen (Referer)
 * @param {string} origin   – Origen (Origin)
 * @returns {Object}
 */
function getBrowserHeaders(referer = '', origin = '') {
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36',
    'Accept':
      'text/html,application/xhtml+xml,application/xml;q=0.9,' +
      'image/avif,image/webp,image/apng,*/*;q=0.8,' +
      'application/signed-exchange;v=b3;q=0.7',
    'Accept-Language':  'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding':  'gzip, deflate, br',
    'Connection':       'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest':   'document',
    'Sec-Fetch-Mode':   'navigate',
    'Sec-Fetch-Site':   'none',
    'Sec-Fetch-User':   '?1',
    'Cache-Control':    'max-age=0',
  };

  if (referer) headers['Referer'] = referer;
  if (origin)  headers['Origin']  = origin;

  return headers;
}

/**
 * Headers para peticiones de recursos (XHR / fetch de media)
 */
function getMediaHeaders(referer = '', origin = '') {
  const base = getBrowserHeaders(referer, origin);
  return {
    ...base,
    'Accept':         '*/*',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
  };
}

module.exports = { getBrowserHeaders, getMediaHeaders };
