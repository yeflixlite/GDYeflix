/**
 * services/envivos/fox2.js
 * Canal: Fox Sports 2 (ftlly).
 * El m3u8 se extrae del embed original de tvf90.com (https://tvf90.com/1.php
 * embebe 5.php por iframe con Clappr). 5.php genera un token fresco por
 * request; si el m3u8 no se obtiene (throttling/red), se usa un token
 * estático de respaldo.
 */
'use strict';

const https = require('https');
const axios = require('axios');

const httpsAgent = new https.Agent({ keepAlive: true });

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

const PLAYER_URL = 'https://tvf90.com/5.php?stream=foxsports2_usa';
const EMBED_URL  = 'https://tvf90.com/1.php?stream=foxsports2_usa';

// Fallback: token estático por si tvf90 está caído/bloqueado (caduca).
const FOX2_FALLBACK =
  'https://9.ftlly.com/foxsports2_usa/mono.m3u8?token=97ae8533e46bd12ab815b4ab0f38d931654c2b6a-c9-1790399209-1790381209';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scrapeTvf90() {
  const res = await axios.get(PLAYER_URL, {
    headers: {
      'User-Agent': UA,
      'Referer': EMBED_URL,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
      'Connection': 'keep-alive'
    },
    httpsAgent,
    timeout: 20_000,
    // 5.php devuelve "Acceso no autorizado." (200) cuando detecta ráfagas;
    // si responde 4xx/5xx lo tratamos también como fallo.
    validateStatus: () => true
  });
  const body = String(res.data);

  if (res.status !== 200 || /acceso no autorizado/i.test(body)) {
    throw new Error(`tvf90 status ${res.status}`);
  }

  const m =
    body.match(/playbackURL\s*=\s*["']([^"']+\.m3u8[^"']*)["']/i) ||
    body.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);

  if (!m || !m[1]) throw new Error('m3u8 no encontrado en tvf90');
  return m[1];
}

async function extract() {
  // 5.php limita a ~2 peticiones por ráfaga: a lo sumo 1 intento normal +
  // 1 reintento tras 10s antes de caer al token estático.
  try {
    const videoUrl = await scrapeTvf90();
    return { videoUrl, type: 'm3u8', referer: PLAYER_URL };
  } catch (err) {
    console.warn(`[TV/fox2] Primer scraping falló (${err.message}). Reintentando en 10s...`);
    await sleep(10_000);
    try {
      const videoUrl = await scrapeTvf90();
      return { videoUrl, type: 'm3u8', referer: PLAYER_URL };
    } catch (err2) {
      console.warn(`[TV/fox2] Reintento falló (${err2.message}). Usando token estático.`);
      return {
        videoUrl: FOX2_FALLBACK,
        type: 'm3u8',
        referer: 'https://ftlly.com/'
      };
    }
  }
}

module.exports = { extract };