'use strict';
/**
 * End-to-end smoke test: boot the real server in demo mode and make sure the
 * HTTP surface, the SSE producer and the model pipeline all work on this OS.
 *
 * This is the one test that exercises the whole stack, so it runs on all three
 * platforms in CI — including macOS and Linux where the native adapters have
 * code paths that unit tests can only cover with fixtures.
 */
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.SMOKE_PORT || 8899);
const ROOT = path.join(__dirname, '..');

function get(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: urlPath, timeout: 4000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exitCode = 1;
}

async function main() {
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'src', 'index.js'), '--demo', '--no-open', '--port', String(PORT)],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => { stderr += c; });

  const stop = () => { try { child.kill(); } catch (e) { /* already gone */ } };
  process.on('exit', stop);

  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await get('/api/health');
      if (r.status === 200) { up = true; break; }
    } catch (e) { /* not listening yet */ }
    await sleep(500);
  }
  if (!up) {
    fail(`server did not come up on :${PORT}${stderr ? `\n${stderr.trim()}` : ''}`);
    return stop();
  }

  const page = await get('/');
  if (page.status !== 200 || !page.body.includes('DOCK CONSOLE')) fail('index.html not served');

  const i18n = await get('/i18n.js');
  if (i18n.status !== 200 || !i18n.body.includes('dockconsole.lang')) fail('i18n.js not served');

  const snap = await get('/api/snapshot');
  if (snap.status !== 200) return fail(`/api/snapshot returned ${snap.status}`);

  let s;
  try { s = JSON.parse(snap.body); } catch (e) { return fail('snapshot is not valid JSON'); }

  if (!s.demo) fail('snapshot did not report demo mode');
  if (!s.model || !s.model.dock) fail('snapshot has no dock model');
  else {
    if (!s.model.dock.present) fail('demo dock not detected');
    if (s.model.dock.devices.length < 3) fail(`only ${s.model.dock.devices.length} dock devices`);
  }
  if (!s.power || typeof s.power.total !== 'number') fail('no power figure');
  if (!Array.isArray(s.history) || s.history.length < 1) fail('no history frames');
  if (!s.caps || !s.caps.platform) fail('caps missing platform');

  const health = await get('/api/health');
  if (!health.body.includes('"ok":true')) fail('/api/health not ok');

  if (!process.exitCode) {
    console.log(`\x1b[32m✓ smoke test passed\x1b[0m  platform=${s.caps.platform} devices=${s.model.dock.devices.length} power=${s.power.total}W frames=${s.history.length}`);
  }
  stop();
}

main().catch((e) => {
  console.error(`\x1b[31m✗ ${e.message}\x1b[0m`);
  process.exit(1);
});
