'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function createServer({ getFrame, publicDir }) {
  const clients = new Set();

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];

    if (url === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      clients.add(res);
      const snap = getFrame(true);
      res.write(`data: ${JSON.stringify(snap)}\n\n`);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url === '/api/snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(getFrame(true)));
      return;
    }

    if (url === '/api/health') {
      const f = getFrame(false);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, sources: f.sources, dock: f.model && f.model.dock ? f.model.dock.present : false }));
      return;
    }

    const rel = url === '/' ? '/index.html' : decodeURIComponent(url);
    const full = path.join(publicDir, path.normalize(rel).replace(/^(\.\.[\\/])+/, ''));
    if (!full.startsWith(publicDir)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }

    fs.readFile(full, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });

  function broadcast(payload) {
    if (!clients.size) return;
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of clients) {
      try { res.write(data); } catch (e) { clients.delete(res); }
    }
  }

  return { server, broadcast, clients };
}

module.exports = { createServer };
