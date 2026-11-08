'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createUpdater, notesToText, shortError, dmgUrl } = require('../desktop/updater');

// A stand-in for electron-updater's autoUpdater that replays a scripted release.
function fakeUpdater({ latest = null, failCheck = null } = {}) {
  const au = new EventEmitter();
  au.calls = { check: 0, download: 0, install: [] };
  au.checkForUpdates = async () => {
    au.calls.check++;
    au.emit('checking-for-update');
    if (failCheck) { au.emit('error', failCheck); throw failCheck; }
    if (latest) au.emit('update-available', latest); else au.emit('update-not-available', {});
  };
  au.downloadUpdate = async () => {
    au.calls.download++;
    au.emit('download-progress', { percent: 50, transferred: 5, total: 10, bytesPerSecond: 2 });
    au.emit('update-downloaded', latest);
  };
  au.quitAndInstall = (...args) => au.calls.install.push(args);
  return au;
}

function setup(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ah-upd-'));
  const settingsFile = path.join(dir, 'updates.json');
  if (opts.settings) fs.writeFileSync(settingsFile, JSON.stringify(opts.settings));
  const au = fakeUpdater(opts);
  const sent = [];
  const opened = [];
  const updater = createUpdater({
    autoUpdater: au, currentVersion: opts.currentVersion || '0.5.0', platform: opts.platform || 'win32',
    manualInstall: opts.manualInstall || false, settingsFile, send: (s) => sent.push(s),
    downloadFile: opts.downloadFile, openFile: (f) => opened.push(f), openExternal: (u) => opened.push(u),
    every: () => {},
  });
  return { updater, au, sent, opened, settingsFile };
}

const tick = () => new Promise((r) => setImmediate(r));

test('windows: a new release downloads by itself and installs silently on restart', async () => {
  const { updater, au, sent } = setup({ latest: { version: '0.6.0', releaseNotes: '<h2>New</h2><ul><li>Faster &amp; safer</li></ul>' } });
  updater.start();
  await tick();
  assert.equal(au.autoDownload, false, 'downloads are started by AgentHaven, not by electron-updater');
  assert.equal(au.calls.download, 1);
  assert.ok(sent.some((s) => s.status === 'downloading' && s.percent === 50));
  const s = updater.get();
  assert.equal(s.status, 'downloaded');
  assert.equal(s.version, '0.6.0');
  assert.match(s.notes, /• Faster & safer/);
  assert.equal(au.autoInstallOnAppQuit, true);
  assert.equal(updater.install(), true);
  await tick();
  assert.deepEqual(au.calls.install, [[true, true]]);
});

test('no update: status is up to date', async () => {
  const { updater } = setup();
  const s = await updater.check({ manual: true });
  assert.equal(s.status, 'up-to-date');
  assert.ok(s.checkedAt);
  assert.equal(updater.install(), false, 'nothing to install');
});

test('a skipped version is not downloaded on automatic checks, but a manual check offers it again', async () => {
  const { updater, au } = setup({ latest: { version: '0.6.0' }, settings: { skipped: '0.6.0' } });
  await updater.check();
  assert.equal(au.calls.download, 0);
  assert.equal(updater.get().status, 'up-to-date');
  await updater.check({ manual: true });
  await tick();
  assert.equal(au.calls.download, 1);
  assert.equal(updater.get().status, 'downloaded');
});

test('skip after download: the update no longer installs on quit and the choice is saved', async () => {
  const { updater, au, settingsFile } = setup({ latest: { version: '0.6.0' } });
  await updater.check();
  await tick();
  updater.skip();
  assert.equal(au.autoInstallOnAppQuit, false);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).skipped, '0.6.0');
  assert.equal(updater.get().status, 'up-to-date');
});

test('mac without a signature: offers the .dmg, downloads it with progress, opens it', async () => {
  const urls = [];
  const downloadFile = async (url, onProgress) => { urls.push(url); onProgress({ percent: 40, transferred: 4, total: 10, bytesPerSecond: 1 }); return '/Users/x/Downloads/AgentHaven-0.6.0-universal.dmg'; };
  const { updater, au, opened, sent } = setup({ platform: 'darwin', manualInstall: true, latest: { version: '0.6.0' }, downloadFile });
  await updater.check();
  await tick();
  assert.equal(au.calls.download, 0, 'Squirrel.Mac is never asked to download an update it cannot install');
  assert.equal(au.autoInstallOnAppQuit, false);
  assert.equal(updater.get().status, 'available');
  await updater.download();
  assert.deepEqual(urls, [dmgUrl('0.6.0')]);
  assert.equal(urls[0], 'https://github.com/laaielichter/AgentHaven/releases/download/v0.6.0/AgentHaven-0.6.0-universal.dmg');
  assert.ok(sent.some((s) => s.status === 'downloading' && s.percent === 40));
  assert.equal(updater.get().status, 'downloaded');
  assert.deepEqual(opened, ['/Users/x/Downloads/AgentHaven-0.6.0-universal.dmg']);
});

test('mac: a signature error from Squirrel.Mac switches to the .dmg route', async () => {
  const { updater, au } = setup({ platform: 'darwin', latest: { version: '0.6.0' } });
  au.downloadUpdate = async () => { au.emit('error', new Error('Code signature at URL file:///x did not pass validation')); };
  await updater.check();
  await tick();
  const s = updater.get();
  assert.equal(s.manualInstall, true);
  assert.equal(s.status, 'available');
  assert.equal(s.error, null);
});

test('network trouble gives a short, friendly error', async () => {
  const { updater } = setup({ failCheck: new Error('net::ERR_INTERNET_DISCONNECTED\n  at stack') });
  const s = await updater.check({ manual: true });
  assert.equal(s.status, 'error');
  assert.match(s.error, /No connection to GitHub/);
  assert.match(shortError(new Error('HttpError: 504 Gateway Time-out')), /not answering/);
});

test('auto-check can be turned off and is remembered', async () => {
  const { updater, au, settingsFile } = setup();
  updater.setAutoCheck(false);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).autoCheck, false);
  const before = au.calls.check;
  updater.start();
  assert.equal(au.calls.check, before, 'no check at start when auto-check is off');
});

test('after an update the dashboard can say what changed, once', () => {
  const { updater, settingsFile } = setup({ currentVersion: '0.6.0', settings: { lastVersion: '0.5.0' } });
  const s = updater.get();
  assert.equal(s.justUpdatedFrom, '0.5.0');
  assert.match(s.releaseUrl, /\/tag\/v0\.6\.0$/);
  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).lastVersion, '0.6.0');
  assert.equal(updater.dismissWhatsNew().justUpdatedFrom, null);
});

test('release notes are shown as text, never as markup', () => {
  assert.equal(notesToText('<p>a<script>alert(1)</script></p><p>b &lt;tag&gt;</p>'), 'aalert(1)\nb <tag>');
  assert.equal(notesToText([{ note: '<b>x</b>' }, { note: 'y' }]), 'x\n\ny');
  assert.equal(notesToText(null), '');
});
