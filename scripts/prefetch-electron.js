#!/usr/bin/env node
'use strict';
// Fills Electron's and electron-builder's download caches before electron-builder runs, so a build
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

// ---- electron-builder's helper tools -------------------------------------------------
// electron-builder downloads these from electron-userland/electron-builder-binaries while it
// builds and retries each only a few times in ~25 s, which a longer GitHub outage outlasts.
// Checksums are copied from electron-builder 26.18.0 (toolsets/*.js, dmg-builder/dmgUtil.js);
// electron-builder verifies them again when it takes a file from its archive cache.
const BUILDER_VERSION = '26.18.0';
const HELPERS = {
  common: [
    ['icons@1.2.3', 'icons-bundle.tar.gz', '4e5bb546c9d3ab0c2bbacc22857467bf415f742a34c2be9dd138779d2fc066f9'],
  ],
  win: [
    ['7zip@1.0.0', '7zip-win-x64.tar.gz', 'be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3'],
    ['winCodeSign-2.6.0', 'winCodeSign-2.6.0.7z', 'cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4'],
    ['nsis-3.0.4.1', 'nsis-3.0.4.1.7z', '9877df902530f96357d13a7a31ae2b9df67f48b11ffc9a1700a7c961574ec5fa'],
    ['nsis-resources-3.4.1', 'nsis-resources-3.4.1.7z', '593a9a92ef958321293ac6a2ee61e64bf1bd543142a5bd6b3d310709cc924103'],
  ],
  mac: [
    ['7zip@1.0.0', `7zip-darwin-${process.arch === 'arm64' ? 'arm64' : 'x86_64'}.tar.gz`, '496a341abe210aae1a25bc202ee97f6de6c76a3dc80f91d96616be05502d72c1'],
    ['dmg-builder@1.2.5', 'dmgbuild-bundle-arm64-75c8a6c.tar.gz', '793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb'],
    ['dmg-builder@1.2.5', 'dmgbuild-bundle-x86_64-75c8a6c.tar.gz', '1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433'],
  ],
  linux: [],
};
const HELPERS_BASE = 'https://github.com/electron-userland/electron-builder-binaries/releases/download/';

// Same place as electron-builder's getCacheDirectory().
function builderCacheRoot() {
  const env = process.env.ELECTRON_BUILDER_CACHE && process.env.ELECTRON_BUILDER_CACHE.trim();
  if (env && path.parse(env).root) return env;
  const home = os.homedir();
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'electron-builder');
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.tmpdir(), 'electron-builder-cache'), 'electron-builder', 'Cache');
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'electron-builder');
}

function prefetchHelpers() {
  let installed = null;
  try { installed = require('app-builder-lib/package.json').version; } catch { /* not installed */ }
  if (installed !== BUILDER_VERSION) {
    console.log(`electron-builder is ${installed}, the helper list is for ${BUILDER_VERSION}: skipping helper prefetch`);
    return;
  }
  for (const [release, name, hash] of [...HELPERS.common, ...HELPERS[which]]) {
    const target = path.join(builderCacheRoot(), release, name);
    if (fs.existsSync(target) && sha256(target) === hash) { console.log(`${name}: already cached`); continue; }
    const file = path.join(tmp, name);
    curl(`${HELPERS_BASE}${release}/${name}`, file);
    const got = sha256(file);
    if (got !== hash) throw new Error(`${name}: checksum mismatch (got ${got}, expected ${hash})`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    console.log(`${name}: verified, cached at ${target}`);
  }
}

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
prefetchHelpers();
fs.rmSync(tmp, { recursive: true, force: true });
