/**
 * ============================================================
 *  services/doodstream.js
 *  Extrae el enlace de video real de Doodstream usando Puppeteer.
 *  Doodstream bloquea todas las peticiones HTTP directas (403),
 *  por lo que se intercepta la petición de video desde el navegador.
 * ============================================================
 */

'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { fetchWithRetry } = require('../utils/axiosClient');

// Añadir el plugin stealth para evadir protecciones antibot de Cloudflare en Render
puppeteer.use(StealthPlugin());

/** Convierte cualquier URL de Doodstream a la forma /e/<id> */
function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(d|e|f|v)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Doodstream no encontrado en la URL.');
  return match[2];
}

function randomStr(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function extract(url) {
  const id = normalizeUrl(url);
  const u = new URL(url);
  
  // Espejos limpios de Doodstream
  const CLEAN_MIRRORS = ['playmogo.com', 'dood.re', 'doodstream.com'];
  const hostsToTry = [u.host, ...CLEAN_MIRRORS];
  const uniqueHosts = [...new Set(hostsToTry)];

  console.log(`[Doodstream] 🔍 Probando extracción rápida por HTTP...`);

  for (const host of uniqueHosts) {
      const embedUrl = `https://${host}/e/${id}`;
      try {
          console.log(`[Doodstream] Probando espejo: ${embedUrl}`);
          const response = await fetchWithRetry(embedUrl, {
              referer: 'https://google.com/',
              timeout: 4000
          }, 1);

          const html = response.data;

          if (html.includes('/pass_md5/') && !html.includes('Just a moment...')) {
              console.log(`[Doodstream] ✅ ¡ÉXITO HTTP! Espejo limpio encontrado: ${host}`);
              
              const passMatch = html.match(/\/pass_md5\/([^'"]+)/);
              if (passMatch) {
                  const passUrl = `https://${host}${passMatch[0]}`;
                  const passRes = await fetchWithRetry(passUrl, {
                      referer: embedUrl,
                      timeout: 5000
                  }, 1);

                  const baseUrl = passRes.data;
                  if (baseUrl && baseUrl.trim().startsWith('http')) {
                      const tokenPart = passMatch[1].split('/').pop();
                      const finalUrl = `${baseUrl.trim()}${randomStr(10)}?token=${tokenPart}&expiry=${Date.now()}`;
                      console.log(`[Doodstream] 🎬 URL extraída vía HTTP: ${finalUrl.substring(0, 60)}...`);
                      return { videoUrl: finalUrl, type: 'mp4', referer: embedUrl };
                  }
              }
          }
      } catch (e) {
          // Seguir probando
      }
  }

  // Fallback a Puppeteer si todo falla
  const embedUrl = `https://${u.host.includes('doodstream.com') ? 'dood.re' : u.host}/e/${id}`;
  console.log(`[Doodstream] 🛡️ HTTP falló o Cloudflare detectado. Usando Puppeteer: ${embedUrl}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    );

    let isClosed = false;
    let localPassMd5Url = null;

    // Interceptar la URL pass_md5 que Doodstream genera con JS
    // Cerramos el navegador inmediatamente al capturarlo para ganar velocidad
    const passMd5Promise = new Promise((resolve) => {
      page.on('request', req => {
        const u = req.url();
        if (u.includes('/pass_md5/')) {
          console.log(`[Doodstream] ✅ pass_md5 interceptado: ${u.substring(0, 60)}...`);
          localPassMd5Url = u;
          resolve(u);
        }
      });
    });

    // Función para intentar clicks en Cloudflare (se ejecuta en cada nuevo documento, 100% seguro)
    await page.evaluateOnNewDocument(() => {
        window.cfClicker = setInterval(() => {
            const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            if (el) el.click();
        }, 3000);
    }).catch(() => {});

    // Navegación SIN await: no esperamos a que cargue todo, solo lanzamos la petición
    // Esto evita bloqueos de 30s si Cloudflare nunca dispara el evento 'domcontentloaded'
    page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});

    // Esperar al token con un timeout más generoso (25s) por si Cloudflare tarda
    const passMd5Url = await Promise.race([
      passMd5Promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout esperando pass_md5')), 25000))
    ]);

    if (!passMd5Url) throw new Error('No se pudo interceptar la URL pass_md5 de Doodstream.');

    // Navegar a pass_md5 DENTRO del mismo navegador (con las cookies de Cloudflare ya establecidas)
    console.log('[Doodstream] Navegando a pass_md5 en el mismo contexto...');
    const baseUrl = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return await res.text();
    }, passMd5Url).catch(() => null);

    if (!baseUrl || !baseUrl.trim().startsWith('http')) {
      throw new Error('Doodstream no devolvió una URL base válida desde pass_md5.');
    }

    const tokenPart = passMd5Url.split('/').pop();
    const finalUrl = `${baseUrl.trim()}${randomStr(10)}?token=${tokenPart}&expiry=${Date.now()}`;

    console.log(`[Doodstream] 🎬 URL final: ${finalUrl.substring(0, 80)}...`);
    return { videoUrl: finalUrl, type: 'mp4', referer: embedUrl };

  } finally {
    await browser.close();
  }
}

module.exports = { extract };

