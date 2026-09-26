/**
 * ============================================================
 *  utils/shortcut.js
 *  Atajos tipo "proveedor=ID" para no pegar la URL embed completa.
 *  Ejemplo:  /play?url=streamwish=abc123
 *            /extract?url=vidhide=xyz789
 *  El servidor expande el ID al host por defecto del proveedor;
 *  los servicios internos conservan su failover de espejos.
 * ============================================================
 */

'use strict';

/** Host por defecto (embed) de cada proveedor */
const DEFAULT_HOSTS = {
  streamwish : 'https://streamwish.to/e/',
  sw         : 'https://streamwish.to/e/',
  wishembed  : 'https://wishembed.net/e/',
  hgcloud    : 'https://hgcloud.to/e/',
  vidhide    : 'https://minochinos.com/v/',
  filemoon   : 'https://filemoon.sx/e/',
  fm         : 'https://filemoon.sx/e/',
  voe        : 'https://voe.sx/e/',
  goodstream : 'https://goodstream.one/e/',
};

/** Patrón típico de IDs: mezcla de letras, números, guiones y puntos */
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Intenta expandir una cadena en formato "proveedor=ID".
 * Devuelve la URL embed completa, o null si NO es un atajo válido.
 * @param {string} input - Texto del parámetro ?url= (ya decodificado)
 * @returns {string|null}
 */
function tryExpandShortcut(input) {
  if (!input) return null;

  const text = String(input).trim();

  // Si parece URL completa, no es un atajo
  if (/^https?:\/\//i.test(text)) return null;

  const eqIndex = text.indexOf('=');
  if (eqIndex <= 0) return null;

  const provider = text.slice(0, eqIndex).trim().toLowerCase();
  const idRaw    = text.slice(eqIndex + 1).trim();

  const base = DEFAULT_HOSTS[provider];
  if (!base || !ID_RE.test(idRaw)) return null;

  // El ID puede venir como "id" o "e/id" (forma corta de la ruta embed)
  const id = idRaw.split('/').filter(Boolean).pop();
  if (!ID_RE.test(id)) return null;

  return base + id;
}

module.exports = { tryExpandShortcut, DEFAULT_HOSTS };