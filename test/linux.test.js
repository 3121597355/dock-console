'use strict';
const assert = require('assert');
const linux = require('../src/platform/linux');

/**
 * In-memory stand-in for the sysfs/procfs reader.
 *
 * A real fixture tree would be more faithful, but sysfs interface directories
 * contain a colon ("1-1.1.2:1.0") which cannot exist on Windows — and CI must be
 * able to run these tests there. The adapter only ever talks to a duck-typed
 * reader, so a map of path → contents exercises exactly the same code.
 */
function memReader(files) {
  const read = (p) => (Object.prototype.hasOwnProperty.call(files, p) ? String(files[p]) : '');
  return {
    files,
    read,
    trim(p) { return read(p).trim(); },
    buf(p) {
      const v = files[p];
      return Buffer.isBuffer(v) ? v : Buffer.from(String(v == null ? '' : v));
    },
    ls(p) {
      const prefix = `${p.replace(/\/$/, '')}/`;
      const out = new Set();
      for (const k of Object.keys(files)) {
        if (k.startsWith(prefix)) out.add(k.slice(prefix.length).split('/')[0]);
      }
      return [...out];
    },
    real() { return ''; },
  };
}

const USB = '/sys/bus/usb/devices';

const FILES = {
  [`${USB}/usb1/idVendor`]: '1d6b',
  [`${USB}/usb1/idProduct`]: '0002',
  [`${USB}/usb1/product`]: 'xHCI Host Controller',
  [`${USB}/usb1/speed`]: '480',
  [`${USB}/usb1/bDeviceClass`]: '09',
  [`${USB}/usb1/busnum`]: '1',
  [`${USB}/usb1/devpath`]: '',

  [`${USB}/1-1/idVendor`]: '2109',
  [`${USB}/1-1/idProduct`]: '2817',
  [`${USB}/1-1/product`]: 'USB2.0 Hub',
  [`${USB}/1-1/speed`]: '480',
  [`${USB}/1-1/bDeviceClass`]: '09',
  [`${USB}/1-1/devpath`]: '1',

  // /sys/bus/usb/devices is a FLAT directory of symlinks, not a nested tree
  [`${USB}/1-1.1/idVendor`]: '2109',
  [`${USB}/1-1.1/idProduct`]: '0817',
  [`${USB}/1-1.1/product`]: 'USB3.0 Hub',
  [`${USB}/1-1.1/speed`]: '5000',
  [`${USB}/1-1.1/bDeviceClass`]: '09',
  [`${USB}/1-1.1/devpath`]: '1.1',

  [`${USB}/1-1.1.2/idVendor`]: '1058',
  [`${USB}/1-1.1.2/idProduct`]: '2623',
  [`${USB}/1-1.1.2/product`]: 'Elements SE 2623',
  [`${USB}/1-1.1.2/manufacturer`]: 'Western Digital',
  [`${USB}/1-1.1.2/serial`]: 'WXA1',
  [`${USB}/1-1.1.2/speed`]: '5000',
  [`${USB}/1-1.1.2/bDeviceClass`]: '00',
  [`${USB}/1-1.1.2/devpath`]: '1.1.2',
  [`${USB}/1-1.1.2:1.0/bInterfaceClass`]: '08',

  [`${USB}/1-1.4/idVendor`]: '046d',
  [`${USB}/1-1.4/idProduct`]: 'c539',
  [`${USB}/1-1.4/product`]: 'USB Receiver',
  [`${USB}/1-1.4/speed`]: '12',
  [`${USB}/1-1.4/bDeviceClass`]: '00',
  [`${USB}/1-1.4/devpath`]: '1.4',
  [`${USB}/1-1.4:1.0/bInterfaceClass`]: '03',

  '/sys/block/sda/size': '1953525168',
  '/sys/block/sda/device/vendor': 'WD',
  '/sys/block/sda/device/model': 'Elements 2623',
  '/sys/block/nvme0n1/size': '1000215216',
  '/sys/block/nvme0n1/device/vendor': '',
  '/sys/block/nvme0n1/device/model': 'SAMSUNG MZVLB512',

  '/sys/class/power_supply/BAT0/capacity': '87',
  '/sys/class/power_supply/BAT0/status': 'Discharging',
  '/sys/class/power_supply/BAT0/voltage_now': '11800000',
  '/sys/class/power_supply/BAT0/current_now': '420000',
  '/sys/class/power_supply/BAT0/energy_full': '45000000',
  '/sys/class/power_supply/BAT0/energy_full_design': '52000000',
  '/sys/class/power_supply/AC/online': '0',

  '/sys/class/powercap/intel-rapl:0/name': 'package-0',
  '/sys/class/powercap/intel-rapl:0/energy_uj': '1000000',
  '/sys/class/powercap/intel-rapl:0/max_energy_range_uj': '262143328850',

  '/sys/class/net/enp0s31f6/operstate': 'up',
  '/sys/class/net/enp0s31f6/speed': '1000',
  '/sys/class/net/enp0s31f6/address': 'a4:83:e7:00:11:22',
  '/sys/class/net/wlp3s0/operstate': 'down',
  '/sys/class/net/wlp3s0/address': 'aa:bb:cc:dd:ee:ff',

  '/proc/stat': 'cpu  100 0 50 850 20 5 5 0 0 0\n',
  '/proc/meminfo': 'MemTotal:       16698360 kB\nMemFree:          900000 kB\nMemAvailable:    2100000 kB\n',
  '/proc/diskstats': [
    '   8       0 sda 1000 0 20000 0 500 0 4000 0 0 0 0',
    ' 259       0 nvme0n1 2000 0 40000 0 800 0 8000 0 0 0 0',
  ].join('\n'),
  '/proc/net/dev': [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo:  100 1 0 0 0 0 0 0  100 1 0 0 0 0 0 0',
    'enp0s31f6: 5000000 100 0 0 0 0 0 0 250000 50 0 0 0 0 0 0',
  ].join('\n'),
  '/proc/cpuinfo': 'processor\t: 0\nmodel name\t: Intel(R) Core(TM) i7-1165G7 @ 2.80GHz\n\nprocessor\t: 1\nmodel name\t: Intel(R) Core(TM) i7-1165G7 @ 2.80GHz\n',
  '/proc/uptime': '12345.67 99999.00\n',
  '/proc/mounts': '/dev/sda1 /media/user/Elements ext4 rw 0 0\n/dev/nvme0n1p2 / ext4 rw 0 0\n',
  '/etc/os-release': 'PRETTY_NAME="Ubuntu 24.04 LTS"\n',
};

const r = memReader({ ...FILES });

// symlink-free block resolution: pretend these devices sit behind the dock hub
const resolve = (p) => (p.includes('sda')
  ? '/sys/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1.1/1-1.1.2/1-1.1.2:1.0/host6/target6:0:0/6:0:0:0/block/sda'
  : '/sys/devices/pci0000:00/0000:00:14.0/usb1/1-1/1-1.1/1-1.1.2/1-1.1.2:1.0/host6/target6:0:0/6:0:0:0/block/nvme0n1');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('parentOf walks the devpath chain', () => {
  assert.strictEqual(linux.parentOf('1-1.4'), '1-1');
  assert.strictEqual(linux.parentOf('1-1'), 'usb1');
  assert.strictEqual(linux.parentOf('1-1.1.2'), '1-1.1');
  assert.strictEqual(linux.parentOf('2-3.4.5.6'), '2-3.4.5');
  assert.strictEqual(linux.parentOf('usb3'), null);
});

test('usbInventory reads vendor/product/speed from sysfs', () => {
  const devs = linux.usbInventory(r);
  assert.strictEqual(devs.length, 5, devs.map((d) => d.id).join(','));

  const ssd = devs.find((d) => d.pid === '2623');
  assert.ok(ssd, 'storage node missing');
  assert.strictEqual(ssd.speed, 5000);
  assert.strictEqual(ssd.vid, '1058');
  assert.strictEqual(ssd.parent, '1-1.1');
  assert.deepStrictEqual(ssd.kinds, ['DiskDrive']);

  const rx = devs.find((d) => d.pid === 'c539');
  assert.strictEqual(rx.speed, 12);
  assert.deepStrictEqual(rx.kinds, ['HIDClass']);
  assert.strictEqual(rx.port, '4');
});

test('usbInventory ignores interface nodes and marks root hubs', () => {
  const devs = linux.usbInventory(r);
  assert.ok(!devs.some((d) => d.id.includes(':')), 'interface node leaked in');
  const rootHub = devs.find((d) => d.id === 'usb1');
  assert.strictEqual(rootHub.root, true);
  assert.strictEqual(rootHub.isHub, true);
  const hub = devs.find((d) => d.id === '1-1');
  assert.strictEqual(hub.isHub, true);
  assert.strictEqual(hub.root, false);
  assert.strictEqual(hub.kinds.length, 0);
});

test('a vanished device is skipped instead of producing a ghost row', () => {
  const partial = memReader({
    '/sys/bus/usb/devices/usb1/idVendor': '1d6b',
    '/sys/bus/usb/devices/1-9/bDeviceClass': '00', // listed but no idVendor
  });
  const devs = linux.usbInventory(partial);
  assert.strictEqual(devs.length, 1);
  assert.strictEqual(devs[0].id, 'usb1');
});

test('blockDevices resolves bus type and capacity', () => {
  const disks = linux.blockDevices(r, resolve);
  assert.strictEqual(disks.length, 2);

  const sda = disks.find((d) => d.name === 'sda');
  assert.strictEqual(sda.bus, 'USB');
  assert.strictEqual(sda.usbName, '1-1.1.2');
  assert.strictEqual(sda.sizeGB, 1000.2);
  assert.deepStrictEqual(sda.letters, ['Elements']);
});

test('readBattery converts uV/uA into watts', () => {
  const bat = linux.readBattery(r);
  assert.strictEqual(bat.pct, 87);
  assert.strictEqual(bat.ac, false);
  assert.strictEqual(bat.charging, false);
  assert.strictEqual(bat.volt, 11.8);
  assert.ok(Math.abs(bat.watts - 4.96) < 0.06, `watts=${bat.watts}`);
  assert.strictEqual(bat.health, 87); // 45 Wh of 52 Wh design
});

test('readNics separates ethernet from wifi', () => {
  const nics = linux.readNics(r);
  const eth = nics.find((n) => n.name === 'enp0s31f6');
  assert.strictEqual(eth.kind, 'ethernet');
  assert.strictEqual(eth.status, 'Up');
  assert.strictEqual(eth.speed, '1000 Mbps');

  const wifi = nics.find((n) => n.name === 'wlp3s0');
  assert.strictEqual(wifi.kind, 'wifi');
  assert.strictEqual(wifi.status, 'Disconnected');
});

test('readHost pulls cpu model, ram and distro', () => {
  const host = linux.readHost(r);
  assert.strictEqual(host.cpu, 'Intel(R) Core(TM) i7-1165G7 @ 2.80GHz');
  assert.strictEqual(host.cores, 2);
  assert.ok(Math.abs(host.ramGB - 15.9) < 0.2, `ramGB=${host.ramGB}`);
  assert.strictEqual(host.os, 'Ubuntu 24.04 LTS');
});

test('sampler derives rates from consecutive /proc snapshots', () => {
  const files = { ...FILES };
  const mem = memReader(files);
  const samples = [];
  const sampler = linux.createSampler(mem, { onSample: (s) => samples.push(s) });
  sampler.sample(); // baseline

  // 1 s later: 100 more ticks of which 20 idle → 80 % busy
  files['/proc/stat'] = 'cpu  150 0 80 870 20 5 5 0 0 0\n';
  files['/proc/diskstats'] = [
    '   8       0 sda 1000 0 22048 0 500 0 6048 0 0 0 0',
    ' 259       0 nvme0n1 2000 0 40000 0 800 0 8000 0 0 0 0',
  ].join('\n');
  files['/proc/net/dev'] = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
    '    lo:  100 1 0 0 0 0 0 0  100 1 0 0 0 0 0 0',
    'enp0s31f6: 5097152 100 0 0 0 0 0 0 2597152 50 0 0 0 0 0 0',
  ].join('\n');

  const s = sampler.sample();
  assert.ok(Math.abs(s.cpu - 80) < 1.5, `cpu=${s.cpu}`);
  assert.strictEqual(Math.round(s.diskR), 2048 * 512);
  assert.strictEqual(Math.round(s.diskW), 2048 * 512);
  assert.strictEqual(Math.round(s.netRx), 97152);
  assert.strictEqual(Math.round(s.netTx), 2347152);
  assert.ok(Math.abs(s.mem - 87.4) < 0.5, `mem=${s.mem}`);
  assert.strictEqual(samples.length, 2);
});

test('RAPL energy delta becomes watts', () => {
  const files = { ...FILES };
  const sampler = linux.createSampler(memReader(files), {});
  assert.strictEqual(sampler.sample().cpuPackageW, null); // baseline only
  files['/sys/class/powercap/intel-rapl:0/energy_uj'] = '4000000';
  const s = sampler.sample();
  // 3 J over whatever wall time the test took — assert the shape, not the value
  assert.ok(s.cpuPackageW === null || (s.cpuPackageW > 0 && s.cpuPackageW < 500), `w=${s.cpuPackageW}`);
});

test('EDID parser extracts manufacturer and model', () => {
  const edid = Buffer.alloc(128);
  edid[8] = 0x1e; edid[9] = 0x6d;
  edid[54 + 3] = 0xfc;
  Buffer.from('G24H3Max\n    ').copy(edid, 54 + 5);
  const m = linux.edidMonitor(edid, 'HDMI-A-1');
  assert.ok(m, 'edid not parsed');
  assert.strictEqual(m.model, 'G24H3Max');
  assert.strictEqual(m.connector, 'HDMI-A-1');
  assert.strictEqual(m.internal, false);
});

module.exports = { name: 'linux adapter (sysfs/procfs fixtures)', tests };
