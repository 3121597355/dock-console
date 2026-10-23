'use strict';
/**
 * Windows adapter — thin wrapper around the long-lived PowerShell collector
 * (device tree) and typeperf (PDH counters). Both are push based, so there is no
 * synchronous inventory() here; consumers only ever call startInventory().
 */
const path = require('path');
const inventory = require('../inventory');
const perf = require('../perf');

function create(opts = {}) {
  const children = [];
  const caps = opts.caps || {};

  return {
    id: 'win32',
    caps: {
      platform: 'win32',
      inventory: caps.pnputilRelations ? 'pnputil /relations' : 'WMI fallback',
      perf: 'typeperf (PDH)',
      realCpuWatts: false,
      realBatteryWatts: false,
      linkSpeed: false,
    },
    startInventory() {
      children.push(
        inventory.start({
          scriptPath: path.join(__dirname, '..', 'collector.ps1'),
          cachePath: path.join(opts.cacheDir || '.', 'cache.json'),
          intervalMs: opts.inventoryIntervalMs || 2000,
          fallback: !caps.pnputilRelations,
          cwd: opts.cwd,
          onInventory: opts.onInventory,
          onStatus: opts.onStatus,
          onLog: opts.onLog,
        })
      );
      return this;
    },
    startPerf() {
      children.push(
        perf.start({
          cwd: opts.cwd,
          onSample: opts.onPerf,
          onStatus: opts.onPerfStatus,
        })
      );
      return this;
    },
    stop() {
      for (const c of children) { try { c.stop(); } catch (e) {} }
    },
  };
}

module.exports = { create };
