/**
 * ============================================================
 *  services/puppeteerExtractor.js
 *  Extrae el enlace m3u8 interceptando las peticiones de red
 *  de un navegador headless real (Puppeteer).
 * ============================================================
 */

'use strict';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Añadir el plugin stealth para evadir protecciones antibot
puppeteer.use(StealthPlugin());

/**
 * Lanza Puppeteer y monitorea las peticiones de red.
 * Devuelve el primer enlace de video detectado.
 */
async function extractWithPuppeteer(embedUrl, timeoutMs = 60_000) {
  console.log(`[Puppeteer] 🚀 Iniciando navegador headless...`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      '--ignore-certificate-errors',
    ],
    defaultViewport: { width: 1280, height: 720 },
  });

  try {
    const page = await browser.newPage();

    // Simula Chrome real
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/124.0.0.0 Safari/537.36'
    );

    let videoUrl = null;
    let resolveVideo;
    const videoPromise = new Promise(resolve => { resolveVideo = resolve; });

    // Helper para decidir si guardar la URL
    const updateVideoUrl = (url) => {
        if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.txt') || url.includes('playlist.txt')) {
            if (!url.includes('test-videos.co.uk') && !url.includes('googlevideo.com') && !url.includes('adserver')) {
                // Si es un master, resolvemos inmediatamente para ganar velocidad
                if (url.includes('master')) {
                    videoUrl = url;
                    resolveVideo(url);
                } 
                else if (!videoUrl) {
                    videoUrl = url;
                    // Resolver después de 1 segundo si no aparece un master
                    // Así no esperamos los 12 segundos completos por gusto
                    setTimeout(() => { if (videoUrl) resolveVideo(videoUrl); }, 1000);
                }
            }
        }
    };

    // Escuchar peticiones de red
    page.on('request', (request) => updateVideoUrl(request.url()));
    page.on('response', (response) => updateVideoUrl(response.url()));

    console.log(`[Puppeteer] 🌐 Navegando a: ${embedUrl}`);
    
    // Cargar la página rápidamente
    await page.goto(embedUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
    }).catch(() => {});

    // Esperar al enlace o timeout corto (10-12s total)
    try {
        await Promise.race([
            videoPromise,
            new Promise((_, reject) => setTimeout(() => {
                if (videoUrl) resolveVideo(videoUrl);
                else reject(new Error('Timeout esperando video'));
            }, 12000))
        ]);
    } catch (e) {
        // Si falló el race pero no hay videoUrl, intentar click rápido
        if (!videoUrl) {
            console.log('[Puppeteer] Intentando click de activación rápido...');
            await page.mouse.click(640, 360).catch(() => {});
            await new Promise(r => setTimeout(r, 4000));
        }
    }

    if (videoUrl) {
        console.log(`[Puppeteer] ✅ Enlace detectado: ${videoUrl.substring(0, 80)}...`);
        return {
            videoUrl,
            type: videoUrl.includes('.mp4') ? 'mp4' : 'm3u8',
            referer: embedUrl
        };
    }

    // Fallback final: buscar en el DOM
    const content = await page.content();
    const m3u8Match = content.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);
    if (m3u8Match) {
        return {
            videoUrl: m3u8Match[1],
            type: 'm3u8',
            referer: embedUrl
        };
    }

    throw new Error('No se pudo encontrar el enlace de video en la página.');

  } catch (error) {
    console.error(`[Puppeteer] ❌ Error: ${error.message}`);
    throw error;
  } finally {
    await browser.close();
  }
}

async function extract(url) {
  return await extractWithPuppeteer(url);
}

module.exports = { extract };
