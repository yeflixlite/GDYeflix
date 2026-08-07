/**
 * services/envivos/tudn.js
 */
'use strict';
const { extractChannel } = require('./ksdExtractor');

async function extract() {
    return await extractChannel('tudn');
}

module.exports = { extract };
