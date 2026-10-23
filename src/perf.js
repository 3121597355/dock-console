'use strict';
const { spawn } = require('child_process');

const COUNTERS = [
  '\\Processor Information(_Total)\\% Processor Time',
  '\\Processor Information(_Total)\\% Processor Utility',
  '\\Processor Information(_Total)\\% of Maximum Frequency',
  '\\Memory\\% Committed Bytes In Use',
  '\\Memory\\Committed Bytes',
  '\\Memory\\Available MBytes',
  '\\PhysicalDisk(*)\\Disk Read Bytes/sec',
  '\\PhysicalDisk(*)\\Disk Write Bytes/sec',
  '\\Network Interface(*)\\Bytes Received/sec',
  '\\Network Interface(*)\\Bytes Sent/sec',
];

function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * `typeperf` streams PDH counters on a fixed cadence — one long-lived process is
 * far cheaper than calling Get-Counter per tick (that re-initialises a query
 * object every time, ~1.2 s of overhead per sample on this class of machine).
 */
function start({ cwd, intervalSec = 1, onSample, onStatus }) {
  let child = null;
  let header = null;
  let warmup = 0;
  let timer = null;
  let stopped = false;

  function launch() {
    if (stopped) return;
    header = null;
    warmup = 0;
    child = spawn('typeperf', [...COUNTERS, '-si', String(intervalSec), '-sc', '200000'], {
      cwd,
      windowsHide: true,
    });

    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const raw = buf.slice(0, i).replace(/\r$/, '').trim();
        buf = buf.slice(i + 1);
        if (!raw || !raw.startsWith('"')) continue;

        const cells = splitCsv(raw);
        if (!header) {
          header = cells.slice(1).map((c) => c.toLowerCase());
          onStatus && onStatus('ok');
          continue;
        }
        // instance list changed (disk plugged in / adapter disabled) → restart so
        // columns stay aligned with the header we parse by name
        if (cells.length - 1 !== header.length) { restart(); return; }

        // the first samples of a fresh query are averages since boot
        if (warmup < 2) { warmup++; continue; }
        onSample && onSample(apply(header, cells.slice(1)));
      }
    });

    child.on('exit', () => {
      if (stopped) return;
      onStatus && onStatus('down');
      clearTimeout(timer);
      timer = setTimeout(launch, 2000);
    });
  }

  function apply(cols, values) {
    const sample = { perDisk: {}, cpu: 0, cpuUtil: 0, freq: 0, mem: 0, memUsedGB: 0, memFreeGB: 0, diskR: 0, diskW: 0, netRx: 0, netTx: 0 };
    for (let i = 0; i < cols.length; i++) {
      // typeperf echoes counters as "\\HOST\Object(Instance)\Counter" — drop the
      // host prefix, otherwise every `name === ...` test below misses
      const name = cols[i].replace(/^\\\\[^\\]+\\/, '');
      const val = num(values[i]);
      let mm;
      if (name.startsWith('processor information(_total)\\% processor time')) sample.cpu = val;
      else if (name.startsWith('processor information(_total)\\% processor utility')) sample.cpuUtil = val;
      else if (name.startsWith('processor information(_total)\\% of maximum frequency')) sample.freq = val;
      else if (name === 'memory\\% committed bytes in use') sample.mem = val;
      else if (name === 'memory\\committed bytes') sample.memUsedGB = val / 1073741824;
      else if (name === 'memory\\available mbytes') sample.memFreeGB = val / 1024;
      else if ((mm = name.match(/physicaldisk\((.*?)\)\\disk read bytes\/sec/))) {
        if (mm[1] === '_total') sample.diskR += val;
        else {
          const idx = parseInt(mm[1], 10);
          if (!Number.isNaN(idx)) {
            sample.perDisk[idx] = sample.perDisk[idx] || { r: 0, w: 0 };
            sample.perDisk[idx].r += val;
          }
        }
      } else if ((mm = name.match(/physicaldisk\((.*?)\)\\disk write bytes\/sec/))) {
        if (mm[1] === '_total') sample.diskW += val;
        else {
          const idx = parseInt(mm[1], 10);
          if (!Number.isNaN(idx)) {
            sample.perDisk[idx] = sample.perDisk[idx] || { r: 0, w: 0 };
            sample.perDisk[idx].w += val;
          }
        }
      } else if ((mm = name.match(/network interface\((.*?)\)\\bytes received\/sec/))) {
        if (!/isatap|teredo|loopback|pseudo/i.test(mm[1])) sample.netRx += val;
      } else if ((mm = name.match(/network interface\((.*?)\)\\bytes sent\/sec/))) {
        if (!/isatap|teredo|loopback|pseudo/i.test(mm[1])) sample.netTx += val;
      }
    }
    return sample;
  }

  function restart() {
    try { child && child.kill(); } catch (e) {}
  }

  launch();
  return { stop() { stopped = true; clearTimeout(timer); try { child && child.kill(); } catch (e) {} } };
}

module.exports = { start, COUNTERS };
