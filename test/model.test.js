'use strict';
const assert = require('assert');
const { buildModel, detectDock, portOf, linkLabel, isRootHub } = require('../src/model');

const CFG = { dock: { name: 'USB-C dock', vendorId: null } };

/** Windows-shaped instance ids, no per-device speed available. */
const WIN_DEVICES = [
  { id: 'usb\\root_hub20\\4&1a2b3c&0&0', parent: 'PCI\\VEN_8086', desc: 'USB Root Hub', cls: 'USB', isHub: true, status: 'ok' },
  { id: 'usb\\vid_2109&pid_2817\\6&1', parent: 'usb\\root_hub20\\4&1a2b3c&0&0', desc: 'USB2.0 Hub', cls: 'USB', isHub: true, vid: '2109', pid: '2817', loc: 'Port_#0001.Hub_#0003', status: 'ok' },
  { id: 'usb\\vid_2109&pid_0817\\6&2', parent: 'usb\\vid_2109&pid_2817\\6&1', desc: 'SuperSpeed Hub', cls: 'USB', isHub: true, vid: '2109', pid: '0817', loc: 'Port_#0001.Hub_#0004', status: 'ok' },
  { id: 'usb\\vid_046d&pid_c539\\6&3', parent: 'usb\\vid_2109&pid_2817\\6&1', desc: 'USB Receiver', busname: 'USB Receiver', cls: 'USB', isHub: false, vid: '046d', pid: 'c539', loc: 'Port_#0004.Hub_#0003', status: 'ok' },
  { id: 'usb\\vid_1058&pid_2623\\6&4', parent: 'usb\\vid_2109&pid_0817\\6&2', desc: 'USB Mass Storage', cls: 'USB', isHub: false, vid: '1058', pid: '2623', loc: 'Port_#0002.Hub_#0004', status: 'ok' },
  // a device on another controller, not behind the dock
  { id: 'usb\\root_hub30\\4&5d6e7f&0&0', parent: 'PCI\\VEN_8086', desc: 'USB Root Hub', cls: 'USB', isHub: true, status: 'ok' },
  { id: 'usb\\vid_0bda&pid_9210\\6&5', parent: 'usb\\root_hub30\\4&5d6e7f&0&0', desc: 'USB Storage', busname: 'RTL9210', cls: 'USB', isHub: false, vid: '0bda', pid: '9210', loc: 'Port_#0001.Hub_#0006', status: 'ok' },
];

/** Linux/macOS shape: explicit physical/root flags and a real negotiated speed.
 *  A USB-C dock shows up as two hubs on two buses — the HS half on bus 1 and the
 *  SS half on bus 2 — which is exactly the case that used to pick the wrong
 *  uplink speed. */
const NIX_DEVICES = [
  { id: 'usb1', parent: null, desc: 'xHCI Host Controller', cls: 'USB', isHub: true, root: true, physical: true, speed: 480, status: 'ok' },
  { id: '1-1', parent: 'usb1', desc: 'USB2.0 Hub', cls: 'USB', isHub: true, root: false, physical: true, speed: 480, vid: '2109', pid: '2817', port: '1', status: 'ok' },
  { id: '1-1.4', parent: '1-1', desc: 'USB Receiver', busname: 'USB Receiver', cls: 'HIDClass', isHub: false, physical: true, speed: 12, vid: '046d', pid: 'c539', port: '4', kinds: ['HIDClass'], status: 'ok' },
  { id: 'usb2', parent: null, desc: 'xHCI Host Controller', cls: 'USB', isHub: true, root: true, physical: true, speed: 10000, status: 'ok' },
  { id: '2-1', parent: 'usb2', desc: 'USB3.0 Hub', cls: 'USB', isHub: true, root: false, physical: true, speed: 5000, vid: '2109', pid: '0817', port: '1', status: 'ok' },
  { id: '2-1.2', parent: '2-1', desc: 'Elements SE 2623', busname: 'Elements SE 2623', cls: 'DiskDrive', isHub: false, physical: true, speed: 5000, vid: '1058', pid: '2623', port: '2', kinds: ['DiskDrive'], status: 'ok' },
];

function model(devices, cfg = CFG) {
  const byId = new Map(devices.map((d) => [d.id, d]));
  const physical = devices.filter((d) => d.physical !== false && !d.isInterface && !/^pci\\/i.test(d.id));
  const dock = detectDock(physical, byId, cfg);
  return buildModel({ devices, storage: { disks: [], volumes: [] }, nics: [], monitors: [], battery: null, host: null }, cfg, dock);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('detectDock finds a Windows HS+SS hub pair', () => {
  const m = model(WIN_DEVICES);
  assert.strictEqual(m.dock.present, true);
  assert.strictEqual(m.dock.vid, '2109');
  assert.strictEqual(m.dock.devices.length, 2);
});

test('detectDock excludes devices on other controllers', () => {
  const m = model(WIN_DEVICES);
  assert.strictEqual(m.direct.length, 1);
  assert.strictEqual(m.direct[0].vid, '0bda');
});

test('Windows port numbers come from the PnP location string', () => {
  assert.strictEqual(portOf({ loc: 'Port_#0004.Hub_#0003' }), '4');
  assert.strictEqual(portOf({ port: '2' }), '2');
  assert.strictEqual(portOf({ loc: '1.1.2' }), '2');
  assert.strictEqual(portOf({ loc: '' }), '');
});

test('lane falls back to hub description when speed is unknown', () => {
  const m = model(WIN_DEVICES);
  const rx = m.dock.devices.find((d) => d.vid === '046d');
  const ssd = m.dock.devices.find((d) => d.vid === '1058');
  assert.strictEqual(rx.lane, 'hs');
  assert.strictEqual(ssd.lane, 'ss');
  assert.strictEqual(ssd.speed, null);
});

test('a real speed overrides hub inference', () => {
  const m = model(NIX_DEVICES);
  const ssd = m.dock.devices.find((d) => d.id === '2-1.2');
  const rx = m.dock.devices.find((d) => d.id === '1-1.4');
  assert.strictEqual(ssd.speed, 5000);
  assert.strictEqual(ssd.lane, 'ss');
  assert.strictEqual(ssd.speedLabel, 'USB 3.2 Gen 1 · 5 Gbps');
  // 12 Mbps is full speed, not high speed
  assert.strictEqual(rx.lane, 'fs');
});

test('root hubs are detected on every platform shape', () => {
  assert.strictEqual(isRootHub({ id: 'usb\\root_hub20\\4&1&0&0' }), true);
  assert.strictEqual(isRootHub({ id: 'usb1' }), true);
  assert.strictEqual(isRootHub({ id: 'mac:bus:0.0', desc: 'USB 3.1 Bus' }), true);
  assert.strictEqual(isRootHub({ id: 'usb\\vid_2109&pid_2817\\6&1', desc: 'USB2.0 Hub' }), false);
});

test('dock uplink reflects the real hub speed', () => {
  const m = model(NIX_DEVICES);
  assert.strictEqual(m.dock.uplink, 'USB 3.2 Gen 1 · 5 Gbps');
  assert.strictEqual(m.dock.uplinkMbps, 5000);
});

test('linkLabel degrades through the USB generations', () => {
  assert.strictEqual(linkLabel(20000), 'USB4 · 20 Gbps');
  assert.strictEqual(linkLabel(10000), 'USB 3.2 Gen 2 · 10 Gbps');
  assert.strictEqual(linkLabel(5000), 'USB 3.2 Gen 1 · 5 Gbps');
  assert.strictEqual(linkLabel(480), 'USB 2.0 · 480 Mbps');
  assert.strictEqual(linkLabel(12), 'USB 1.1 · 12 Mbps');
});

test('a preset disk is not overwritten by name matching', () => {
  const devices = NIX_DEVICES.map((d) =>
    d.id === '2-1.2' ? { ...d, disk: { n: 3, sizeGB: 1000, model: 'Elements', letters: ['/mnt/x'] } } : d
  );
  const m = model(devices);
  const ssd = m.dock.devices.find((d) => d.id === '2-1.2');
  assert.strictEqual(ssd.disk.n, 3);
  assert.deepStrictEqual(ssd.disk.letters, ['/mnt/x']);
});

test('internal laptop panels are not offered as video outputs', () => {
  const inv = {
    devices: [],
    storage: { disks: [], volumes: [] },
    nics: [],
    monitors: [{ mfr: 'BOE', active: true }, { mfr: 'HKC', active: true }],
    battery: null,
    host: null,
  };
  const m = buildModel(inv, CFG, { present: false, hubs: [] });
  assert.strictEqual(m.monitors.find((x) => x.mfr === 'BOE').internal, true);
  assert.strictEqual(m.monitors.find((x) => x.mfr === 'HKC').internal, false);
});

module.exports = { name: 'device model (cross-platform)', tests };
