/**
 * services/envivos/tycsports.js
 */
'use strict';
const { extractChannel } = require('./ksdExtractor');

async function extract() {
    return await extractChannel('tycsports');
}

module.exports = { extract };
