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

  console.log(`[Doodstream] 🔍 Probando extracción rápida por HTTP (Paralelo)...`);

  const tryHost = async (host) => {
      const embedUrl = `https://${host}/e/${id}`;
      const response = await fetchWithRetry(embedUrl, {
          referer: 'https://google.com/',
          timeout: 3000
      }, 1);

      const html = response.data;
      if (html.includes('/pass_md5/') && !html.includes('Just a moment...')) {
          const passMatch = html.match(/\/pass_md5\/([^'"]+)/);
          if (passMatch) {
              const passUrl = `https://${host}${passMatch[0]}`;
              const passRes = await fetchWithRetry(passUrl, {
                  referer: embedUrl,
                  timeout: 3000
              }, 1);

              const baseUrl = passRes.data;
              if (baseUrl && baseUrl.trim().startsWith('http')) {
                  const tokenPart = passMatch[1].split('/').pop();
                  return {
                      videoUrl: `${baseUrl.trim()}${randomStr(10)}?token=${tokenPart}&expiry=${Date.now()}`,
                      type: 'mp4',
                      referer: embedUrl
                  };
              }
          }
      }
      throw new Error('Mirror falló o bloqueado');
  };

  try {
      // Intentamos todos los espejos en paralelo y nos quedamos con el primero que funcione
      const fastResult = await Promise.any(uniqueHosts.map(host => tryHost(host)));
      console.log(`[Doodstream] ✅ ¡ÉXITO HTTP! Extracción paralela completada.`);
      return fastResult;
  } catch (e) {
      console.log(`[Doodstream] 🛡️ HTTP falló en todos los espejos. Usando Puppeteer...`);
  }

  // Fallback a Puppeteer
  const embedUrl = `https://${u.host.includes('doodstream.com') ? 'dood.re' : u.host}/e/${id}`;

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

    let localPassMd5Url = null;
    let baseUrl = null;

    // Interceptar la URL pass_md5 Y su respuesta
    const passMd5Promise = new Promise((resolve) => {
      page.on('response', async (response) => {
        const u = response.url();
        if (u.includes('/pass_md5/')) {
          try {
            const text = await response.text();
            if (text && text.trim().startsWith('http')) {
              console.log(`[Doodstream] ✅ pass_md5 interceptado y validado.`);
              baseUrl = text.trim();
              localPassMd5Url = u;
              resolve(u);
            }
          } catch (e) {
            // Error leyendo el cuerpo, ignoramos y esperamos otra respuesta si la hay
          }
        }
      });
    });

    // Función para intentar clicks en Cloudflare
    await page.evaluateOnNewDocument(() => {
        window.cfClicker = setInterval(() => {
            const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            if (el) el.click();
        }, 3000);
    }).catch(() => {});

    console.log(`[Doodstream] 🌐 Navegando a: ${embedUrl}`);
    page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});

    // Esperar al token
    await Promise.race([
      passMd5Promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout esperando pass_md5 válido')), 25000))
    ]);

    if (!baseUrl) throw new Error('Doodstream no devolvió una URL base válida desde pass_md5.');

    const tokenPart = localPassMd5Url.split('/').pop();
    const finalUrl = `${baseUrl}${randomStr(10)}?token=${tokenPart}&expiry=${Date.now()}`;

    console.log(`[Doodstream] 🎬 URL final: ${finalUrl.substring(0, 80)}...`);
    return { videoUrl: finalUrl, type: 'mp4', referer: embedUrl };

  } finally {
    await browser.close();
  }
}

module.exports = { extract };

