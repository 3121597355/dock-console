'use strict';
/**
 * Linux adapter — everything comes from sysfs + procfs.
 *
 * No child processes, no parsing of human-readable command output: a full
 * inventory is ~40 small file reads and a sample is ~8. That makes 1 Hz (or
 * even 4 Hz) essentially free, and it means the numbers below are the kernel's
 * own view rather than a guess.
 *
 * Compared with Windows this platform exposes two things the dashboard cares
 * about and Windows does not:
 *   • per-device negotiated link speed (…/speed) — no more inferring USB 2.0 vs
 *     3.x from a hub's model string;
 *   • real CPU package wattage via RAPL (…/powercap/intel-rapl:0/energy_uj).
 */

const fs = require('fs');

const USB = '/sys/bus/usb/devices';
const IFACE_CLASS = {
  1: 'MEDIA', 2: 'Net', 3: 'HIDClass', 6: 'Image', 7: 'Printer',
  8: 'DiskDrive', 10: 'Net', 11: 'SmartCard', 14: 'Camera', 224: 'USBDevice', 255: 'USBDevice',
};

/* ------------------------------------------------------------------ reader */

/** File access goes through a prefix so the parsers can be tested against a
 *  fixture tree instead of the live machine. */
function makeReader(root = '') {
  return {
    read(p) { try { return fs.readFileSync(root + p, 'utf8'); } catch (e) { return ''; } },
    trim(p) { return this.read(p).trim(); },
    buf(p) { try { return fs.readFileSync(root + p); } catch (e) { return null; } },
    ls(p) { try { return fs.readdirSync(root + p); } catch (e) { return []; } },
    real(p) { try { return fs.realpathSync(root + p); } catch (e) { return ''; } },
  };
}

const num = (v, d = null) => {
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : d;
};

/* --------------------------------------------------------------- inventory */

/** "1-1.4.2" → "1-1.4"; "1-1" → root hub "usb1". */
function parentOf(name) {
  if (/^usb\d+$/.test(name)) return null;
  const m = name.match(/^(\d+)-(.+)$/);
  if (!m) return null;
  const parts = m[2].split('.');
  if (parts.length === 1) return `usb${m[1]}`;
  parts.pop();
  return `${m[1]}-${parts.join('.')}`;
}

function usbInventory(r) {
  const names = r.ls(USB);
  const ifaces = names.filter((n) => n.includes(':'));
  const nodes = names.filter((n) => !n.includes(':'));

  // interface-class → device shape, the sysfs equivalent of Windows' child nodes
  const kinds = new Map();
  for (const n of ifaces) {
    const owner = n.split(':')[0];
    const cls = parseInt(r.trim(`${USB}/${n}/bInterfaceClass`), 16);
    const label = IFACE_CLASS[cls];
    if (!label) continue;
    if (!kinds.has(owner)) kinds.set(owner, new Set());
    kinds.get(owner).add(label);
  }

  const devices = [];
  for (const name of nodes) {
    const base = `${USB}/${name}`;
    const root = /^usb\d+$/.test(name);
    const vid = r.trim(`${base}/idVendor`).toLowerCase();
    const pid = r.trim(`${base}/idProduct`).toLowerCase();
    if (!root && !vid) continue; // unplugged between readdir and read

    const product = r.trim(`${base}/product`);
    const speed = num(r.trim(`${base}/speed`));
    const devClass = parseInt(r.trim(`${base}/bDeviceClass`), 16);
    const isHub = devClass === 9;
    const bus = root ? name.slice(3) : name.split('-')[0];
    const portChain = root ? '' : name.split('-')[1];
    const kindList = [...(kinds.get(name) || [])];

    devices.push({
      id: name,
      parent: parentOf(name),
      desc: product || (root ? `USB ${bus} root hub` : `USB device ${vid}:${pid}`),
      busname: product,
      name: product,
      cls: isHub ? 'USB' : kindList[0] || 'USBDevice',
      mfg: r.trim(`${base}/manufacturer`),
      serial: r.trim(`${base}/serial`),
      status: 'ok',
      loc: root ? '' : portChain,
      port: root ? '' : portChain.split('.').pop(),
      isHub,
      root,
      physical: true,
      speed,
      vid,
      pid,
      kinds: kindList,
    });
  }
  return devices;
}

function blockDevices(r, resolve = (x) => r.real(x)) {
  const names = r.ls('/sys/block').filter((n) => /^(sd|mmcblk|nvme)/.test(n)).sort();
  const mounts = mountPoints(r);
  const out = [];
  let idx = 0;
  for (const name of names) {
    const real = resolve(`/sys/block/${name}`);
    // the path may contain several USB nodes (…/usb1/1-1/1-1.1/1-1.1.2/…);
    // the deepest one is the device that actually owns this disk
    const hits = real.match(/\/(\d+-\d+(?:\.\d+)*)\//g) || [];
    const usbName = hits.length ? hits[hits.length - 1].slice(1, -1) : null;
    const sectors = num(r.trim(`/sys/block/${name}/size`), 0);
    const vendor = r.trim(`/sys/block/${name}/device/vendor`);
    const model = r.trim(`/sys/block/${name}/device/model`);
    const bus = usbName ? 'USB' : /\/nvme\//.test(real) ? 'NVMe' : 'SATA';
    out.push({
      n: idx++,
      name,
      usbName,
      bus,
      model: `${vendor} ${model}`.trim() || name,
      sizeGB: +((sectors * 512) / 1e9).toFixed(1),
      letters: (mounts.get(name) || []).slice(0, 2),
    });
  }
  return out;
}

function mountPoints(r) {
  const map = new Map();
  for (const line of r.read('/proc/mounts').split('\n')) {
    const f = line.split(/\s+/);
    if (f.length < 2 || !f[0].startsWith('/dev/')) continue;
    const disk = f[0].replace(/^\/dev\//, '').replace(/p?\d+$/, '');
    if (!map.has(disk)) map.set(disk, []);
    // the UI shows this next to the capacity, so keep it to a volume label
    // rather than a full mount path ("/media/user/Elements" → "Elements")
    const mp = f[1] === '/' ? '/' : f[1].split('/').filter(Boolean).pop();
    if (mp) map.get(disk).push(mp);
  }
  return map;
}

function readBattery(r) {
  for (const name of r.ls('/sys/class/power_supply')) {
    if (!/^BAT/i.test(name)) continue;
    const b = `/sys/class/power_supply/${name}`;
    const pct = num(r.trim(`${b}/capacity`));
    if (pct == null) continue;

    const status = r.trim(`${b}/status`).toLowerCase();
    const voltUv = num(r.trim(`${b}/voltage_now`));
    const ampUa = num(r.trim(`${b}/current_now`));
    const powerUw = num(r.trim(`${b}/power_now`));
    const fullUwh = num(r.trim(`${b}/energy_full`));
    const designUwh = num(r.trim(`${b}/energy_full_design`));
    // energy_* is µWh, charge_* is µAh — normalise both to mWh so the UI does
    // not have to know which driver the laptop happens to use
    const fullMWh = fullUwh != null ? fullUwh / 1000 : null;
    const designMWh = designUwh != null ? designUwh / 1000 : null;

    let watts = null;
    if (powerUw != null && powerUw > 0) watts = powerUw / 1e6;
    else if (voltUv != null && ampUa != null) watts = (voltUv / 1e6) * (Math.abs(ampUa) / 1e6);

    return {
      pct: Math.round(pct),
      ac: status === 'charging' || status === 'full' || status === 'not charging',
      charging: status === 'charging',
      volt: voltUv != null ? +(voltUv / 1e6).toFixed(3) : null,
      watts: watts != null ? +watts.toFixed(1) : null,
      remainMWh: null,
      fullMWh: fullMWh != null ? Math.round(fullMWh) : null,
      designMWh: designMWh != null ? Math.round(designMWh) : null,
      health: fullMWh && designMWh ? Math.round((fullMWh / designMWh) * 100) : null,
      chargeRate: status === 'charging' && watts ? Math.round(watts * 1000) : 0,
      disRate: status === 'discharging' && watts ? Math.round(watts * 1000) : 0,
      name,
    };
  }
  return null;
}

function readNics(r) {
  const out = [];
  for (const name of r.ls('/sys/class/net')) {
    if (name === 'lo') continue;
    const d = `/sys/class/net/${name}`;
    const driver = r.real(`${d}/device/driver`).split('/').pop() || '';
    const speed = num(r.trim(`${d}/speed`));
    const state = r.trim(`${d}/operstate`);
    const wireless = r.ls(`${d}/wireless`).length > 0 || /^wl/.test(name);
    const ethernet = !wireless && (/^(en|eth)/.test(name) || /^(r8169|e1000e?|igb|igc|r8152|cdc_ether|cdc_ncm|ax88|tg3|atlantic)$/.test(driver));
    out.push({
      name,
      desc: driver ? `${driver} ${name}` : name,
      kind: ethernet ? 'ethernet' : wireless ? 'wifi' : 'other',
      status: state === 'up' ? 'Up' : 'Disconnected',
      up: state === 'up',
      speed: speed ? `${speed} Mbps` : '',
      mac: r.trim(`${d}/address`),
    });
  }
  return out;
}

function edidMonitor(buf, connector) {
  if (!buf || buf.length < 128) return null;
  const v = (buf[8] << 8) | buf[9];
  const mfr = String.fromCharCode(((v >> 10) & 31) + 64, ((v >> 5) & 31) + 64, (v & 31) + 64).trim();
  let model = '';
  for (const off of [54, 72, 90, 108]) {
    if (buf[off + 3] === 0xfc) {
      model = buf.toString('latin1', off + 5, off + 18).replace(/[\x00-\x1f]/g, '').trim();
      break;
    }
  }
  return {
    mfr: /^[A-Z]{3}$/.test(mfr) ? mfr : '',
    model: model || '',
    connector,
    active: true,
    internal: /^eDP/i.test(connector),
  };
}

function readMonitors(r) {
  const out = [];
  for (const name of r.ls('/sys/class/drm')) {
    const m = name.match(/^card\d+-(.+)$/);
    if (!m) continue;
    if (r.trim(`/sys/class/drm/${name}/status`) !== 'connected') continue;
    const edid = edidMonitor(r.buf(`/sys/class/drm/${name}/edid`), m[1]);
    if (edid) out.push(edid);
  }
  return out;
}

function readHost(r) {
  let cpu = '';
  let cores = 0;
  for (const line of r.read('/proc/cpuinfo').split('\n')) {
    if (line.startsWith('model name')) { cpu = line.split(':')[1].trim(); }
    if (line.startsWith('processor')) cores++;
  }
  const memKb = num((r.read('/proc/meminfo').match(/MemTotal:\s*(\d+)/) || [])[1], 0);
  const osName = (r.read('/etc/os-release').match(/^PRETTY_NAME="?([^"\n]+)"?/m) || [])[1] || '';
  const vendor = r.trim('/sys/devices/virtual/dmi/id/sys_vendor');
  const model = r.trim('/sys/devices/virtual/dmi/id/product_name');
  return {
    cpu: cpu || 'CPU',
    cores: cores || require('os').cpus().length,
    ramGB: memKb ? +(memKb / 1048576).toFixed(1) : null,
    os: osName || `${require('os').type()} ${require('os').release()}`,
    vendor,
    model,
    hostname: (r.trim('/proc/sys/kernel/hostname') || ''),
  };
}

function readUptime(r) {
  return Math.round(num((r.read('/proc/uptime') || '').split(' ')[0], 0));
}

/* ------------------------------------------------------------- power rails */

function raplPath(r) {
  const dirs = r.ls('/sys/class/powercap').filter((n) => /^intel-rapl:\d+$/.test(n)).sort();
  if (!dirs.length) return null;
  for (const d of dirs) {
    if (/package/i.test(r.trim(`/sys/class/powercap/${d}/name`)) || d === 'intel-rapl:0') {
      return `/sys/class/powercap/${d}`;
    }
  }
  return `/sys/class/powercap/${dirs[0]}`;
}

/* ---------------------------------------------------------------- sampler */

function createSampler(r, { onSample } = {}) {
  let prevCpu = null;
  let prevNet = null;
  let prevDisk = null;
  let prevRapl = null;
  let diskIndex = new Map();

  function cpuLine() {
    for (const line of r.read('/proc/stat').split('\n')) {
      if (line.startsWith('cpu ')) return line.trim().split(/\s+/).slice(1).map(Number);
    }
    return null;
  }

  function diskCounters() {
    const counters = new Map();
    for (const line of r.read('/proc/diskstats').split('\n')) {
      const f = line.trim().split(/\s+/);
      if (f.length < 14) continue;
      const name = f[2];
      if (!/^(sd|mmcblk|nvme)/.test(name)) continue;
      // NVMe reports partitions as nvme0n1p1 — only keep whole disks
      if (/(p\d+|\d)$/.test(name) && !/^nvme\d+n\d+$/.test(name) && !/^sd[a-z]+$/.test(name)) continue;
      counters.set(name, { r: +f[5] * 512, w: +f[9] * 512 });
    }
    return counters;
  }

  function netCounters() {
    const counters = new Map();
    const text = r.read('/proc/net/dev');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([^:]+):\s*(.+)$/);
      if (!m) continue;
      const name = m[1].trim();
      if (/^(lo|docker|veth|br-|virbr|tun|tap|wg)/.test(name)) continue;
      const f = m[2].trim().split(/\s+/).map(Number);
      counters.set(name, { rx: f[0], tx: f[8] });
    }
    return counters;
  }

  function raplWatts(now) {
    const base = raplPath(r);
    if (!base) return null;
    const e = num(r.trim(`${base}/energy_uj`));
    if (e == null) return null;
    const maxRange = num(r.trim(`${base}/max_energy_range_uj`)) || 0;
    if (prevRapl && now > prevRapl.t) {
      let delta = e - prevRapl.e;
      if (delta < 0 && maxRange) delta += maxRange; // counter wrapped
      const dt = (now - prevRapl.t) / 1000;
      prevRapl = { e, t: now };
      if (dt < 0.2) return null;
      const w = delta / 1e6 / dt;
      return w >= 0 && w < 500 ? +w.toFixed(2) : null;
    }
    prevRapl = { e, t: now };
    return null;
  }

  function sample() {
    const now = Date.now();
    const s = {
      cpu: 0, cpuUtil: 0, freq: 0, mem: 0, memUsedGB: 0, memFreeGB: 0,
      diskR: 0, diskW: 0, netRx: 0, netTx: 0, perDisk: {},
      cpuPackageW: null, battW: null,
    };

    const cpu = cpuLine();
    if (cpu) {
      const total = cpu.reduce((a, b) => a + b, 0);
      const idle = cpu[3] + (cpu[4] || 0);
      if (prevCpu) {
        const dTotal = total - prevCpu.total;
        const dIdle = idle - prevCpu.idle;
        if (dTotal > 0) {
          s.cpu = +Math.max(0, Math.min(100, (1 - dIdle / dTotal) * 100)).toFixed(1);
          s.cpuUtil = s.cpu;
        }
      }
      prevCpu = { total, idle };
    }

    const cur = num(r.trim('/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq'));
    const maxF = num(r.trim('/sys/devices/system/cpu/cpu0/cpufreq/scaling_max_freq'));
    if (cur && maxF) s.freq = +((cur / maxF) * 100).toFixed(0);

    const mi = r.read('/proc/meminfo');
    const totalKb = num((mi.match(/MemTotal:\s*(\d+)/) || [])[1]);
    const availKb = num((mi.match(/MemAvailable:\s*(\d+)/) || [])[1]);
    if (totalKb && availKb != null) {
      s.mem = +(((totalKb - availKb) / totalKb) * 100).toFixed(1);
      s.memUsedGB = +((totalKb - availKb) / 1048576).toFixed(2);
      s.memFreeGB = +(availKb / 1048576).toFixed(2);
    }

    const disks = diskCounters();
    if (prevDisk) {
      for (const [name, c] of disks) {
        const p = prevDisk.get(name);
        if (!p) continue;
        const dr = Math.max(0, c.r - p.r);
        const dw = Math.max(0, c.w - p.w);
        s.diskR += dr;
        s.diskW += dw;
        const idx = diskIndex.get(name);
        if (idx != null) s.perDisk[idx] = { r: dr, w: dw };
      }
    }
    prevDisk = disks;

    const net = netCounters();
    if (prevNet) {
      for (const [name, c] of net) {
        const p = prevNet.get(name);
        if (!p) continue;
        s.netRx += Math.max(0, c.rx - p.rx);
        s.netTx += Math.max(0, c.tx - p.tx);
      }
    }
    prevNet = net;

    s.cpuPackageW = raplWatts(now);

    const bat = readBattery(r);
    if (bat && bat.watts != null && !bat.ac) s.battW = bat.watts;

    onSample && onSample(s);
    return s;
  }

  return {
    sample,
    setDiskIndex(map) { diskIndex = map; },
  };
}

/* ---------------------------------------------------------------- adapter */

function create(opts = {}) {
  const r = opts.reader || makeReader(opts.root || '');
  const intervalMs = opts.intervalMs || 1000;
  const invMs = opts.inventoryIntervalMs || 3000;
  let sampleTimer = null;
  let invTimer = null;
  let sampler = null;
  let stopped = false;

  function inventory() {
    const t0 = Date.now();
    const devices = usbInventory(r);
    const storage = blockDevices(r);
    const inv = {
      type: 'inv',
      ts: Date.now(),
      host: readHost(r),
      uptime: readUptime(r),
      battery: readBattery(r),
      devices,
      storage: { disks: storage, volumes: [] },
      nics: readNics(r),
      monitors: readMonitors(r),
      costMs: Date.now() - t0,
      mode: 'sysfs',
    };
    if (sampler) {
      sampler.setDiskIndex(new Map(storage.map((d) => [d.name, d.n])));
    }
    opts.onInventory && opts.onInventory(inv);
    return inv;
  }

  return {
    id: 'linux',
    caps: {
      platform: 'linux',
      inventory: 'sysfs',
      perf: 'procfs',
      realCpuWatts: !!raplPath(r),
      realBatteryWatts: !!(readBattery(r) || {}).watts,
      linkSpeed: true,
    },
    inventory,
    startInventory() {
      inventory();
      invTimer = setInterval(() => { if (!stopped) inventory(); }, invMs);
      opts.onStatus && opts.onStatus('ok');
      return this;
    },
    startPerf() {
      // first two samples only establish deltas
      sampler = createSampler(r, { onSample: opts.onPerf });
      sampler.sample();
      sampleTimer = setInterval(() => { if (!stopped) sampler.sample(); }, intervalMs);
      opts.onPerfStatus && opts.onPerfStatus('ok');
      return this;
    },
    stop() {
      stopped = true;
      clearInterval(sampleTimer);
      clearInterval(invTimer);
    },
    _parsers: { usbInventory, blockDevices, readBattery, readNics, readMonitors, readHost, parentOf, edidMonitor },
  };
}

module.exports = {
  create,
  makeReader,
  // exported for tests
  usbInventory,
  blockDevices,
  mountPoints,
  readBattery,
  readNics,
  readMonitors,
  readHost,
  readUptime,
  parentOf,
  edidMonitor,
  createSampler,
};
