/**
 * ============================================================
 *  services/puppeteerExtractor.js
 *  Extrae el enlace m3u8 interceptando las peticiones de red
 *  de un navegador headless real (Puppeteer).
 * ============================================================
 */

'use strict';

const puppeteer = require('puppeteer');

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

    // Escuchar peticiones de red
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.txt')) {
            if (!url.includes('test-videos.co.uk') && !url.includes('googlevideo.com')) {
                videoUrl = url;
            }
        }
    });

    // Escuchar respuestas
    page.on('response', (response) => {
        const url = response.url();
        if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('master.txt')) {
             if (!url.includes('test-videos.co.uk') && !url.includes('googlevideo.com')) {
                videoUrl = url;
            }
        }
    });

    console.log(`[Puppeteer] 🌐 Navegando a: ${embedUrl}`);
    
    // Cargar la página y esperar un poco
    await page.goto(embedUrl, {
        waitUntil: 'networkidle2',
        timeout: 60000
    }).catch(() => {});

    // Si no se capturó por red, intentar un click en el centro
    if (!videoUrl) {
        console.log('[Puppeteer] Intentando click de activación...');
        await page.mouse.click(640, 360);
        await new Promise(r => setTimeout(r, 5000));
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
