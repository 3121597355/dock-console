'use strict';
const assert = require('assert');
const darwin = require('../src/platform/darwin');

/** Trimmed but structurally faithful `system_profiler SPUSBDataType -json`. */
const TREE = {
  SPUSBDataType: [
    {
      _name: 'USB31Bus',
      host_controller: 'AppleT6000USBXHCI',
      pci_device: 'AppleT6000USBXHCI',
      _items: [
        {
          _name: 'USB 3.1 Bus',
          host_controller: 'AppleT6000USBXHCI',
          pci_device: 'AppleT6000USBXHCI',
          usb_bus_number: '0x00',
          _items: [
            {
              _name: 'USB 3.2 Hub',
              manufacturer: 'Genesys Logic, Inc.',
              vendor_id: '0x05e3  (Genesys Logic, Inc.)',
              product_id: '0x0620',
              location_id: '0x00100000',
              bcd_device: '1.00',
              _items: [
                {
                  _name: 'Elements SE 2623',
                  manufacturer: 'Western Digital',
                  vendor_id: '0x1058  (Western Digital Technologies, Inc.)',
                  product_id: '0x2623',
                  serial_num: 'WXA1',
                  location_id: '0x00120000',
                  Media: [
                    {
                      _name: 'Elements SE 2623 Media',
                      bsd_name: 'disk4',
                      size_in_bytes: 1000204886016,
                      mount_point: '/Volumes/Elements',
                    },
                  ],
                },
                {
                  _name: 'USB Receiver',
                  manufacturer: 'Logitech',
                  vendor_id: '0x046d  (Logitech Inc.)',
                  product_id: '0xc539',
                  location_id: '0x00130000',
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('flatten keeps physical nodes and drops bus containers', () => {
  const devs = darwin.flatten(TREE.SPUSBDataType);
  assert.strictEqual(devs.length, 3);
  assert.ok(devs.every((d) => d.physical === true));
});

test('flatten marks bus containers as roots', () => {
  const devs = darwin.flatten(TREE.SPUSBDataType);
  const hub = devs.find((d) => d.vid === '05e3');
  assert.ok(hub, 'hub not found');
  assert.strictEqual(hub.isHub, true);
  assert.strictEqual(hub.root, false);
  // parent is the "USB 3.1 Bus" container, which carries root: true
  assert.strictEqual(hub.parent, 'mac:bus:0.0');
});

test('flatten attaches mass-storage media to its device', () => {
  const devs = darwin.flatten(TREE.SPUSBDataType);
  const disk = devs.find((d) => d.vid === '1058');
  assert.ok(disk, 'disk device not found');
  assert.ok(disk.disk, 'media not attached');
  assert.strictEqual(disk.disk.sizeGB, 1000.2);
  assert.strictEqual(disk.disk.letters[0], '/Volumes/Elements');
  assert.strictEqual(disk.disk.name, 'disk4');
});

test('flatten produces unique stable ids', () => {
  const devs = darwin.flatten(TREE.SPUSBDataType);
  const ids = devs.map((d) => d.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  // ids must be derived from location_id + vid/pid so re-enumeration is stable
  const hub = devs.find((d) => d.vid === '05e3');
  assert.ok(hub.id.includes('0x00100000'), hub.id);
  assert.ok(hub.id.includes('05e3'), hub.id);
});

test('flatten normalises vendor_id hex', () => {
  assert.strictEqual(darwin.hexId('0x05e3  (Genesys Logic, Inc.)'), '05e3');
  assert.strictEqual(darwin.hexId('0x46d'), '046d');
  assert.strictEqual(darwin.hexId(undefined), '');
});

test('parseSpeed handles every wording system_profiler uses', () => {
  assert.strictEqual(darwin.parseSpeed({ speed: 'Up to 5 Gb/sec' }), 5000);
  assert.strictEqual(darwin.parseSpeed({ speed: '480 Mb/sec' }), 480);
  assert.strictEqual(darwin.parseSpeed({ speed: '12 Mb/sec' }), 12);
  assert.strictEqual(darwin.parseSpeed({ speed: 'Up to 10 Gb/sec' }), 10000);
  assert.strictEqual(darwin.parseSpeed({ device_speed: '480' }), 480);
  assert.strictEqual(darwin.parseSpeed({}), null);
});

test('parseTopChunk reads CPU usage and PhysMem', () => {
  const chunk = [
    'Processes: 512 total, 3 running, 509 sleeping, 2500 threads',
    'PhysMem: 15G used (2731M wired, 1200M compressor), 892M unused.',
    'CPU usage: 5.43% user, 3.21% sys, 91.35% idle',
  ].join('\n');
  const s = darwin.parseTopChunk(chunk);
  assert.ok(Math.abs(s.cpu - 8.65) < 0.05, `cpu=${s.cpu}`);
  assert.ok(s.mem > 90 && s.mem < 96, `mem=${s.mem}`);
  assert.ok(s.memUsedGB > 14.9 && s.memUsedGB < 15.1, `used=${s.memUsedGB}`);
});

test('parseTopChunk returns null for unrelated output', () => {
  assert.strictEqual(darwin.parseTopChunk('nothing here'), null);
});

test('parseNetstat sums bytes across interfaces and skips loopback', () => {
  const text = [
    'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
    'lo0       16384 <Link#1>                        123456     0   12345678   123456     0   12345678     0',
    'en0       1500  <Link#7>   a4:83:e7:00:11:22   1000000     0  500000000  1000000     0  250000000     0',
    'utun0     1380  <Link#13>                           10     0       1000       10     0       1000     0',
  ].join('\n');
  const c = darwin.parseNetstat(text);
  assert.strictEqual(c.size, 1);
  assert.deepStrictEqual(c.get('en0'), { rx: 500000000, tx: 250000000 });
});

test('parseIostat maps MB/s triplets to disks', () => {
  const header = darwin.parseIostat('          disk0           disk3 ', []);
  assert.deepStrictEqual(header.names, ['disk0', 'disk3']);

  const row = darwin.parseIostat('   11.28    9  0.10     9.66    6  0.06', ['disk0', 'disk3']);
  assert.deepStrictEqual(row.values, [0.1, 0.06]);

  assert.strictEqual(darwin.parseIostat('KB/t  tps  MB/s', []).values, null);
});

module.exports = { name: 'darwin adapter (system_profiler fixtures)', tests };
