/**
 * routes/play.js  –  GET /play?url=...
 */
'use strict';

const { Router }     = require('express');
const { playHandler} = require('../controllers/playController');

const router = Router();

router.get('/', playHandler);

module.exports = router;
