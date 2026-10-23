'use strict';
const { spawn } = require('child_process');

/**
 * nvidia-smi is the only widely available source of *actual* GPU wattage on
 * Windows. AMD/Intel expose no equivalent without a vendor SDK, so when it is
 * absent we simply report the GPU layer as unavailable rather than inventing it.
 */
function start({ smiPath, intervalSec = 1, onSample, onStatus }) {
  let child = null;
  let stopped = false;

  if (!smiPath) {
    onStatus && onStatus('missing');
    return { stop() {} };
  }

  function launch() {
    if (stopped) return;
    child = spawn(
      smiPath,
      [
        '--query-gpu=utilization.gpu,power.draw,temperature.gpu,memory.used,memory.total,clocks.gr',
        '--format=csv,noheader,nounits',
        '-l', String(intervalSec),
      ],
      { windowsHide: true }
    );

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const c = line.split(',').map((s) => s.trim());
        const pick = (v) => {
          if (/^\[?n\/a\]?$/i.test(v)) return null;
          const n = Number.parseFloat(v);
          return Number.isFinite(n) ? n : null;
        };
        onSample &&
          onSample({
            gpuUtil: pick(c[0]),
            gpuW: pick(c[1]),
            gpuTemp: pick(c[2]),
            gpuMem: pick(c[3]),
            gpuMemTotal: pick(c[4]),
            gpuClock: pick(c[5]),
          });
        onStatus && onStatus('ok');
      }
    });

    child.on('exit', () => {
      if (stopped) return;
      onStatus && onStatus('down');
      setTimeout(launch, 5000);
    });
  }

  launch();
  return { stop() { stopped = true; try { child && child.kill(); } catch (e) {} } };
}

module.exports = { start };
