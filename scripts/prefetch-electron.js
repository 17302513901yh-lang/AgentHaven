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

// GitHub's CDN once answered 504 for one file for more than five minutes in a row, so keep
// trying for up to PREFETCH_MINUTES (default 25) per file, in rounds of curl's own retries.
const BUDGET_MS = (Number(process.env.PREFETCH_MINUTES) || 25) * 60000;
function curl(url, out) {
  const deadline = Date.now() + BUDGET_MS;
  for (let round = 1; ; round++) {
    try {
      execFileSync('curl', ['-fsSL', '--retry', '10', '--retry-all-errors', '--retry-delay', '15', '--connect-timeout', '30', '--max-time', '900', '-o', out, url],
        { stdio: ['ignore', 'inherit', 'inherit'] });
      return;
    } catch (err) {
      if (Date.now() + 60000 > deadline) throw new Error(`${url}: still failing after ${Math.round(BUDGET_MS / 60000)} min (${err.message.split('\n')[0]})`);
      console.log(`${path.basename(url)}: round ${round} failed; trying again in 30 s`);
      execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
    }
  }
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
// Reuse a SHASUMS256.txt from a restored cache; it came from this same GitHub release.
const cachedSums = path.join(cacheDir(`${BASE}SHASUMS256.txt`), 'SHASUMS256.txt');
const sums = path.join(tmp, 'SHASUMS256.txt');
if (fs.existsSync(cachedSums) && /electron-v\S+\.zip/.test(fs.readFileSync(cachedSums, 'utf8'))) fs.copyFileSync(cachedSums, sums);
else curl(`${BASE}SHASUMS256.txt`, sums);
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
