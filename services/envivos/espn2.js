/**
 * services/envivos/espn2.js
 */
'use strict';
const { extractChannel } = require('./ksdExtractor');

async function extract() {
    return await extractChannel('espn2');
}

module.exports = { extract };
