/**
 * services/envivos/fox2.js
 * Canal estático: Fox Sports 2 (m3u8 directo).
 * NOTA: el token de la URL caduca; si el canal empieza a fallar,
 * actualiza la constante con un token fresco.
 */
'use strict';

const FOX2_M3U8 =
  'https://9.ftlly.com/foxsports2_usa/mono.m3u8?token=97ae8533e46bd12ab815b4ab0f38d931654c2b6a-c9-1790399209-1790381209';

async function extract() {
  return {
    videoUrl: FOX2_M3U8,
    type: 'm3u8',
    referer: 'https://ftlly.com/'
  };
}

module.exports = { extract };