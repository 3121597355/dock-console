#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const pkg = require('../package.json');

const config = require('./config');
const caps = require('./capabilities');
const platform = require('./platform');
const gpu = require('./gpu');
const demo = require('./demo');
const { createServer } = require('./server');
const { buildModel, detectDock, diffModel } = require('./model');
const { createPowerModel } = require('./power');

const argv = process.argv.slice(2);
if (argv.includes('-v') || argv.includes('--version')) {
  console.log(pkg.version);
  process.exit(0);
}
if (argv.includes('-h') || argv.includes('--help')) {
  console.log(`
  ${pkg.name} ${pkg.version} — ${pkg.description}

  Usage
    npx ${pkg.name} [options]

  Options
    --port <n>        HTTP port (default 8787)
    --host <addr>     bind address (default 127.0.0.1)
    --demo            synthetic dock data, no hardware access
    --no-open         do not launch a browser
    --no-power        hide the power panel
    --cpu-watts <n>   peak CPU package power used by the estimate (default 45)
    --config <file>   path to a JSON config file
    -h, --help        this help
    -v, --version     print the version

  Everything is read from the local machine and served on localhost only.
`);
  process.exit(0);
}

const cfg = config.load();
const ROOT = cfg.root;
const HIST_MAX = cfg.historySeconds || 2400;

/* Probe once — each probe spawns helper processes, never do it per frame. */
const cap = caps.probe();

/* ------------------------------------------------------------------ state */
const state = {
  startedAt: Date.now(),
  m: {
    cpu: 0, cpuUtil: 0, freq: 0, mem: 0, memUsedGB: 0, memFreeGB: 0,
    diskR: 0, diskW: 0, netRx: 0, netTx: 0,
    gpuUtil: null, gpuW: null, gpuTemp: null, gpuMem: null, gpuMemTotal: null, gpuClock: null,
    cpuPackageW: null, battW: null,
  },
  perDisk: {},
  inv: null,
  derived: null,
  dockInfo: null,
  history: [],
  events: [],
  energyWh: 0,
  lastHistTs: 0,
  src: { inventory: 'boot', perf: 'boot', gpu: 'boot' },
};

/** Events are stored as a translation key + params; the browser renders them. */
function pushEvent(kind, key, params) {
  const p = params || {};
  const sig = `${kind}|${key}|${JSON.stringify(p)}`;
  const now = Date.now();
  const dup = state.events.find((e) => e.sig === sig && now - e.t < 4000);
  if (dup) return dup;
  const ev = { t: now, kind, k: key, p, sig };
  state.events.unshift(ev);
  if (state.events.length > 120) state.events.length = 120;
  return ev;
}

/* ----------------------------------------------------------------- model */
function mergeInventory(inv) {
  if (!state.inv) {
    state.inv = inv;
  } else {
    const prev = state.inv;
    state.inv = {
      ...inv,
      storage: (inv.storage && inv.storage.disks && inv.storage.disks.length) ? inv.storage : prev.storage,
      nics: (inv.nics && inv.nics.length) ? inv.nics : prev.nics,
      monitors: (inv.monitors && inv.monitors.length) ? inv.monitors : prev.monitors,
      battery: inv.battery || prev.battery,
    };
  }
  if (!state.dockInfo) {
    const byId = new Map((state.inv.devices || []).map((d) => [d.id, d]));
    const physical = (state.inv.devices || []).filter((d) => d.physical !== false && !d.isInterface);
    state.dockInfo = detectDock(physical, byId, cfg);
  }
  const model = buildModel(state.inv, cfg, state.dockInfo);
  diffModel(state.derived, model, pushEvent);
  state.derived = model;
}

const power = createPowerModel(cfg, cap);

/* ----------------------------------------------------------------- frame */
function frame(withHistory) {
  const p = power.compute(state.m);
  const now = Date.now();

  const dt = state.lastHistTs ? Math.min(5, (now - state.lastHistTs) / 1000) : 0;
  if (dt > 0) state.energyWh += (p.total * dt) / 3600;
  state.lastHistTs = now;

  const m = state.m;
  const sample = {
    t: now,
    p: p.total,
    pc: p.cpuPart,
    pg: p.gpuPart,
    cpu: +m.cpu.toFixed(1),
    gpu: m.gpuUtil,
    dr: +(m.diskR / 1048576).toFixed(2),
    dw: +(m.diskW / 1048576).toFixed(2),
    nr: +(m.netRx / 1048576).toFixed(2),
    nt: +(m.netTx / 1048576).toFixed(2),
  };
  state.history.push(sample);
  if (state.history.length > HIST_MAX) state.history.shift();

  const payload = {
    type: withHistory ? 'hello' : 'frame',
    t: now,
    demo: !!cfg.demo,
    version: pkg.version,
    m: {
      cpu: +m.cpu.toFixed(1),
      cpuUtil: +m.cpuUtil.toFixed(1),
      freq: +m.freq.toFixed(0),
      mem: +m.mem.toFixed(1),
      memUsedGB: +m.memUsedGB.toFixed(1),
      memFreeGB: +m.memFreeGB.toFixed(1),
      diskR: +(m.diskR / 1048576).toFixed(2),
      diskW: +(m.diskW / 1048576).toFixed(2),
      netRx: +(m.netRx / 1048576).toFixed(2),
      netTx: +(m.netTx / 1048576).toFixed(2),
      gpuUtil: m.gpuUtil,
      gpuW: m.gpuW,
      gpuTemp: m.gpuTemp,
      gpuMem: m.gpuMem,
      gpuMemTotal: m.gpuMemTotal,
      gpuClock: m.gpuClock,
      cpuPackageW: m.cpuPackageW,
      battW: m.battW,
    },
    power: p,
    energyWh: +state.energyWh.toFixed(3),
    perDisk: state.perDisk,
    model: state.derived,
    events: state.events.slice(0, 30),
    sources: state.src,
    startedAt: state.startedAt,
    caps: {
      gpuPower: cap.gpuPower,
      inventoryMode: cfg.demo
        ? 'demo'
        : (state.inv && state.inv.mode) || (adapter ? adapter.caps.inventory : null),
      platform: process.platform,
      realCpuWatts: m.cpuPackageW != null,
      realBatteryWatts: m.battW != null,
      linkSpeed: !!(state.derived && state.derived.all || []).some((d) => d.speed),
      diskSplit: process.platform !== 'darwin',
      inventoryIntervalMs: cfg.inventoryIntervalMs,
    },
    costMs: state.inv ? state.inv.costMs : null,
  };
  if (withHistory) payload.history = state.history;
  return payload;
}

/* ------------------------------------------------------------------ boot */
function banner(port) {
  const on = (v) => (v ? '\x1b[32mok\x1b[0m' : '\x1b[33mn/a\x1b[0m');
  const pad = (s) => s.padEnd(13);
  console.log('');
  console.log(`  \x1b[1m${pkg.name}\x1b[0m \x1b[2mv${pkg.version}\x1b[0m${cfg.demo ? '  \x1b[33m(demo data)\x1b[0m' : ''}`);
  console.log(`  \x1b[2m${'─'.repeat(52)}\x1b[0m`);
  console.log(`  ${pad('platform')}${cap.platform} ${os.release()} · node ${process.version}`);
  if (adapter) {
    console.log(`  ${pad('inventory')}${on(adapter.caps.inventory)} \x1b[2m${adapter.caps.inventory}\x1b[0m`);
    console.log(`  ${pad('sampling')}${on(adapter.caps.perf)} \x1b[2m${adapter.caps.perf}\x1b[0m`);
  } else if (cfg.demo) {
    console.log(`  ${pad('inventory')}\x1b[33mdemo\x1b[0m \x1b[2msynthetic dock\x1b[0m`);
  }
  console.log(`  ${pad('nvidia-smi')}${on(cap.gpuPower)}${cap.gpuPower ? ' \x1b[2m→ GPU power is real telemetry\x1b[0m' : ' \x1b[2m→ GPU layer hidden\x1b[0m'}`);
  if (adapter && adapter.caps.realCpuWatts) {
    console.log(`  ${pad('cpu watts')}\x1b[32mok\x1b[0m \x1b[2m→ RAPL package counter (measured)\x1b[0m`);
  }
  if (adapter && adapter.caps.realBatteryWatts) {
    console.log(`  ${pad('system watts')}\x1b[32mok\x1b[0m \x1b[2m→ battery voltage × amperage (measured on battery)\x1b[0m`);
  }
  console.log(`  ${pad('power model')}${cfg.power.enabled === false ? '\x1b[33moff\x1b[0m' : `\x1b[2mbase ${cfg.power.baseW}W + CPU ${cfg.power.cpuIdleW}–${cfg.power.cpuIdleW + cfg.power.cpuMaxW}W\x1b[0m`}`);
  console.log(`  \x1b[2m${'─'.repeat(52)}\x1b[0m`);
  console.log(`  \x1b[36mhttp://${cfg.host}:${port}\x1b[0m  \x1b[2m(Ctrl+C to stop)\x1b[0m`);
  console.log('');
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' });
    else if (process.platform === 'darwin') spawn('open', [url], { stdio: 'ignore' });
    else spawn('xdg-open', [url], { stdio: 'ignore' });
  } catch (e) {
    /* headless — the URL is printed above */
  }
}

const adapterMod = cfg.demo ? null : platform.load();
if (!cfg.demo && !adapterMod) {
  console.error(`
  ${pkg.name} does not support ${process.platform} yet.
  Supported: ${platform.SUPPORTED.join(', ')}.

  You can still explore the interface with synthetic data:

      npx ${pkg.name} --demo
`);
  process.exit(1);
}

const adapter = adapterMod
  ? adapterMod.create({
      caps: cap,
      cwd: ROOT,
      cacheDir: path.join(ROOT, 'data'),
      inventoryIntervalMs: cfg.inventoryIntervalMs,
      onInventory: mergeInventory,
      onStatus: (s) => { state.src.inventory = s; },
      onLog: (msg) => process.env.DOCK_DEBUG && console.error(`[inventory] ${msg}`),
      onPerf: (s) => {
        state.m.cpu = s.cpu;
        state.m.cpuUtil = s.cpuUtil;
        state.m.freq = s.freq;
        state.m.mem = s.mem;
        state.m.memUsedGB = s.memUsedGB;
        state.m.memFreeGB = s.memFreeGB;
        state.m.diskR = s.diskR;
        state.m.diskW = s.diskW;
        state.m.netRx = s.netRx;
        state.m.netTx = s.netTx;
        if (s.cpuPackageW !== undefined) state.m.cpuPackageW = s.cpuPackageW;
        if (s.battW !== undefined) state.m.battW = s.battW;
        if (s.perDisk) state.perDisk = s.perDisk;
        state.src.perf = 'ok';
      },
      onPerfStatus: (s) => { state.src.perf = s; },
    })
  : null;

const { server, broadcast } = createServer({
  getFrame: frame,
  publicDir: path.join(ROOT, 'public'),
});

let sources = [];

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  \x1b[31mPort ${cfg.port} is already in use.\x1b[0m  Try: npx ${pkg.name} --port ${cfg.port + 1}\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(cfg.port, cfg.host, () => {
  banner(cfg.port);

  if (cfg.demo) {
    state.src.inventory = 'ok';
    sources = demo.start({
      inventoryIntervalMs: cfg.inventoryIntervalMs,
      onInventory: mergeInventory,
      onPerf: (s) => { Object.assign(state.m, s); state.perDisk = s.perDisk || {}; state.src.perf = 'ok'; },
      onGpu: (s) => { Object.assign(state.m, s); state.src.gpu = 'ok'; },
    });
    pushEvent('info', 'event.demo', {});
  } else {
    adapter.startInventory();
    adapter.startPerf();
    sources.push(adapter);
    gpu.start({
      smiPath: cap.gpuSmi,
      onSample: (s) => { Object.assign(state.m, s); state.src.gpu = 'ok'; },
      onStatus: (s) => { state.src.gpu = s; },
    });
    pushEvent('info', 'event.started', { n: Math.round(cfg.inventoryIntervalMs / 1000) });
  }

  setInterval(() => broadcast(frame(false)), 1000);

  if (cfg.open) openBrowser(`http://${cfg.host}:${cfg.port}`);
});

function shutdown() {
  for (const s of sources) { try { s.stop(); } catch (e) {} }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
