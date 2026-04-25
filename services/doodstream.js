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

// Añadir el plugin stealth para evadir protecciones antibot de Cloudflare en Render
puppeteer.use(StealthPlugin());

/** Convierte cualquier URL de Doodstream a la forma /e/<id> */
function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/(d|e|f|v)\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Doodstream no encontrado en la URL.');
  const id = match[2];

  // Intentar en dood.re (más estable), si la URL original es doodstream.com
  const host = u.hostname.includes('doodstream.com') ? 'dood.re' : u.hostname;
  return `https://${host}/e/${id}`;
}

function randomStr(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function extract(url) {
  const embedUrl = normalizeUrl(url);
  console.log(`[Doodstream] 🚀 Usando Puppeteer para: ${embedUrl}`);

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

    // Navegación rápida: no esperamos a que cargue todo (networkidle), solo lo mínimo
    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});

    // Función para intentar clicks en Cloudflare (se ejecuta en el navegador, 100% seguro contra crashes)
    await page.evaluate(() => {
        window.cfClicker = setInterval(() => {
            const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            if (el) el.click();
        }, 3000);
    }).catch(() => {});

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
    isClosed = true;
    await browser.close();
  }
}

module.exports = { extract };

