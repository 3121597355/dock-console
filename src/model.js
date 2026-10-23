'use strict';
const { vendorName } = require('./vendors');

const BRANDS = /ugreen|anker|caldigit|dell|lenovo|hp\b|huawei|logitech|samsung|sandisk|kingston|seagate|realtek|via labs|genesys|chicony|sony|xiaomi|mchose|\bite\b|apple/i;
const GENERIC_NAME = /^(usb\b|usb\d|usb |billboard|composite|mass storage|storage device|device$|generic|unknown|未知|usb 大容量|usb 输入)/i;

/** A root hub is the controller side of the tree. Windows encodes it in the
 *  instance id, Linux names the node `usbN`, macOS nests devices under a bus
 *  container — adapters set `root` so this stays platform-neutral. */
const isRootHub = (d) =>
  d.root === true || /^usb\d+$/i.test(d.id || '') || /root_hub/i.test(d.id || '') ||
  /根集线器|root hub/i.test(d.desc || '') || /^(usb\s*[\d.]+\s*bus)$/i.test(d.desc || '');

/** Prefer the negotiated rate when the platform reports one (Linux/macOS), fall
 *  back to the hub's model string on Windows where it is not exposed. */
const isSuperSpeedHub = (d) =>
  (typeof d.speed === 'number' && d.speed >= 5000) ||
  /superspeed|usb\s*3/i.test(`${d.desc || ''} ${d.name || ''} ${d.busname || ''}`);

const isPhysical = (d) =>
  d.physical === true ||
  (d.physical === undefined && typeof d.id === 'string' && d.id.startsWith('usb\\') && !d.id.includes('&mi_'));

const LINK_LABEL = [[20000, 'USB4 · 20 Gbps'], [10000, 'USB 3.2 Gen 2 · 10 Gbps'], [5000, 'USB 3.2 Gen 1 · 5 Gbps'], [480, 'USB 2.0 · 480 Mbps'], [12, 'USB 1.1 · 12 Mbps']];
function linkLabel(mbps) {
  for (const [min, label] of LINK_LABEL) if (mbps >= min) return label;
  return `${mbps} Mbps`;
}

function buildIndex(devs) {
  const byId = new Map();
  for (const d of devs) byId.set(d.id, d);
  return byId;
}

function chainOf(d, byId) {
  const out = [];
  let cur = d;
  let guard = 0;
  while (cur && guard++ < 20) {
    out.push(cur);
    cur = byId.get(cur.parent);
  }
  return out;
}

/** Port number shown in the UI. Windows: "Port_#0004.Hub_#0006". Linux: devpath
 *  "1.4.2". macOS: no port ordinal, only a location id. */
function portOf(d) {
  const m = String(d.loc || '').match(/Port_#(\d+)/i);
  if (m) return String(parseInt(m[1], 10));
  if (d.port) return String(d.port);
  const tail = String(d.loc || '').split('.').pop();
  return /^\d+$/.test(tail) ? tail : '';
}

/**
 * A dock is the hub subtree hanging off a root hub. Rather than hard-coding a
 * vendor we pick the top-level hub group with the most interesting topology:
 * docks normally expose a HS + SS hub pair and/or nested hubs.
 */
function detectDock(physical, byId, cfg) {
  const hubs = physical.filter((d) => d.isHub);
  const rootIds = new Set(hubs.filter(isRootHub).map((h) => h.id));

  let top = hubs.filter((h) => !isRootHub(h) && rootIds.has(h.parent));
  if (cfg.dock && cfg.dock.vendorId) {
    const wanted = String(cfg.dock.vendorId).toLowerCase();
    top = top.filter((h) => (h.vid || '').toLowerCase() === wanted);
  }
  if (!top.length) return { present: false, vid: null, hubs: [] };

  const groups = new Map();
  for (const h of top) {
    const key = (h.vid || 'unknown').toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }

  let best = null;
  for (const [vid, list] of groups) {
    let score = list.length; // an HS/SS pair scores 2
    for (const h of list) if (isSuperSpeedHub(h)) score += 2;
    if (hubs.some((h) => list.some((t) => t.id === h.parent))) score += 2; // nested hub
    if (!best || score > best.score) best = { vid, list, score };
  }
  if (!best) return { present: false, vid: null, hubs: [] };

  const ids = new Set(best.list.map((h) => h.id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const h of hubs) {
      if (!ids.has(h.id) && ids.has(h.parent)) { ids.add(h.id); grew = true; }
    }
  }
  return {
    present: best.list.length > 0,
    vid: best.vid,
    topHubs: best.list,
    hubs: [...ids].map((id) => byId.get(id)).filter(Boolean),
  };
}

function buildModel(inv, cfg, dockInfo) {
  const devs = inv.devices || [];
  const byId = buildIndex(devs);

  const physical = devs.filter(isPhysical);

  const dock = dockInfo || detectDock(physical, byId, cfg);
  const dockHubIds = new Set((dock.hubs || []).map((h) => h.id));

  const rootUsbOf = (d) => {
    let cur = d;
    let guard = 0;
    while (cur && guard++ < 20) {
      if (isPhysical(cur)) return cur;
      cur = byId.get(cur.parent);
    }
    return null;
  };

  const chain = (d) => chainOf(d, byId);
  const inDock = (d) => chain(d).some((n) => n.isHub && dockHubIds.has(n.id));

  const laneOf = (d) => {
    // a real negotiated rate beats any inference
    if (typeof d.speed === 'number' && d.speed > 0) {
      return d.speed >= 5000 ? 'ss' : d.speed >= 480 ? 'hs' : 'fs';
    }
    const c = chain(d);
    // a root hub's description mentions the controller generation ("USB 3.0"),
    // which says nothing about the negotiated link of the device below it
    if (c.some((n) => n.isHub && !isRootHub(n) && isSuperSpeedHub(n))) return 'ss';
    if (c.some((n) => n.isHub && !isRootHub(n))) return 'hs';
    return 'root';
  };

  // functional endpoints (disk, camera, MTP…) give much better labels than the
  // generic "USB Composite Device" string on the parent node
  const childLabel = new Map();
  const childKinds = new Map();
  for (const d of devs) {
    const r = rootUsbOf(d);
    if (!r || r.id === d.id) continue;
    if (!childKinds.has(r.id)) childKinds.set(r.id, new Set());
    childKinds.get(r.id).add(d.cls);
    if (d.cls === 'WPD' && !String(d.id).includes('vid_')) continue;
    if (!['WPD', 'DiskDrive', 'Camera', 'CDROM', 'SCSIAdapter'].includes(d.cls)) continue;
    const prev = childLabel.get(r.id);
    if (!prev || d.cls === 'WPD') childLabel.set(r.id, { desc: d.desc, cls: d.cls });
  }

  const storage = inv.storage || { disks: [], volumes: [] };
  const usbDisks = (storage.disks || []).filter((k) => k.bus === 'USB' || /SCSI/i.test(k.bus || ''));

  const devices = physical.map((d) => {
    const child = childLabel.get(d.id);
    const busname = (d.busname || '').trim();
    const vid = (d.vid || '').toLowerCase();
    const vendor = vendorName(vid);

    let labelKind = null;
    let label = '';
    if (child && child.cls === 'WPD' && child.desc && child.desc.length > 2) label = child.desc;
    if (!label) label = busname;
    if (!label && d.name && d.name !== d.desc) label = d.name;
    if (!label && child) label = child.desc;
    if (!label) label = d.desc;

    if (d.isHub) {
      labelKind = isRootHub(d) ? 'rootHub' : isSuperSpeedHub(d) ? 'ssHub' : 'hub';
      label = labelKind === 'rootHub' ? 'Root hub' : labelKind === 'ssHub' ? 'SuperSpeed hub' : 'USB hub';
    }

    // a mass-storage node can carry its own disk (Linux/macOS adapters resolve
    // this from sysfs / system_profiler) — prefer that over name matching
    let disk = d.disk || null;
    if (!disk && child && (child.cls === 'DiskDrive' || child.cls === 'SCSIAdapter' || d.cls === 'DiskDrive')) {
      const key = String(child.desc || '').replace(/\s+(USB|SCSI)\s+Device$/i, '').trim();
      disk = usbDisks.find(
        (k) => k.model && (k.model.includes(key.slice(0, 18)) || key.includes(k.model.slice(0, 14)))
      ) || null;
    }
    if (disk) {
      disk = {
        n: disk.n,
        sizeGB: disk.sizeGB,
        model: disk.model,
        letters: (disk.letters || []).filter(Boolean),
      };
      if (disk.model && (!label || GENERIC_NAME.test(label))) {
        label = disk.model.replace(/\s+(USB|SCSI)\s+Device$/i, '');
      }
    }

    const hasCJK = /[\u4e00-\u9fa5]/.test(label);
    const isAltMode = /billboard|备用模式/i.test(label);
    if (!d.isHub && !hasCJK && !isAltMode && label && vendor && !BRANDS.test(label) && label.length + vendor.length <= 30) {
      label = `${vendor} ${label}`;
    }
    if (!label) label = `${vendor || ''} ${d.cls || 'USB device'}`.trim();

    const speed = typeof d.speed === 'number' && d.speed > 0 ? d.speed : null;

    return {
      id: d.id,
      loc: d.loc || '',
      port: portOf(d),
      name: label,
      labelKind,
      desc: d.desc,
      cls: d.cls,
      vendor,
      vid: d.vid || '',
      pid: d.pid || '',
      serial: d.serial || '',
      status: d.status,
      problem: d.problem || '',
      isHub: !!d.isHub,
      inDock: inDock(d),
      lane: laneOf(d),
      speed,
      speedLabel: speed ? linkLabel(speed) : null,
      depth: chain(d).filter((n) => n.isHub && dockHubIds.has(n.id)).length,
      kinds: (Array.isArray(d.kinds) && d.kinds.length ? d.kinds : null) || Array.from(childKinds.get(d.id) || []),
      disk,
    };
  });

  const dockHubs = devices.filter((d) => d.isHub && dockHubIds.has(d.id));
  // A multi-lane dock exposes its HS and SS halves on different root hubs, so the
  // uplink is the fastest of the top-level hubs, not simply the first one found.
  const topSpeeds = (dock.topHubs || []).map((h) => h.speed || (byId.get(h.id) || {}).speed || 0);
  const topSpeed = topSpeeds.length ? Math.max(...topSpeeds) : 0;
  const uplinkSS = dockHubs.some((h) => h.speed ? h.speed >= 5000 : isSuperSpeedHub(byId.get(h.id) || {}));
  const billboard = devices.find((d) => d.cls === 'USBDevice' && /billboard/i.test(d.desc || ''));

  const dockDevices = devices.filter((d) => d.inDock && !d.isHub);
  const directDevices = devices.filter((d) => !d.inDock && !d.isHub && !isRootHub(d));

  const nics = inv.nics || [];
  // Panel vendors only show up on laptop-internal displays. Windows cannot say
  // which display is internal, so guess from the EDID manufacturer id — the UI
  // uses this to avoid presenting the built-in panel as a dock video output.
  const INTERNAL_PANEL = /^(BOE|AUO|CMN|SDC|LGD|CSO|IVO|SHP|LEN|CPT|HSD)/i;
  const monitors = (inv.monitors || [])
    .filter((x) => x.active)
    .map((x) => ({
      ...x,
      internal: x.internal != null ? x.internal : INTERNAL_PANEL.test(String(x.mfr || '')),
    }));
  const eth = nics.find((n) => n.kind === 'ethernet') ||
    nics.find((n) => /以太网|ethernet|gbe|i219|i225/i.test(n.desc || '')) || null;

  return {
    dock: {
      present: dockHubs.length > 0,
      // null means "use the UI's translated default" — a configured name wins
      name: (cfg.dock && cfg.dock.name) || null,
      vid: dock.vid,
      vendor: vendorName(dock.vid),
      hubs: dockHubs.map((d) => ({
        pid: d.pid,
        lane: d.speed ? (d.speed >= 5000 ? 'ss' : 'hs') : isSuperSpeedHub(byId.get(d.id) || {}) ? 'ss' : 'hs',
        speed: d.speed || null,
        name: d.name,
      })),
      uplink: topSpeed && topSpeed > 0 ? linkLabel(topSpeed) : uplinkSS ? linkLabel(5000) : linkLabel(480),
      uplinkMbps: topSpeed || (uplinkSS ? 5000 : 480),
      billboard: !!billboard,
      portCount: dockDevices.length,
      devices: dockDevices,
      ss: dockDevices.filter((d) => d.lane === 'ss'),
      hs: dockDevices.filter((d) => d.lane === 'hs'),
    },
    direct: directDevices,
    hubs: devices.filter((d) => d.isHub),
    all: devices,
    storage,
    volumes: storage.volumes || [],
    nics,
    ethernet: eth ? { status: eth.status, speed: eth.speed, name: eth.name } : null,
    monitors,
    battery: inv.battery || null,
    host: inv.host || null,
    uptime: inv.uptime || 0,
  };
}

/**
 * Events carry a translation key plus params, never pre-rendered prose, so the
 * browser can render them in whatever language it is currently set to.
 */
function diffModel(prev, next, emit) {
  if (!prev) {
    const n = next.dock.devices.length + next.direct.length;
    emit('info', 'event.scan.start', { n });
    if (next.dock.present) {
      emit('info', 'event.dock.found', {
        vendor: next.dock.vendor || 'Hub',
        uplink: next.dock.uplink,
        n: next.dock.devices.length,
      });
    }
    return;
  }
  const indexOf = (m) => new Map(m.all.filter((d) => !d.isHub).map((d) => [d.id, d]));
  const a = indexOf(prev);
  const b = indexOf(next);

  for (const [id, d] of b) {
    if (!a.has(id)) {
      emit('add', 'event.device.add', { name: d.name, port: d.port || '', where: d.inDock ? 'dock' : 'direct' });
    }
  }
  for (const [id, d] of a) {
    if (!b.has(id)) {
      emit('remove', 'event.device.remove', { name: d.name, port: d.port || '' });
    }
  }
  if (prev.dock.present && !next.dock.present) emit('warn', 'event.dock.lost', {});
  if (!prev.dock.present && next.dock.present) emit('add', 'event.dock.connected', { uplink: next.dock.uplink });

  const pa = prev.ethernet ? prev.ethernet.status : 'Disconnected';
  const pb = next.ethernet ? next.ethernet.status : 'Disconnected';
  if (pa !== pb) emit('link', 'event.eth.change', { from: pa, to: pb });

  const ba = prev.battery ? prev.battery.ac : null;
  const bb = next.battery ? next.battery.ac : null;
  if (ba !== null && bb !== null && ba !== bb) {
    emit('power', bb ? 'event.power.ac' : 'event.power.battery', {});
  }
}

module.exports = { buildModel, detectDock, diffModel, isRootHub, isSuperSpeedHub, isPhysical, linkLabel, portOf };
