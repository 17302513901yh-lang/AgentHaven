#!/usr/bin/env node
'use strict';
// Fills Electron's download cache before electron-builder runs, so a build
// does not fail when GitHub's release CDN answers 5xx for a while (it did
// for Electron v45.2.3 on 2026-11-08, for many minutes).
//
// - Downloads with curl, which retries on any error with pauses (Node's
//   HTTP client crashed outright on a dropped connection during the outage).
// - Verifies every zip against SHASUMS256.txt from the same GitHub release.
// - Puts the zip and SHASUMS256.txt where @electron/get looks, so
//   electron-builder builds without touching the network and still runs its
//   own checksum check against the cached SHASUMS256.txt.
//
//   node scripts/prefetch-electron.js win     # win32 x64 + arm64
//   node scripts/prefetch-electron.js mac     # darwin x64 + arm64 (universal)
//   node scripts/prefetch-electron.js linux   # linux x64
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const version = require('electron/package.json').version;
const BASE = `https://github.com/electron/electron/releases/download/v${version}/`;
const TARGETS = {
  win: [['win32', 'x64'], ['win32', 'arm64']],
  mac: [['darwin', 'x64'], ['darwin', 'arm64']],
  linux: [['linux', 'x64']],
};

// Same place as env-paths('electron', { suffix: '' }).cache, which @electron/get uses.
function cacheRoot() {
  if (process.env.electron_config_cache) return process.env.electron_config_cache;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'electron');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'electron', 'Cache');
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron');
}

// @electron/get keys the cache by a hash of the download folder URL.
function cacheDir(url) {
  const u = new URL(url);
  u.hash = ''; u.search = ''; u.pathname = path.posix.dirname(u.pathname);
  return path.join(cacheRoot(), crypto.createHash('sha256').update(u.toString()).digest('hex'));
}

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function curl(url, out) {
  execFileSync('curl', ['-fsSL', '--retry', '15', '--retry-all-errors', '--retry-delay', '20', '--connect-timeout', '30', '--max-time', '900', '-o', out, url],
    { stdio: ['ignore', 'inherit', 'inherit'] });
}

function place(name, src) {
  const dir = cacheDir(BASE + name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, name));
  return path.join(dir, name);
}

const which = process.argv[2];
if (!TARGETS[which]) { console.error(`usage: prefetch-electron.js ${Object.keys(TARGETS).join('|')}`); process.exit(2); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-prefetch-'));
const sums = path.join(tmp, 'SHASUMS256.txt');
curl(`${BASE}SHASUMS256.txt`, sums);
const expected = Object.fromEntries(fs.readFileSync(sums, 'utf8').split('\n').map((l) => l.trim().split(/\s+\*?/)).filter((p) => p.length === 2).map(([h, f]) => [f.replace(/^\*/, ''), h]));
place('SHASUMS256.txt', sums);

for (const [platform, arch] of TARGETS[which]) {
  const name = `electron-v${version}-${platform}-${arch}.zip`;
  const cached = path.join(cacheDir(BASE + name), name);
  if (fs.existsSync(cached) && sha256(cached) === expected[name]) { console.log(`${name}: already cached`); continue; }
  const file = path.join(tmp, name);
  curl(BASE + name, file);
  const got = sha256(file);
  if (!expected[name]) throw new Error(`${name} is not listed in SHASUMS256.txt`);
  if (got !== expected[name]) throw new Error(`${name}: checksum mismatch (got ${got}, expected ${expected[name]})`);
  console.log(`${name}: verified, cached at ${place(name, file)}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
