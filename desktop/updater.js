'use strict';
// Automatic updates for the desktop app, driven from the dashboard.
//
// Updates come from GitHub Releases through electron-updater (latest.yml / latest-mac.yml).
// - Windows: the update downloads in the background (differential, via the .blockmap) and
//   installs silently on "Restart & update", or when the app quits.
// - macOS, signed build: the same, through Squirrel.Mac.
// - macOS, unsigned (ad-hoc) build: Squirrel.Mac refuses to install it, so the app downloads
//   the new .dmg to the Downloads folder instead, opens it, and tells the user to drag
//   AgentHaven onto Applications. No wasted download of the zip first.
//
// The module has no Electron imports of its own: everything platform-specific is passed in,
// so the state machine can be tested with plain Node.
const fs = require('node:fs');
const path = require('node:path');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RELEASES = 'https://github.com/laaielichter/AgentHaven/releases';

// GitHub sends release notes as HTML. Show them as plain text, never as markup.
function notesToText(notes) {
  if (Array.isArray(notes)) notes = notes.map((n) => n.note || '').join('\n\n');
  if (!notes) return '';
  return String(notes)
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div)\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000);
}

function dmgUrl(version) {
  return `${RELEASES}/download/v${version}/AgentHaven-${version}-universal.dmg`;
}

/**
 * @param {object} o
 * @param {import('events').EventEmitter & {checkForUpdates:Function, downloadUpdate:Function, quitAndInstall:Function}} o.autoUpdater
 * @param {string} o.currentVersion
 * @param {string} o.platform            process.platform
 * @param {boolean} o.manualInstall      true for an unsigned macOS build (download the .dmg instead)
 * @param {string} o.settingsFile        JSON file for { autoCheck, skipped, lastVersion }
 * @param {(state:object) => void} o.send            push state to the dashboard
 * @param {(url:string, onProgress:(p:object)=>void) => Promise<string>} [o.downloadFile]  manual download, resolves to the saved path
 * @param {(file:string) => void} [o.openFile]
 * @param {(url:string) => void} [o.openExternal]
 * @param {() => void} [o.quit]
 * @param {(fn:Function, ms:number) => any} [o.every]
 */
function createUpdater(o) {
  const au = o.autoUpdater;
  const settings = { autoCheck: true, skipped: null, lastVersion: null, ...readJson(o.settingsFile) };
  const justUpdatedFrom = settings.lastVersion && settings.lastVersion !== o.currentVersion ? settings.lastVersion : null;
  if (settings.lastVersion !== o.currentVersion) { settings.lastVersion = o.currentVersion; save(); }

  let state = {
    status: 'idle', // idle | checking | up-to-date | available | downloading | downloaded | error
    currentVersion: o.currentVersion,
    platform: o.platform,
    manualInstall: Boolean(o.manualInstall),
    autoCheck: settings.autoCheck,
    justUpdatedFrom,
    version: null, notes: '', releaseDate: null, releaseUrl: justUpdatedFrom ? `${RELEASES}/tag/v${o.currentVersion}` : RELEASES,
    percent: 0, transferred: 0, total: 0, bytesPerSecond: 0,
    file: null, error: null, checkedAt: null, manualCheck: false,
  };
  let latest = null;

  function save() { try { fs.mkdirSync(path.dirname(o.settingsFile), { recursive: true }); fs.writeFileSync(o.settingsFile, JSON.stringify(settings, null, 2)); } catch { /* read-only profile: keep defaults */ } }
  function set(patch) { state = { ...state, ...patch }; o.send({ ...state }); }

  // Downloads are started here, not by electron-updater, so a skipped version is never fetched.
  au.autoDownload = false;
  au.autoInstallOnAppQuit = !o.manualInstall;
  au.allowPrerelease = false;

  au.on('checking-for-update', () => set({ status: 'checking', error: null }));
  au.on('update-not-available', () => set({ status: 'up-to-date', checkedAt: new Date().toISOString(), version: null }));
  au.on('update-available', (info) => {
    latest = info;
    const skipped = !state.manualCheck && settings.skipped === info.version;
    set({
      status: skipped ? 'up-to-date' : (o.manualInstall ? 'available' : 'downloading'),
      version: info.version, notes: notesToText(info.releaseNotes), releaseDate: info.releaseDate || null,
      releaseUrl: `${RELEASES}/tag/v${info.version}`, checkedAt: new Date().toISOString(), percent: 0,
    });
    if (!skipped && !state.manualInstall) download();
  });
  au.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p.percent || 0), transferred: p.transferred || 0, total: p.total || 0, bytesPerSecond: p.bytesPerSecond || 0 }));
  au.on('update-downloaded', (info) => { au.autoInstallOnAppQuit = !state.manualInstall; set({ status: 'downloaded', version: info.version || state.version, percent: 100 }); });
  au.on('error', (err) => {
    // A signed-looking macOS build that Squirrel.Mac still rejects: fall back to the .dmg.
    if (o.platform === 'darwin' && !state.manualInstall && /code signature|signature.*validation|not signed/i.test(String(err && err.message))) {
      au.autoInstallOnAppQuit = false;
      set({ manualInstall: true, status: latest ? 'available' : 'error', error: latest ? null : 'This build cannot install updates by itself. Download the new version instead.' });
      return;
    }
    set({ status: 'error', error: shortError(err) });
  });

  async function check({ manual = false } = {}) {
    if (['checking', 'downloading'].includes(state.status)) return { ...state };
    set({ manualCheck: manual, error: null });
    try { await au.checkForUpdates(); } catch (err) { set({ status: 'error', error: shortError(err) }); }
    return { ...state };
  }

  async function download() {
    if (!latest) return { ...state };
    if (!state.manualInstall) {
      set({ status: 'downloading', percent: 0 });
      try { await au.downloadUpdate(); } catch (err) { if (!state.manualInstall) set({ status: 'error', error: shortError(err) }); }
      return { ...state };
    }
    if (!o.downloadFile) { o.openExternal?.(state.releaseUrl); return { ...state }; }
    set({ status: 'downloading', percent: 0 });
    try {
      const file = await o.downloadFile(dmgUrl(latest.version), (p) => set({ status: 'downloading', ...p }));
      set({ status: 'downloaded', file, percent: 100 });
      o.openFile?.(file);
    } catch (err) {
      set({ status: 'error', error: `${shortError(err)} You can download it from the Releases page.` });
    }
    return { ...state };
  }

  function install() {
    if (state.status !== 'downloaded') return false;
    // macOS without a signature: show the mounted .dmg and quit, so the drag onto Applications
    // can replace the running app.
    if (state.manualInstall) { if (state.file) o.openFile?.(state.file); if (o.quit) setTimeout(o.quit, 800); return true; }
    // Windows: silent install, then start the new version.
    setImmediate(() => au.quitAndInstall(true, true));
    return true;
  }

  function skip() {
    if (!state.version) return { ...state };
    settings.skipped = state.version; save();
    au.autoInstallOnAppQuit = false; // a skipped update that already downloaded must not install on quit
    set({ status: 'up-to-date', version: null, notes: '' });
    return { ...state };
  }

  function setAutoCheck(on) {
    settings.autoCheck = Boolean(on); save();
    set({ autoCheck: settings.autoCheck });
    if (settings.autoCheck) check();
    return { ...state };
  }

  function dismissWhatsNew() { set({ justUpdatedFrom: null }); return { ...state }; }

  function start() {
    if (settings.autoCheck) check();
    (o.every || setInterval)(() => { if (settings.autoCheck) check(); }, CHECK_EVERY_MS);
  }

  return { get: () => ({ ...state }), check, download, install, skip, setAutoCheck, dismissWhatsNew, start };
}

function shortError(err) {
  const msg = String((err && err.message) || err || 'Unknown error').split('\n')[0];
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(msg)) return 'No connection to GitHub. AgentHaven will try again later.';
  if (/\b(5\d\d)\b/.test(msg)) return 'GitHub is not answering right now. AgentHaven will try again later.';
  if (/\b404\b/.test(msg)) return 'No published release found yet.';
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } }

module.exports = { createUpdater, notesToText, shortError, dmgUrl };
