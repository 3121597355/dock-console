'use strict';
/**
 * macOS adapter.
 *
 * Sources (all first-party CLI, nothing to install):
 *   • system_profiler SPUSBDataType -json  → the USB tree, including the nested
 *     hubs a dock exposes and any mass-storage media sitting under them
 *   • system_profiler SPDisplaysDataType   → external displays
 *   • top -l 0 -n 0 -s 1                   → CPU + memory, streamed at 1 Hz
 *   • netstat -ibn                          → cumulative interface counters
 *   • iostat -d -w 1                        → per-disk throughput
 *   • ioreg -rn AppleSmartBattery           → voltage × amperage = real watts
 *
 * The AppleSmartBattery path is worth calling out: on battery power the machine
 * reports its actual draw, so the dashboard can show a measured total instead of
 * a model output. That is strictly better than what Windows offers.
 */

const { spawn, execFile, execFileSync } = require('child_process');
const os = require('os');

const USB_KEYS = ['speed', 'link_speed', 'device_speed'];
const ROOT_NAME = /^(usb\s*[\d.]+\s*bus|.*root hub|usb.*host controller)/i;

function run(cmd, args, timeout = 15000) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    return '';
  }
}

function runJson(cmd, args) {
  const out = run(cmd, args);
  if (!out) return null;
  try { return JSON.parse(out); } catch (e) { return null; }
}

/** "Up to 5 Gb/sec" / "480 Mb/sec" / "480" → Mbps */
function parseSpeed(node) {
  for (const k of USB_KEYS) {
    const raw = node[k];
    if (raw == null) continue;
    const s = String(raw).trim();
    const bare = s.match(/^([\d.]+)$/);
    if (bare) return parseFloat(bare[1]);
    const m = s.match(/([\d.]+)\s*([KMGT])/i);
    if (!m) continue;
    const v = parseFloat(m[1]);
    const unit = m[2].toUpperCase();
    if (!Number.isFinite(v)) continue;
    if (unit === 'G') return v * 1000;
    if (unit === 'M') return v;
    if (unit === 'K') return v / 1000;
    if (unit === 'T') return v * 1e6;
  }
  return null;
}

function hexId(v) {
  if (!v) return '';
  const m = String(v).match(/0x([0-9a-f]{1,4})/i);
  return m ? m[1].toLowerCase().padStart(4, '0') : '';
}

/** system_profiler nests devices under buses that carry no vendor_id. Those
 *  containers are treated as roots so the dock detection in model.js (hubs whose
 *  parent is a root) keeps working across macOS versions. */
function flatten(roots) {
  const out = [];
  const seen = new Set();
  let busIndex = -1;

  const walk = (node, parentId, depth, path) => {
    if (!node || typeof node !== 'object') return;
    const name = String(node._name || '');
    const vid = hexId(node.vendor_id);
    const pid = hexId(node.product_id);
    const kids = Array.isArray(node._items) ? node._items : null;
    const container = !vid;
    const root = container || ROOT_NAME.test(name);

    let id;
    if (container) {
      id = `mac:bus:${path}`;
    } else {
      const loc = node.location_id != null ? String(node.location_id) : `p${path}`;
      id = `mac:${busIndex}:${loc}:${vid}:${pid}`;
      if (seen.has(id)) id = `${id}#${seen.size}`;
      seen.add(id);
    }

    if (!container) {
      const media = Array.isArray(node.Media) ? node.Media : [];
      const m0 = media[0] || {};
      const sizeBytes = Number(m0.size_in_bytes || m0.size || 0) || 0;
      out.push({
        id,
        parent: parentId,
        desc: name,
        busname: name,
        name,
        cls: kids && kids.length ? 'USB' : media.length ? 'DiskDrive' : 'USBDevice',
        mfg: String(node.manufacturer || ''),
        serial: String(node.serial_num || ''),
        status: 'ok',
        problem: '',
        loc: String(node.location_id || ''),
        port: '',
        isHub: !!(kids && kids.length),
        root,
        physical: true,
        speed: parseSpeed(node),
        vid,
        pid,
        kinds: kids && kids.length ? ['Hub'] : media.length ? ['DiskDrive'] : [],
        disk: sizeBytes
          ? {
              n: null,
              sizeGB: +(sizeBytes / 1e9).toFixed(1),
              model: String(m0._name || name).replace(/\s+Media$/i, ''),
              letters: [String(m0.mount_point || '')].filter(Boolean).slice(0, 2),
              name: String(m0.bsd_name || ''),
            }
          : null,
      });
    }

    for (let i = 0; i < (kids ? kids.length : 0); i++) {
      walk(kids[i], id, depth + 1, `${path}.${i}`);
    }
  };

  const list = Array.isArray(roots) ? roots : [];
  for (let i = 0; i < list.length; i++) {
    busIndex = i;
    walk(list[i], null, 0, String(i));
  }
  return out;
}

function usbTree() {
  const j = runJson('system_profiler', ['SPUSBDataType', '-json']);
  if (!j) return [];
  return flatten(j.SPUSBDataType || j['SPUSBDataType']);
}

function monitors() {
  const j = runJson('system_profiler', ['SPDisplaysDataType', '-json']);
  if (!j) return [];
  const out = [];
  for (const gpu of j.SPDisplaysDataType || []) {
    for (const d of gpu.spdisplays_ndrvs || []) {
      const conn = String(d.spdisplays_connection_type || '');
      const internal = /internal/i.test(conn);
      out.push({
        mfr: String(d._spdisplays_edid_manufacturer || d.spdisplays_vendor || '').slice(0, 24),
        model: String(d._name || '').replace(/^.*?\((.*)\)$/, '$1') || String(d._name || ''),
        connector: conn.replace('spdisplays_', ''),
        active: true,
        internal,
        resolution: String(d._spdisplays_pixels || d.spdisplays_resolution || '') || undefined,
      });
    }
  }
  return out;
}

function nics() {
  const text = run('ifconfig', ['-a']) || '';
  const out = [];
  for (const block of text.split(/^(?=\S)/m)) {
    const first = block.split('\n')[0] || '';
    const m = first.match(/^([a-z0-9]+):\s*flags=\S+\s*<([^>]*)>/i);
    if (!m) continue;
    const name = m[1];
    if (/^(lo|gif|stf|utun|llw|awdl|bridge|anpi|ap\d)/.test(name)) continue;
    const up = /\bUP\b/.test(m[2].split(',').map((s) => s.trim()).join(','));
    const media = (block.match(/media:\s*([^\n]+)/) || [])[1] || '';
    const wifi = /802\.11/.test(media);
    const ethernet = !wifi && /baseT|baseTX|base-SX|1000base/i.test(media);
    const mac = (block.match(/ether\s+([0-9a-f:]{17})/i) || [])[1] || '';
    out.push({
      name,
      desc: `${media.replace(/\s*\(.*/, '').trim() || name}`,
      kind: ethernet ? 'ethernet' : wifi ? 'wifi' : 'other',
      status: up ? 'Up' : 'Disconnected',
      up,
      speed: (media.match(/\((\d+(?:\.\d+)?)\s*base/i) || [])[1]
        ? `${(media.match(/\((\d+)/) || [])[1]} Mbps`
        : '',
      mac,
    });
  }
  return out;
}

function battery() {
  const text = run('pmset', ['-g', 'batt']) || '';
  if (!text) return null;
  const pct = (text.match(/(\d+)%/) || [])[1];
  if (pct == null) return null;
  const ac = /AC Power/.test(text);
  const state = (text.match(/;\s*([a-z ]+);/) || [])[1] || '';

  const io = run('ioreg', ['-rn', 'AppleSmartBattery', '-w0']) || '';
  const pick = (k) => {
    const m = io.match(new RegExp(`"${k}"\\s*=\\s*(-?\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const voltMv = pick('Voltage');
  const ampMa = pick('Amperage');
  const full = pick('AppleRawMaxCapacity') || pick('MaxCapacity');
  const design = pick('DesignCapacity');
  const watts = voltMv && ampMa != null ? Math.abs((voltMv / 1000) * (ampMa / 1000)) : null;

  return {
    pct: Number(pct),
    ac,
    charging: /charging/i.test(state) && !/discharging/i.test(state),
    volt: voltMv ? +(voltMv / 1000).toFixed(3) : null,
    watts: watts != null ? +watts.toFixed(1) : null,
    remainMWh: null,
    fullMWh: full ? full : null,
    designMWh: design ? design : null,
    health: full && design ? Math.round((full / design) * 100) : null,
    chargeRate: ac && watts ? Math.round(watts * 1000) : 0,
    disRate: !ac && watts ? Math.round(watts * 1000) : 0,
    name: 'AppleSmartBattery',
  };
}

function host() {
  const cpu = (run('sysctl', ['-n', 'machdep.cpu.brand_string']) || '').trim()
    || (run('sysctl', ['-n', 'hw.model']) || '').trim()
    || os.cpus()[0] && os.cpus()[0].model
    || 'CPU';
  const memBytes = Number((run('sysctl', ['-n', 'hw.memsize']) || '').trim()) || os.totalmem();
  const model = (run('sysctl', ['-n', 'hw.model']) || '').trim();
  return {
    cpu,
    cores: os.cpus().length,
    ramGB: +(memBytes / 1073741824).toFixed(1),
    os: `macOS ${os.release()}`,
    vendor: 'Apple',
    model,
    hostname: os.hostname(),
  };
}

/* ------------------------------------------------------------------ perf */

function parseTopChunk(chunk) {
  const out = {};
  const cpu = chunk.match(/CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/);
  if (cpu) out.cpu = +(100 - parseFloat(cpu[3])).toFixed(1);

  const mem = chunk.match(/PhysMem:\s*([\d.]+)([KMG])\s*used.*?,\s*([\d.]+)([KMG])\s*unused/);
  if (mem) {
    const toGb = (v, u) => (u === 'G' ? v : u === 'M' ? v / 1024 : v / 1048576);
    const used = toGb(parseFloat(mem[1]), mem[2]);
    const free = toGb(parseFloat(mem[3]), mem[4]);
    const total = used + free;
    if (total > 0) {
      out.mem = +((used / total) * 100).toFixed(1);
      out.memUsedGB = +used.toFixed(2);
      out.memFreeGB = +free.toFixed(2);
    }
  }
  return Object.keys(out).length ? out : null;
}

function parseNetstat(text) {
  const counters = new Map();
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const name = f[0];
    if (/^(lo|gif|stf|utun|llw|awdl|bridge|anpi|ap\d)/.test(name)) continue;
    const ib = Number(f[6]);
    const ob = Number(f[9]);
    if (!Number.isFinite(ib) || !Number.isFinite(ob)) continue;
    const prev = counters.get(name);
    counters.set(name, { rx: Math.max(prev ? prev.rx : 0, ib), tx: Math.max(prev ? prev.tx : 0, ob) });
  }
  return counters;
}

/** iostat -d -w 1 prints a device-name header once, then one numeric row per
 *  second. Values come in (KB/t, tps, MB/s) triplets, one per disk. */
function parseIostat(chunk, names) {
  const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
  const result = { names, values: null };
  for (const line of lines) {
    if (/^KB\/t/.test(line)) continue;
    const cols = line.split(/\s+/);
    if (cols.every((c) => /^disk\d+$/.test(c))) { result.names = cols; continue; }
    if (cols.every((c) => /^-?[\d.]+$/.test(c)) && cols.length % 3 === 0) {
      const mb = [];
      for (let i = 0; i < cols.length; i += 3) mb.push(parseFloat(cols[i + 2]) || 0);
      result.values = mb;
    }
  }
  return result;
}

function create(opts = {}) {
  const intervalMs = opts.intervalMs || 1000;
  const invMs = opts.inventoryIntervalMs || 4000;
  let invTimer = null;
  let stopped = false;
  const procs = [];
  let prevNet = null;
  let diskNames = [];
  let batteryCache = null;
  let batteryAt = 0;

  const state = {
    cpu: 0, cpuUtil: 0, freq: 0, mem: 0, memUsedGB: 0, memFreeGB: 0,
    diskR: 0, diskW: 0, netRx: 0, netTx: 0, perDisk: {},
    cpuPackageW: null, battW: null,
  };

  function emit(patch) {
    Object.assign(state, patch);
    opts.onPerf && opts.onPerf({ ...state });
  }

  function track(child) {
    procs.push(child);
    child.on('error', () => {});
    return child;
  }

  function startTop() {
    const child = track(spawn('top', ['-l', '0', '-n', '0', '-s', '1', '-stats', 'pid'], { stdio: ['ignore', 'pipe', 'ignore'] }));
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      buf += c;
      // a sample block ends with the CPU line; render on each arrival
      const chunk = buf;
      buf = '';
      const patch = parseTopChunk(chunk);
      if (patch) emit(patch);
    });
    child.on('exit', () => { if (!stopped) setTimeout(startTop, 3000); });
  }

  function startIostat() {
    const child = track(spawn('iostat', ['-d', '-w', '1'], { stdio: ['ignore', 'pipe', 'ignore'] }));
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      buf += c;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const r = parseIostat(line, diskNames);
        if (r.names !== diskNames) diskNames = r.names;
        if (r.values) {
          const perDisk = {};
          let total = 0;
          r.values.forEach((mb, idx) => {
            total += mb * 1e6;
            perDisk[idx] = { r: mb * 1e6, w: 0 };
          });
          emit({ diskR: total, diskW: 0, perDisk });
        }
      }
    });
    child.on('exit', () => { if (!stopped) setTimeout(startIostat, 3000); });
  }

  function pollNet() {
    if (stopped) return;
    const text = run('netstat', ['-ibn'], 8000);
    const cur = parseNetstat(text);
    if (prevNet) {
      let rx = 0;
      let tx = 0;
      for (const [name, c] of cur) {
        const p = prevNet.get(name);
        if (!p) continue;
        rx += Math.max(0, c.rx - p.rx);
        tx += Math.max(0, c.tx - p.tx);
      }
      emit({ netRx: rx, netTx: tx });
    }
    prevNet = cur;
  }

  function pollBattery() {
    const now = Date.now();
    if (now - batteryAt < 5000 && batteryCache) return batteryCache;
    batteryAt = now;
    batteryCache = battery();
    if (batteryCache) {
      emit({ battW: !batteryCache.ac && batteryCache.watts != null ? batteryCache.watts : null });
    }
    return batteryCache;
  }

  return {
    id: 'darwin',
    caps: {
      platform: 'darwin',
      inventory: 'system_profiler',
      perf: 'top/iostat/netstat',
      realCpuWatts: false, // powermetrics needs root; not worth prompting for
      realBatteryWatts: true,
      linkSpeed: true,
    },
    inventory() {
      const t0 = Date.now();
      const inv = {
        type: 'inv',
        ts: Date.now(),
        host: host(),
        uptime: Math.round(os.uptime()),
        battery: pollBattery(),
        devices: usbTree(),
        storage: { disks: [], volumes: [] },
        nics: nics(),
        monitors: monitors(),
        costMs: Date.now() - t0,
        mode: 'system_profiler',
      };
      opts.onInventory && opts.onInventory(inv);
      return inv;
    },
    startInventory() {
      this.inventory();
      invTimer = setInterval(() => { if (!stopped) this.inventory(); }, invMs);
      opts.onStatus && opts.onStatus('ok');
      return this;
    },
    startPerf() {
      startTop();
      startIostat();
      pollNet();
      setInterval(pollNet, Math.max(1000, intervalMs));
      opts.onPerfStatus && opts.onPerfStatus('ok');
      return this;
    },
    stop() {
      stopped = true;
      clearInterval(invTimer);
      for (const p of procs) { try { p.kill(); } catch (e) {} }
    },
    _parsers: { parseSpeed, flatten, parseTopChunk, parseNetstat, parseIostat, hexId },
  };
}

module.exports = {
  create,
  parseSpeed,
  flatten,
  parseTopChunk,
  parseNetstat,
  parseIostat,
  hexId,
  usbTree,
  battery,
};
