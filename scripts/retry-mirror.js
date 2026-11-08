#!/usr/bin/env node
'use strict';
// A local, patient mirror for electron-builder's helper binaries (NSIS,
// win-codesign, icons, 7zip, dmg tools, ...), which come from GitHub releases
// of electron-userland/electron-builder-binaries. When GitHub's release CDN
// answers 5xx for a while, electron-builder fails on the first try; this
// mirror retries each file with curl for several minutes and keeps it.
//
// electron-builder still verifies every file against the checksums built into
// it, so the mirror cannot change what ends up in the installer.
//
//   node scripts/retry-mirror.js 8765 &
//   ELECTRON_BUILDER_BINARIES_MIRROR=http://127.0.0.1:8765/ \
//   ELECTRON_BUILDER_BINARIES_ALLOW_HTTP=true npm run dist:win
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const UPSTREAM = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/';
const port = Number(process.argv[2]) || 8765;
const dir = process.env.RETRY_MIRROR_CACHE || path.join(os.tmpdir(), 'electron-builder-binaries-mirror');
const SAFE = /^\/([A-Za-z0-9@._+-]+)\/([A-Za-z0-9@._+-]+)$/;
const inflight = new Map();

function fetchOnce(release, file) {
  const target = path.join(dir, release, file);
  if (fs.existsSync(target)) return Promise.resolve(target);
  if (inflight.has(target)) return inflight.get(target);
  const p = new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = `${target}.part`;
    // Stays under electron-builder's 10-minute request timeout.
    execFile('curl', ['-fsSL', '--retry', '12', '--retry-all-errors', '--retry-delay', '15', '--retry-max-time', '480', '--connect-timeout', '30', '-o', tmp, `${UPSTREAM}${release}/${file}`],
      { windowsHide: true }, (err, _out, stderr) => {
        if (err) { fs.rmSync(tmp, { force: true }); return reject(new Error(String(stderr || err.message).trim())); }
        fs.renameSync(tmp, target);
        resolve(target);
      });
  }).finally(() => inflight.delete(target));
  inflight.set(target, p);
  return p;
}

http.createServer((req, res) => {
  const m = req.method === 'GET' && decodeURIComponent(new URL(req.url, 'http://x').pathname).match(SAFE);
  if (!m || m[1].includes('..') || m[2].includes('..')) { res.writeHead(404).end(); return; }
  const [, release, file] = m;
  console.log(`mirror: ${release}/${file}`);
  fetchOnce(release, file).then((target) => {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(target).size });
    fs.createReadStream(target).pipe(res);
  }).catch((err) => {
    console.log(`mirror: ${release}/${file} failed: ${err.message}`);
    res.writeHead(502).end(err.message);
  });
}).listen(port, '127.0.0.1', () => console.log(`retry mirror on http://127.0.0.1:${port}/ (cache ${dir})`));
