'use strict';
const path = require('path');
const { spawn } = require('child_process');

/**
 * The PnP tree is expensive to enumerate, so it lives in a long-running
 * PowerShell process that emits one JSON line per tick (see collector.ps1).
 */
function start({ scriptPath, cachePath, intervalMs = 2000, fallback = false, cwd, onInventory, onStatus, onLog }) {
  let child = null;
  let stopped = false;
  let restartTimer = null;

  function launch() {
    if (stopped) return;
    child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        cwd,
        windowsHide: true,
        env: {
          ...process.env,
          DOCK_INTERVAL_MS: String(intervalMs),
          DOCK_CACHE: cachePath,
          DOCK_FALLBACK: fallback ? '1' : '0',
        },
      }
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
        try {
          onInventory && onInventory(JSON.parse(line));
          onStatus && onStatus('ok');
        } catch (e) {
          /* partial line or a stray banner — ignore */
        }
      }
    });

    let err = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      err = (err + c).slice(-800);
    });

    child.on('exit', (code) => {
      if (stopped) return;
      onStatus && onStatus('down');
      if (err.trim()) onLog && onLog(err.trim().split(/\r?\n/).slice(-3).join(' | '));
      clearTimeout(restartTimer);
      restartTimer = setTimeout(launch, Math.max(1500, code === 0 ? 1500 : 3000));
    });
  }

  launch();
  return {
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      try { child && child.kill(); } catch (e) {}
    },
  };
}

module.exports = { start };
