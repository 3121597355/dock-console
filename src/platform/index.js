'use strict';
/**
 * Platform dispatch. Every adapter exposes the same shape:
 *
 *   { id, caps, startInventory(), startPerf(), stop() }
 *
 * The rest of the app never branches on process.platform.
 */

const SUPPORTED = ['win32', 'darwin', 'linux'];

function load(platform = process.platform) {
  if (!SUPPORTED.includes(platform)) return null;
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(`./${platform}`);
}

module.exports = { load, SUPPORTED };
