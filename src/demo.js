'use strict';

/**
 * Demo source — a synthetic dock so the UI can be explored (and screenshotted)
 * on a machine with no dock attached. Shaped exactly like collector.ps1 output
 * so the whole downstream pipeline is exercised for real.
 */

const HOST = {
  name: 'DEMO-PC',
  vendor: 'LENOVO',
  model: '82XX',
  cpu: 'Intel(R) Core(TM) i7-1260P',
  cpuFull: 'Intel(R) Core(TM) i7-1260P CPU @ 2.10GHz',
  cores: 16,
  ramGB: 15.9,
  os: 'Microsoft Windows 11 专业版',
  osBuild: '22631',
  gpu: 'NVIDIA GeForce RTX 4060 Laptop GPU',
  batName: 'DEMO-BAT',
  batDesign: 80000,
  mode: 'demo',
};

const ROOT_HUB = {
  id: 'usb\\root_hub30\\4&demo0000&0&0',
  parent: 'pci\\ven_8086&dev_7a60\\demo',
  desc: 'USB 根集线器(USB 3.0)',
  busname: 'USB xHCI Compliant Host Controller',
  cls: 'USB',
  mfg: '(标准 USB 集线器)',
  status: 'ok',
  problem: '',
  driver: 'USBHUB3',
  loc: '',
  isHub: true,
  vid: '',
  pid: '',
};

const DOCK_SS = {
  id: 'usb\\vid_2109&pid_0817\\msft30000000000',
  parent: ROOT_HUB.id,
  desc: '通用 SuperSpeed USB 集线器',
  busname: 'USB3.0 Hub',
  cls: 'USB',
  mfg: '(标准 USB 集线器)',
  status: 'ok',
  problem: '',
  driver: 'USBHUB3',
  loc: 'Port_#0020.Hub_#0002',
  isHub: true,
  vid: '2109',
  pid: '0817',
};

const DOCK_HS = {
  id: 'usb\\vid_2109&pid_2817\\msft20000000000',
  parent: ROOT_HUB.id,
  desc: '通用 USB 集线器',
  busname: 'USB2.0 Hub',
  cls: 'USB',
  mfg: '(标准 USB 集线器)',
  status: 'ok',
  problem: '',
  driver: 'USBHUB3',
  loc: 'Port_#0003.Hub_#0002',
  isHub: true,
  vid: '2109',
  pid: '2817',
};

const BILLBOARD = {
  id: 'usb\\vid_05e3&pid_0f01\\0001',
  parent: ROOT_HUB.id,
  desc: 'Billboard Device',
  busname: 'Billboard Device',
  cls: 'USBDevice',
  mfg: 'Genesys Logic',
  status: 'ok',
  problem: '',
  driver: 'usbccgp',
  loc: 'Port_#0004.Hub_#0002',
  isHub: false,
  vid: '05E3',
  pid: '0F01',
};

function dev(over) {
  return {
    parent: DOCK_HS.id,
    desc: 'USB Composite Device',
    busname: '',
    cls: 'USB',
    mfg: '(标准 USB 主控制器)',
    status: 'ok',
    problem: '',
    driver: 'usbccgp',
    loc: '',
    isHub: false,
    vid: '',
    pid: '',
    ...over,
  };
}

const SSD = dev({
  id: 'usb\\vid_1058&pid_2623\\575832324137313435435231',
  parent: DOCK_SS.id,
  desc: 'USB 大容量存储设备',
  busname: 'Elements SE 2623',
  mfg: '兼容 USB 存储设备',
  driver: 'USBSTOR',
  loc: 'Port_#0002.Hub_#0003',
  vid: '1058',
  pid: '2623',
});

const SSD_CHILD = {
  id: 'usbstor\\disk&ven_wd&prod_elements_se_2623\\575832324137313435435231&0',
  parent: SSD.id,
  desc: 'WD Elements SE 2623 USB Device',
  busname: '',
  cls: 'DiskDrive',
  mfg: '(标准磁盘驱动器)',
  status: 'ok',
  problem: '',
  driver: 'disk',
  loc: '',
  isHub: false,
  vid: '',
  pid: '',
};

const RECEIVER = dev({
  id: 'usb\\vid_046d&pid_c539\\7&22af1b01&0&3',
  desc: 'USB Composite Device',
  busname: 'USB Receiver',
  loc: 'Port_#0003.Hub_#0006',
  vid: '046D',
  pid: 'C539',
});

const HID_CHILD = {
  id: 'hid\\vid_046d&pid_c539&mi_02&col01\\8&1d5f3a2&0&0000',
  parent: RECEIVER.id,
  desc: '符合 HID 标准的用户控制设备',
  busname: '',
  cls: 'HIDClass',
  mfg: '(标准系统设备)',
  status: 'ok',
  problem: '',
  driver: 'HidUsb',
  loc: '',
  isHub: false,
  vid: '',
  pid: '',
};

const TABLET = dev({
  id: 'usb\\vid_12d1&pid_107d\\w3vbb21604214457',
  desc: 'USB Composite Device',
  busname: 'DBY-W09',
  loc: 'Port_#0004.Hub_#0006',
  vid: '12D1',
  pid: '107D',
});

const TABLET_CHILD = {
  id: 'swd\\wpd\\{7&1b2c3d&0&0000}#usb#vid_12d1&pid_107d#w3vbb21604214457#{demo}',
  parent: TABLET.id,
  desc: 'HUAWEI MatePad 11',
  busname: '',
  cls: 'WPD',
  mfg: 'HUAWEI',
  status: 'ok',
  problem: '',
  driver: 'WUDFRd',
  loc: '',
  isHub: false,
  vid: '',
  pid: '',
};

const FLASH = dev({
  id: 'usb\\vid_0781&pid_5583\\4c530001200328112345',
  parent: DOCK_SS.id,
  desc: 'USB 大容量存储设备',
  busname: 'Ultra Fit',
  mfg: '兼容 USB 存储设备',
  driver: 'USBSTOR',
  loc: 'Port_#0001.Hub_#0003',
  vid: '0781',
  pid: '5583',
});

const FLASH_CHILD = {
  id: 'usbstor\\disk&ven_sandisk&prod_ultra_fit\\4c530001200328112345&0',
  parent: FLASH.id,
  desc: 'SanDisk Ultra Fit USB Device',
  busname: '',
  cls: 'DiskDrive',
  mfg: '(标准磁盘驱动器)',
  status: 'ok',
  problem: '',
  driver: 'disk',
  loc: '',
  isHub: false,
  vid: '',
  pid: '',
};

const KEYBOARD = dev({
  id: 'usb\\vid_291a&pid_3301\\5&1f456139&0&9',
  desc: 'USB Composite Device',
  busname: 'Anker USB-C Keyboard',
  loc: 'Port_#0002.Hub_#0006',
  vid: '291A',
  pid: '3301',
});

const MONITOR = {
  mfr: 'HKC',
  model: 'G24H3Max',
  year: 2025,
  active: true,
};

function jitter(prev, min, max, step) {
  const next = prev + (Math.random() - 0.5) * step;
  return Math.min(max, Math.max(min, next));
}

function start({ onInventory, onPerf, onGpu, inventoryIntervalMs = 2000 }) {
  const t0 = Date.now();
  let cpu = 12;
  let gpu = 5;
  let burstUntil = 0;
  let diskR = 0;
  let diskW = 0;

  const battery = {
    pct: 78, ac: true, volt: 15.42, remainMWh: 62400, fullMWh: 80000,
    designMWh: 80000, chargeRate: 0, disRate: 0, health: 100,
  };

  const emitInventory = () => {
    const elapsed = (Date.now() - t0) / 1000;
    // hot-plug drama: a flash drive appears at 40 s, disappears at 100 s
    const flashIn = elapsed > 40 && elapsed < 100;

    const devices = [ROOT_HUB, DOCK_SS, DOCK_HS, BILLBOARD, SSD, SSD_CHILD, RECEIVER, HID_CHILD, TABLET, TABLET_CHILD, KEYBOARD];
    if (flashIn) devices.push(FLASH, FLASH_CHILD);

    const disks = [
      { n: 0, model: 'SAMSUNG MZVLB512HBJQ-000L2', bus: 'SCSI', sizeGB: 476.9, media: 'Fixed hard disk media', serial: 'S3Z8NB0M', letters: ['C:'], status: 'OK' },
      { n: 2, model: 'WD Elements SE 2623 USB Device', bus: 'USB', sizeGB: 931.5, media: 'External hard disk media', serial: 'WX22A7145CR1', letters: ['H:'], status: 'OK' },
    ];
    if (flashIn) {
      disks.push({ n: 3, model: 'SanDisk Ultra Fit USB Device', bus: 'USB', sizeGB: 28.7, media: 'Removable Media', serial: '4C530001200328112345', letters: ['I:'], status: 'OK' });
    }

    onInventory({
      type: 'inv',
      ts: Date.now(),
      tick: Math.round(elapsed / (inventoryIntervalMs / 1000)),
      host: HOST,
      uptime: 145000 + elapsed,
      battery,
      devices,
      storage: {
        disks,
        volumes: [
          { letter: 'C:', label: '系统', fs: 'NTFS', sizeGB: 476.9, freeGB: 213.4, type: 'Fixed' },
          { letter: 'H:', label: 'Elements', fs: 'NTFS', sizeGB: 931.5, freeGB: 402.1, type: 'Fixed' },
        ],
      },
      nics: [
        { name: '以太网', desc: 'Realtek USB GbE Family Controller', status: 'Up', speed: '1.0 Gbps', mac: '00-E0-4C-68-12-34', idx: 12 },
        { name: 'WLAN', desc: 'Intel(R) Wi-Fi 6E AX211 160MHz', status: 'Up', speed: '866 Mbps', mac: '4C-1D-96-3B-89-81', idx: 9 },
      ],
      monitors: [MONITOR],
      costMs: 420,
    });
  };
  // emit once up front so the first HTTP request already has a device tree
  emitInventory();
  const invTimer = setInterval(emitInventory, inventoryIntervalMs);

  const emitPerf = () => {
    const now = Date.now();
    if (now > burstUntil) {
      burstUntil = now + 4000 + Math.random() * 6000;
      cpu = jitter(cpu, 22, 46, 30);
    } else {
      cpu = jitter(cpu, 6, 30, 6);
    }
    cpu = Math.min(100, Math.max(2, cpu));

    // disk activity follows the external drive, paced like a backup job
    const active = Math.sin(now / 9000) > 0.35;
    diskR = active ? jitter(diskR, 0, 42e6, 12e6) : jitter(diskR, 0, 2e6, 1e6);
    diskW = active ? jitter(diskW, 0, 8e6, 3e6) : jitter(diskW, 0, 1e6, 0.5e6);

    onPerf({
      cpu: +cpu.toFixed(1),
      cpuUtil: +(cpu * 1.06).toFixed(1),
      freq: Math.round(58 + cpu * 0.7),
      mem: 61 + Math.sin(now / 47000) * 4,
      memUsedGB: 9.6,
      memFreeGB: 6.2,
      diskR,
      diskW,
      netRx: (Math.random() < 0.4 ? 3.4e6 : 0.2e6) * (0.4 + Math.random()),
      netTx: (Math.random() < 0.3 ? 1.1e6 : 0.08e6) * (0.4 + Math.random()),
      perDisk: { 2: { r: diskR, w: diskW }, 3: { r: 0, w: 0 } },
    });

    gpu = jitter(gpu, 3, 26, 8);
    onGpu({
      gpuUtil: Math.round(gpu),
      gpuW: +(4.5 + (gpu / 100) * 30).toFixed(2),
      gpuTemp: Math.round(39 + gpu * 0.5),
      gpuMem: Math.round(900 + gpu * 12),
      gpuMemTotal: 8188,
      gpuClock: Math.round(210 + gpu * 18),
    });
  };
  emitPerf();
  const perfTimer = setInterval(emitPerf, 1000);

  return {
    stop() {
      clearInterval(invTimer);
      clearInterval(perfTimer);
    },
  };
}

module.exports = { start };
