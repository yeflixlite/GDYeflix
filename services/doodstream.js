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
  
  // Espejos limpios de Doodstream (ordenados por probabilidad de éxito)
  const CLEAN_MIRRORS = ['playmogo.com', 'dood.re', 'dood.pm', 'dood.la', 'doodstream.com'];
  const uniqueHosts = [...new Set([u.host, ...CLEAN_MIRRORS])];

  console.log(`[Doodstream] 🔍 Intentando extracción rápida por HTTP (Paralelo)...`);

  const tryHost = async (host) => {
      const embedUrl = `https://${host}/e/${id}`;
      try {
          const response = await fetchWithRetry(embedUrl, {
              referer: 'https://google.com/',
              timeout: 2500 // Tiempo agresivo para no retrasar Puppeteer
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
                          referer: embedUrl,
                          method: 'http_mirror'
                      };
                  }
              }
          }
      } catch (e) {}
      throw new Error('Mirror falló');
  };

  try {
      // Intentamos todos en paralelo. El primero que responda gana.
      const result = await Promise.any(uniqueHosts.map(h => tryHost(h)));
      console.log(`[Doodstream] ✅ ¡ÉXITO HTTP!`);
      return result;
  } catch (e) {
      console.log(`[Doodstream] 🛡️ HTTP falló. Usando Puppeteer...`);
  }

  // Fallback a Puppeteer (Usamos dood.re por ser el más estable)
  const embedUrl = `https://${u.host.includes('doodstream.com') ? 'dood.re' : u.host}/e/${id}`;

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    let passMd5Url = null;
    const passPromise = new Promise((resolve) => {
        page.on('request', (req) => {
            const url = req.url();
            if (url.includes('/pass_md5/')) {
                passMd5Url = url;
                resolve(url);
            }
        });
    });

    // Inyectar clicker para Cloudflare
    await page.evaluateOnNewDocument(() => {
        setInterval(() => {
            const el = document.elementFromPoint(window.innerWidth/2, window.innerHeight/2);
            if (el) el.click();
        }, 2500);
    }).catch(() => {});

    console.log(`[Doodstream] 🌐 Navegando a: ${embedUrl}`);
    page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    // Esperar al token URL
    await Promise.race([
        passPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout esperando token')), 25000))
    ]);

    // Pequeña pausa para asegurar que el JS de la página terminó de procesar
    await new Promise(r => setTimeout(r, 1000));

    console.log(`[Doodstream] Capturando base URL...`);
    let baseUrl = null;
    try {
        baseUrl = await page.evaluate(async (url) => {
            try {
                const res = await fetch(url);
                return await res.text();
            } catch (e) { return null; }
        }, passMd5Url);
    } catch (e) {
        console.warn(`[Doodstream] Error en evaluate, intentando de nuevo...`);
        // Re-intentar una vez si falló el contexto
        await new Promise(r => setTimeout(r, 1000));
        baseUrl = await page.evaluate(async (url) => {
            const res = await fetch(url);
            return await res.text();
        }, passMd5Url).catch(() => null);
    }

    if (!baseUrl || !baseUrl.trim().startsWith('http')) {
        throw new Error('Doodstream devolvió una respuesta inválida en pass_md5.');
    }

    const tokenPart = passMd5Url.split('/').pop();
    const finalUrl = `${baseUrl.trim()}${randomStr(10)}?token=${tokenPart}&expiry=${Date.now()}`;

    console.log(`[Doodstream] ✅ Extracción completada.`);
    return { videoUrl: finalUrl, type: 'mp4', referer: embedUrl };

  } finally {
    await browser.close();
  }
}

module.exports = { extract };

