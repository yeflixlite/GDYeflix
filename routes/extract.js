/**
 * routes/extract.js  –  GET /extract?url=...
 */
'use strict';

const { Router }          = require('express');
const { extractHandler }  = require('../controllers/extractController');

const router = Router();

router.get('/', extractHandler);

module.exports = router;
