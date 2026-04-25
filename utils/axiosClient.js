/**
 * ============================================================
 *  utils/axiosClient.js
 *  Cliente Axios pre-configurado para simular un navegador real
 * ============================================================
 */

'use strict';

const axios                    = require('axios');
const { getBrowserHeaders }    = require('./browserHeaders');

/**
 * Crea una instancia de Axios que simula Chrome.
 * @param {Object} extraHeaders – Headers adicionales a fusionar
 * @param {string} referer      – Referer a inyectar
 * @param {string} origin       – Origin a inyectar
 */
function createClient(extraHeaders = {}, referer = '', origin = '') {
  return axios.create({
    timeout: 30_000,                  // 30 segundos máximo
    maxRedirects: 10,
    decompress: true,
    headers: {
      ...getBrowserHeaders(referer, origin),
      ...extraHeaders,
    },
    // Permite cualquier código de estado para manejarlos manualmente
    validateStatus: () => true,
  });
}

/**
 * Realiza un GET con reintentos automáticos.
 * @param {string} url
 * @param {Object} options – { headers, referer, origin, responseType }
 * @param {number} retries
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
  const client = createClient(
    options.headers  || {},
    options.referer  || '',
    options.origin   || '',
  );

  let lastError;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await client.get(url, {
        responseType: options.responseType || 'text',
        timeout: options.timeout || 30_000, // Custom timeout
      });
      return response;
    } catch (err) {
      lastError = err;
      // Pequeña pausa antes de reintentar
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}

module.exports = { createClient, fetchWithRetry };
