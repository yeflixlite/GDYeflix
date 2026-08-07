/**
 * ============================================================
 *  services/filemoon.js
 *  Extrae el enlace HLS (m3u8) de Filemoon (y sus mirrors como bysejikuar)
 *  Soporta tanto el patrón antiguo (JS) como el nuevo (API AES-GCM)
 * ============================================================
 */

'use strict';

const axios                = require('axios');
const crypto               = require('crypto');
const { fetchWithRetry }   = require('../utils/axiosClient');
const { getBrowserHeaders } = require('../utils/browserHeaders');

// ============================================================
// Funciones para resolver el nuevo Captcha PoW de Filemoon
// ============================================================
function re(t, e) { return (t << e | t >>> (32 - e)) >>> 0; }
function ht(t, e) { return Math.imul(t, e) >>> 0; }
function ye(t) {
  t[0] = (t[0] + t[1]) >>> 0; t[3] = re(t[3] ^ t[0], 16);
  t[2] = (t[2] + t[3]) >>> 0; t[1] = re(t[1] ^ t[2], 12);
  t[0] = (t[0] + t[1]) >>> 0; t[3] = re(t[3] ^ t[0], 8);
  t[2] = (t[2] + t[3]) >>> 0; t[1] = re(t[1] ^ t[2], 7);
}
const be = 512, lt = 511, dr = 2, lr = 2654435761, hr = 2246822519;
function gr(t) {
  const e = new Uint32Array([1779033703, 3144134277, 1013904242, 2773480762]);
  for (let i = 0; i < t.length; i++) { e[0] = (e[0] + t[i]) >>> 0; e[0] = re(e[0], 7); ye(e); }
  for (let i = 0; i < 8; i++) ye(e);
  const r = new Uint32Array(be);
  for (let i = 0; i < be; i++) { ye(e); r[i] = (e[0] ^ e[2]) >>> 0; }
  for (let i = 0; i < dr; i++) {
    for (let s = 0; s < be; s++) {
      const a = r[s] & lt; let c = (r[s] + r[a]) >>> 0; c = re(c, 13);
      c = (c ^ ht(r[(s + 1) & lt], lr)) >>> 0; r[s] = c; e[0] = (e[0] ^ c) >>> 0; ye(e);
    }
  }
  const n = new Uint32Array(8); const o = be / 8;
  for (let i = 0; i < 8; i++) {
    ye(e); let s = e[0]; const a = i * o;
    for (let c = 0; c < o; c++) {
      const d = r[a + c]; s = (s + d) >>> 0; s = re(s, 5); s = (s ^ ht(d, hr)) >>> 0;
    }
    n[i] = (s ^ e[2]) >>> 0;
  }
  return n;
}
function wr(t) {
  let e = 0;
  for (let r = 0; r < t.length; r++) { const n = t[r]; if (n === 0) { e += 32; continue; } return e + Math.clz32(n); }
  return e;
}
function yr(t) {
  const e = new Uint8Array(t.length);
  for (let r = 0; r < t.length; r++) e[r] = t.charCodeAt(r) & 255;
  return e;
}
function solvePowCustom(nonce, difficulty) {
  let s = 0;
  const prefix = nonce + ':';
  while (true) {
    if (wr(gr(yr(prefix + s))) >= difficulty) return String(s);
    s++;
  }
}

/**
 * Normaliza la URL al formato /e/<id>
 */
function normalizeUrl(url) {
  const u = new URL(url);
  const match = u.pathname.match(/\/e\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error('ID de Filemoon no encontrado en la URL.');
  return { 
    embedUrl: `${u.origin}/e/${match[1]}`,
    id: match[1],
    origin: u.origin,
    hostname: u.hostname 
  };
}

/**
 * Helper para decodificar Base64 URL-safe a Buffer
 */
function base64UrlToBuffer(b64url) {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return Buffer.from(b64, 'base64');
}

/**
 * Helper to filter key parts based on version
 */
function filterKeyParts(version, key_parts) {
  if (!version || !Array.isArray(key_parts)) return key_parts || [];
  const v = String(version);
  const map = {};
  for (let n = 1; n <= 20; n++) {
    map[String(n)] = [n, 31 - n];
  }
  const indices = map[v];
  if (!indices) return key_parts;
  const [i, s] = indices;
  if (i < 1 || s < 1 || i > key_parts.length || s > key_parts.length) return [];
  return [key_parts[i - 1], key_parts[s - 1]].filter(k => typeof k === 'string' && k.length > 0);
}

/**
 * Desencripta el payload AES-256-GCM de Filemoon
 */
function decryptPlayback(data) {
  try {
    const { iv, payload, key_parts, version } = data;
    if (!iv || !payload || !key_parts) return null;

    const filteredParts = filterKeyParts(version, key_parts);
    const key = Buffer.concat(filteredParts.map(base64UrlToBuffer));
    const ivBuf = base64UrlToBuffer(iv);
    const payloadBuf = base64UrlToBuffer(payload);

    const tagLength = 16;
    const ciphertext = payloadBuf.slice(0, payloadBuf.length - tagLength);
    const tag = payloadBuf.slice(payloadBuf.length - tagLength);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, 'binary', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[Filemoon] Fallo en decodificación AES:', error.message);
    return null;
  }
}

/**
 * Helper to encode buffer to Base64URL
 */
function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Estrategia Nueva: Intenta obtener el enlace vía API /playback resolviendo el reto ECDSA (P-256)
 */
async function extractViaApi(id, origin) {
  console.log(`[Filemoon] Resolviendo reto de firmas ECDSA para API Playback: ${id}`);

  try {
    // 1. Obtener detalles del iframe dinámico
    const detailsUrl = `${origin}/api/videos/${id}/embed/details`;
    const detailsRes = await axios.get(detailsUrl, {
      headers: {
        ...getBrowserHeaders(`${origin}/e/${id}`, origin),
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': `${origin}/e/${id}`
      },
      timeout: 10000
    });

    if (!detailsRes.data || !detailsRes.data.embed_frame_url) return null;

    const iframeUrl = detailsRes.data.embed_frame_url;
    const iframeOrigin = new URL(iframeUrl).origin;

    // 2. Notificar cargado de settings (Esencial para registrar la sesión en el mirror)
    const settingsUrl = `${iframeOrigin}/api/videos/${id}/embed/settings`;
    await axios.get(settingsUrl, {
      headers: {
        ...getBrowserHeaders('', iframeOrigin),
        'X-Requested-With': 'XMLHttpRequest',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': iframeUrl,
        'x-embed-parent': `${origin}/e/${id}`
      },
      timeout: 10000
    });

    // Generar credenciales temporales de sesión
    const viewer_id = crypto.randomBytes(16).toString('hex');
    const device_id = crypto.randomBytes(16).toString('hex');
    const cookieHeader = `byse_viewer_id=${viewer_id}; byse_device_id=${device_id}`;

    const commonHeaders = {
      ...getBrowserHeaders('', iframeOrigin),
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieHeader,
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Dest': 'empty',
      'Referer': iframeUrl
    };

    // 3. Iniciar Captcha PoW
    const powStartUrl = `${iframeOrigin}/api/videos/${id}/embed/captcha`;
    const powStartRes = await axios.post(powStartUrl, {}, { headers: commonHeaders, timeout: 10000 });
    const { pow_nonce, pow_difficulty, pow_token } = powStartRes.data;

    // 4. Resolver Captcha PoW
    const solution = solvePowCustom(pow_nonce, pow_difficulty);

    // 5. Verificar Captcha PoW
    const powVerifyUrl = `${iframeOrigin}/api/videos/${id}/embed/captcha/verify`;
    const powVerifyRes = await axios.post(powVerifyUrl, { pow_token, solution }, { headers: commonHeaders, timeout: 10000 });
    const captchaToken = powVerifyRes.data.token;
    if (!captchaToken) return null;

    // 6. Obtener el desafío (nonce) para ECDSA
    const challengeUrl = `${iframeOrigin}/api/videos/access/challenge`;
    const chalRes = await axios.post(challengeUrl, {}, { headers: commonHeaders, timeout: 10000 });
    const challenge = chalRes.data;
    if (!challenge || !challenge.nonce) return null;

    // 7. Resolver desafío: Generar par de claves P-256 y firmar el nonce
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const rawSignature = crypto.sign('SHA256', Buffer.from(challenge.nonce), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363'
    });
    const signatureB64Url = base64UrlEncode(rawSignature);

    // 8. Enviar atestación (firma) para conseguir el token de reproducción
    const attestUrl = `${iframeOrigin}/api/videos/access/attest`;
    const attestPayload = {
      viewer_id,
      device_id,
      challenge_id: challenge.challenge_id,
      nonce: challenge.nonce,
      signature: signatureB64Url,
      public_key: { crv: "P-256", ext: true, key_ops: ["verify"], kty: "EC", x: jwk.x, y: jwk.y },
      client: {
        user_agent: commonHeaders['User-Agent'] || "Mozilla/5.0",
        architecture: "x86", bitness: "64", platform: "Windows", platform_version: "15.0.0", pixel_ratio: 1, screen_width: 1920, screen_height: 1080, hardware_concurrency: 8, device_memory: 8,
        canvas_hash: "jeimkzmqcKQaVx7N8UkpJIA25ytN5ewaNVwRb6ZHE20", audio_hash: "RyBmlOc4cA7XhqmvkyO40eo8sOa5q-CFlrTnf70qADY"
      },
      storage: {},
      attributes: { entropy: "high" }
    };

    const attRes = await axios.post(attestUrl, attestPayload, { headers: commonHeaders, timeout: 10000 });
    if (!attRes.data || !attRes.data.token) return null;

    // 9. Solicitar y decodificar el playback final
    const playbackUrl = `${iframeOrigin}/api/videos/${id}/embed/playback`;
    const pbPayload = {
      fingerprint: {
        token: attRes.data.token,
        viewer_id,
        device_id,
        confidence: attRes.data.confidence
      }
    };
    
    const pbHeaders = {
      ...commonHeaders,
      'x-embed-parent': `${origin}/e/${id}`,
      'X-Captcha-Token': captchaToken
    };

    const pbRes = await axios.post(playbackUrl, pbPayload, { headers: pbHeaders, timeout: 10000 });
    if (pbRes.data && pbRes.data.playback) {
      const decrypted = decryptPlayback(pbRes.data.playback);
      if (decrypted && decrypted.sources && decrypted.sources.length > 0) {
        const videoUrl = decrypted.sources[0].url;
        console.log(`[Filemoon] ✔ Enlace encontrado vía API Decryption`);
        return { videoUrl, type: 'm3u8' };
      }
    }
  } catch (err) {
    console.warn(`[Filemoon] Fallo en API Playback: ${err.message}`);
  }
  return null;
}

/**
 * Estrategia Antigua: Scrapea el HTML buscando file: "..."
 */
async function extractViaHtml(embedUrl, origin) {
  console.log(`[Filemoon] Intentando Scraping HTML: ${embedUrl}`);
  
  const pageRes = await fetchWithRetry(embedUrl, {
    referer: 'https://www.google.com/',
    origin,
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });

  const html = pageRes.data;

  // Busca .m3u8
  let match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);
  if (!match) match = html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)/i);

  if (match) {
    console.log(`[Filemoon] ✔ m3u8 encontrado vía HTML`);
    return { videoUrl: match[1], type: 'm3u8' };
  }

  // Fallback mp4
  match = html.match(/file\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)/i);
  if (match) {
    console.log(`[Filemoon] ✔ mp4 encontrado vía HTML`);
    return { videoUrl: match[1], type: 'mp4' };
  }

  return null;
}

/**
 * Extractor Principal
 */
async function extract(url) {
  const { embedUrl, id, origin } = normalizeUrl(url);

  // 1. Intenta la nueva API (Más común en mirrors modernos como bysejikuar)
  const apiResult = await extractViaApi(id, origin);
  if (apiResult) return { ...apiResult, referer: origin };

  // 2. Fallback al scraping tradicional
  const htmlResult = await extractViaHtml(embedUrl, origin);
  if (htmlResult) return { ...htmlResult, referer: origin };

  throw new Error('No se pudo extraer el enlace de Filemoon (ambas estrategias fallaron).');
}

module.exports = { extract };
