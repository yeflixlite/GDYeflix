'use strict';

const axios = require('axios');
const { getBrowserHeaders } = require('../utils/browserHeaders');

async function extract(url) {
  try {
    const headers = getBrowserHeaders(url);
    const { data } = await axios.get(url, { headers, timeout: 15000 });

    // 1. Extraer el array de base64
    const arrayMatch = data.match(/var\s+[a-zA-Z0-9_]+\s*=\s*\[(.*?)\];/);
    if (!arrayMatch) throw new Error('No se encontró el array de datos en nupload');
    
    // Convertir el string ' "a", "b", "c" ' a un array real
    const base64Array = arrayMatch[1].split(',').map(s => s.trim().replace(/^"|"$/g, ''));

    // 2. Extraer el token 'sesz'
    const seszMatch = data.match(/var\s+[a-zA-Z0-9_]+\s*=\s*"([^"]+)"/);
    if (!seszMatch) throw new Error('No se encontró el token sesz en nupload');
    const sesz = seszMatch[1];

    // 3. Extraer el número mágico a restar (ej. 8954888)
    const magicMatch = data.match(/-\s*(\d+)\)/);
    const magicNumber = magicMatch ? parseInt(magicMatch[1], 10) : 8954888;

    // 4. Reconstruir la URL base
    let baseUrl = '';
    base64Array.forEach(val => {
        const decoded = Buffer.from(val, 'base64').toString('utf8');
        const num = parseInt(decoded.replace(/\D/g, ''), 10);
        baseUrl += String.fromCharCode(num - magicNumber);
    });

    // 5. Construir URL final del m3u8 real
    const videoUrl = `${baseUrl}?s=${sesz}`;

    return {
      videoUrl,
      type: 'm3u8',
      referer: url,
      // Indicar que es single-level para que el proxy envuelva con un master sintético
      wrapLevel: '720p',
    };
  } catch (error) {
    throw new Error(`Nupload Extract Error: ${error.message}`);
  }
}

module.exports = { extract };
