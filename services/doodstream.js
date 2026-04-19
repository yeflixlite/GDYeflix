/**
 * ============================================================
 *  services/doodstream.js
 *  Extrae el enlace de descarga real de Doodstream
 * ============================================================
 *
 *  Doodstream genera un token anti-hotlink. El flujo es:
 *  1. GET /e/<id>   → obtener la cookie 'pass_md5' y el token
 *  2. GET /pass_md5/<token>  → recibe la URL base del MP4
 *  3. URL final = urlBase + randomToken + "?token=..." + timestamp
 */

'use strict';

const cheerio          = require('cheerio');
const { fetchWithRetry } = require('../utils/axiosClient');

const DOOD_DOMAINS = [
  'https://dood.re',
  'https://dood.so',
  'https://dood.watch',
  'https://dood.to',
  'https://dood.la',
  'https://ds2play.com',
];

/**
 * Convierte cualquier URL de Doodstream a la forma /e/<id>
 */
function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(d|e|f|v)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Doodstream no encontrado en la URL.');
  const id = match[2];
  return `${u.origin}/e/${id}`;
}

/**
 * Genera 10 caracteres aleatorios (simulación del token del cliente)
 */
function randomToken(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

/**
 * Extrae el enlace de video real de Doodstream.
 * @param {string} url – URL de cualquier página de Doodstream
 * @returns {Promise<{videoUrl: string, type: 'mp4'}>}
 */
async function extract(url) {
  const embedUrl = normalizeUrl(url);
  const origin   = new URL(embedUrl).origin;

  console.log(`[Doodstream] Accediendo a embed: ${embedUrl}`);

  // ── PASO 1: GET la página embed ──────────────────────────────
  const pageRes = await fetchWithRetry(embedUrl, {
    referer: 'https://www.google.com/',
    origin,
  });

  if (pageRes.status !== 200) {
    throw new Error(`Doodstream respondió con status ${pageRes.status}`);
  }

  const html = pageRes.data;

  // ── PASO 2: Extraer pass_md5 y token ────────────────────────
  // Patrón encontrado en el JS interno del embed
  const passMd5Match = html.match(/pass_md5['":\s]+['"]([^'"]+)['"]/);
  const tokenMatch   = html.match(/\?token=([a-zA-Z0-9]+)&expiry=/);

  if (!passMd5Match) throw new Error('No se encontró pass_md5 en Doodstream.');

  const passMd5Path = passMd5Match[1]; // ej: /pass_md5/abc123xyz
  const token       = tokenMatch ? tokenMatch[1] : '';

  const passMd5Url  = `${origin}${passMd5Path}`;

  console.log(`[Doodstream] Obteniendo URL base: ${passMd5Url}`);

  // ── PASO 3: GET la URL base del MP4 ─────────────────────────
  const md5Res = await fetchWithRetry(passMd5Url, {
    referer: embedUrl,
    origin,
  });

  const baseUrl = md5Res.data.trim(); // Texto plano con la URL base

  if (!baseUrl || !baseUrl.startsWith('http')) {
    throw new Error('Doodstream no devolvió una URL base válida.');
  }

  // ── PASO 4: Construir la URL final ───────────────────────────
  const expiry    = Date.now();
  const videoUrl  = `${baseUrl}${randomToken(10)}?token=${token}&expiry=${expiry}`;

  console.log(`[Doodstream] ✔ URL obtenida: ${videoUrl.substring(0, 80)}...`);

  return { videoUrl, type: 'mp4', referer: origin };
}

module.exports = { extract };
