'use strict';
// Local HTTP API + dashboard. Bound to 127.0.0.1 only; Host/Origin checks
// block DNS-rebinding and cross-site requests from web pages.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');

const UI_DIR = path.join(__dirname, '..', 'ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

function createServer({ store = new Store(), human = 'you' } = {}) {
  const routes = [
    ['GET', /^\/api\/tasks$/, (q) => store.listTasks({ status: q.get('status') || undefined, assignee: q.get('assignee') || undefined })],
    ['POST', /^\/api\/tasks$/, (q, b) => store.createTask({ ...b, actor: human })],
    ['PATCH', /^\/api\/tasks\/([\w-]+)$/, (q, b, id) => store.updateTask(id, { ...b, actor: human })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/handoff$/, (q, b, id) => store.handoff(id, { ...b, actor: human })],
    ['GET', /^\/api\/notes$/, (q) => store.listNotes({ query: q.get('q') || undefined })],
    ['POST', /^\/api\/notes$/, (q, b) => store.addNote({ ...b, actor: human })],
    ['GET', /^\/api\/activity$/, (q) => store.activity({ limit: Number(q.get('limit')) || 50 })],
  ];

  const server = http.createServer((req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'" });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const port = server.address().port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!allowedHosts.includes(req.headers.host)) return send(403, { error: 'forbidden host' });
    if (req.method !== 'GET' && req.headers.origin && !allowedHosts.map((h) => `http://${h}`).includes(req.headers.origin)) {
      return send(403, { error: 'forbidden origin' });
    }
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (!m || method !== req.method) continue;
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
        req.on('end', () => {
          try {
            if (req.method !== 'GET' && !String(req.headers['content-type']).startsWith('application/json')) return send(415, { error: 'use application/json' });
            const body = raw ? JSON.parse(raw) : {};
            send(req.method === 'POST' ? 201 : 200, fn(url.searchParams, body, m[1]));
          } catch (err) {
            const status = err.code === 'CONFLICT' ? 409 : err.code === 'INVALID' || err instanceof SyntaxError ? 400 : 500;
            send(status, { error: err.message, current: err.current });
          }
        });
        return;
      }
      return send(404, { error: 'not found' });
    }

    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const full = path.join(UI_DIR, file);
    if (!full.startsWith(UI_DIR + path.sep) || req.method !== 'GET') return send(404, { error: 'not found' });
    fs.readFile(full, (err, data) => (err ? send(404, { error: 'not found' }) : send(200, data, MIME[path.extname(full)] || 'application/octet-stream')));
  });
  return server;
}

function start({ port = 0, ...opts } = {}) {
  const server = createServer(opts);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

module.exports = { createServer, start };
