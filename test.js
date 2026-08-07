const axios = require('axios');

async function testSegment() {
  const tsUrl = 'https://sv3.ibra.lat/files/2/247adef22ad/video0.ts?m=FFlrAn_N8m5B88zKv5avWQ&e=1895776532';

  const r = await axios.get(tsUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    responseType: 'arraybuffer',
    timeout: 10000,
    validateStatus: () => true,
  });
  console.log('Status:', r.status);
  console.log('Content-Type:', r.headers['content-type']);
  console.log('Access-Control-Allow-Origin:', r.headers['access-control-allow-origin']);
  console.log('Size:', r.data.byteLength, 'bytes');
  // Mostrar contenido como texto para ver si es un error
  const text = Buffer.from(r.data).toString('utf8');
  console.log('Body (texto):', text);
}

testSegment().catch(console.error);
