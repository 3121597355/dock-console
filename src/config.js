'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DEFAULTS = {
  port: 8787,
  host: '127.0.0.1',
  open: true,
  demo: false,
  inventoryIntervalMs: 2000,
  historySeconds: 2400,
  dock: {
    name: 'USB-C 扩展坞',
    vendorId: null, // force a hub vendor id (e.g. "2109"); null = auto-detect
  },
  power: {
    enabled: true,
    baseW: 8,        // board, memory, panel, fans
    cpuIdleW: 4,     // package power at 0 % load
    cpuMaxW: 45,     // package power at 100 % load ≈ CPU PL1/TDP
    diskWPerMBs: 0.6,
  },
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--port') out.port = Number(next());
    else if (a === '--host') out.host = next();
    else if (a === '--no-open') out.open = false;
    else if (a === '--open') out.open = true;
    else if (a === '--demo') out.demo = true;
    else if (a === '--no-power') out.power = { enabled: false };
    else if (a === '--cpu-watts') out.power = { ...(out.power || {}), cpuMaxW: Number(next()) };
    else if (a === '--config') out.__config = next();
  }
  return out;
}

function load(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  let fileCfg = {};
  const cfgPath = args.__config
    ? path.resolve(args.__config)
    : path.join(ROOT, 'config.json');

  if (fs.existsSync(cfgPath)) {
    try {
      fileCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      console.error(`[config] ${path.basename(cfgPath)} 解析失败，已忽略：${e.message}`);
    }
  }

  const envCfg = {};
  if (process.env.DOCK_PORT) envCfg.port = Number(process.env.DOCK_PORT);
  if (process.env.DOCK_HOST) envCfg.host = process.env.DOCK_HOST;
  if (process.env.DOCK_NO_OPEN === '1') envCfg.open = false;
  if (process.env.DOCK_CPU_WATTS) envCfg.power = { cpuMaxW: Number(process.env.DOCK_CPU_WATTS) };

  delete args.__config;
  const cfg = deepMerge(deepMerge(deepMerge(DEFAULTS, fileCfg), envCfg), args);
  cfg.root = ROOT;
  cfg.configPath = cfgPath;
  return cfg;
}

module.exports = { load, DEFAULTS, ROOT };
