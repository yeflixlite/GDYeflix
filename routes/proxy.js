/**
 * routes/proxy.js  –  GET /proxy?url=...
 */
'use strict';

const { Router }       = require('express');
const { proxyHandler } = require('../controllers/proxyController');

const router = Router();

router.get('/', proxyHandler);

module.exports = router;
