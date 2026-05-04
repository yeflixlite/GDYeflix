/**
 * routes/fetch.js  –  GET /fetch?url=...
 * Proxy ultra-ligero solo para HTML de PelisJuanita.
 * NO sirve video, audio, imágenes ni archivos binarios.
 * Consumo de ancho de banda: ~50-100KB por petición.
 */
'use strict';

const { Router }       = require('express');
const { fetchHandler } = require('../controllers/fetchController');

const router = Router();

router.get('/', fetchHandler);

module.exports = router;
