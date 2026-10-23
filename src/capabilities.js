'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function run(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 8000, windowsHide: true });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
  } catch (e) {
    return { ok: false, out: '' };
  }
}

const firstLine = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)[0] || '';

function findNvidiaSmi(platform) {
  const candidates = [];
  if (platform === 'win32') {
    candidates.push(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'));
  } else {
    candidates.push(
      '/usr/bin/nvidia-smi',
      '/usr/local/bin/nvidia-smi',
      '/usr/lib/wsl/lib/nvidia-smi',
      '/opt/homebrew/bin/nvidia-smi'
    );
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* ignore */ }
  }
  const r = run(platform === 'win32' ? 'where' : 'which', ['nvidia-smi']);
  if (r.ok) {
    const p = firstLine(r.out);
    try { if (p && fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return null;
}

/**
 * What this machine can actually give us. Everything downstream degrades
 * gracefully when a capability is missing — the UI hides the corresponding
 * panel instead of showing fake numbers.
 */
function probe() {
  const platform = process.platform;
  const cap = {
    platform,
    node: process.version,
    host: os.hostname(),
    gpuSmi: findNvidiaSmi(platform),
    gpuPower: false,
    // inventory / perf capabilities, filled per platform
    pnputil: false,
    pnputilRelations: false,
    typeperf: false,
    sysfs: false,
    rapl: false,
    systemProfiler: false,
  };

  if (platform === 'win32') {
    const pnputil = run('pnputil', ['/?']);
    if (pnputil.ok || pnputil.out.length > 0) {
      cap.pnputil = true;
      // /relations arrived in Windows 10 1903; without it we fall back to WMI
      cap.pnputilRelations = /\/relations/i.test(pnputil.out);
    }
    cap.typeperf = run('typeperf', ['/?']).ok;
  } else if (platform === 'linux') {
    cap.sysfs = fs.existsSync('/sys/bus/usb/devices');
    cap.rapl = fs.existsSync('/sys/class/powercap/intel-rapl:0/energy_uj');
  } else if (platform === 'darwin') {
    cap.systemProfiler = run('system_profiler', ['-listDataTypes']).ok;
  }

  cap.gpuPower = !!cap.gpuSmi;
  return cap;
}

module.exports = { probe };
