'use strict';
// AgentHaven desktop app (Windows + macOS) — Electron shell around the local
// dashboard server. Agents connect through the bundled MCP plugin.
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } = require('electron');
const { createUpdater } = require('./updater');
const { start } = require('../src/server');
const { defaultDataDir } = require('../src/store');
const connect = require('../src/connect');

let win;
let url;
let updater = null;

// The packaged app executable doubles as a Node runtime for the plugin.
const entry = (agent) => connect.serverEntry({
  command: process.execPath,
  script: path.join(__dirname, '..', 'bin', 'agenthaven.js'),
  agent,
  extraEnv: { ELECTRON_RUN_AS_NODE: '1' },
});

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 500, title: 'AgentHaven', backgroundColor: '#f7f7ee', show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https:\/\//.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(url)) e.preventDefault(); });
  win.loadURL(url);
}

function installInto(clientId, agent) {
  try {
    const client = connect.install(clientId, entry(agent));
    dialog.showMessageBox(win, { message: `AgentHaven connected to ${client.label}`, detail: `Updated ${client.file}\nRestart ${client.label} to load the AgentHaven tools.` });
  } catch (err) {
    dialog.showErrorBox('Could not connect agent', err.message);
  }
}

function copyConfig(agent) {
  clipboard.writeText(JSON.stringify({ mcpServers: { agenthaven: entry(agent) } }, null, 2));
  dialog.showMessageBox(win, { message: `MCP config for "${agent}" copied`, detail: 'Paste it into your agent\'s MCP settings and restart the agent.' });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Open Data Folder', click: () => shell.openPath(defaultDataDir()) },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'Agents', submenu: [
      { label: 'Connect Claude Desktop', click: () => installInto('claude', 'claude') },
      { label: 'Connect Cursor', click: () => installInto('cursor', 'cursor') },
      { label: 'Connect Windsurf', click: () => installInto('windsurf', 'windsurf') },
      { label: 'Connect Gemini CLI', click: () => installInto('gemini', 'gemini') },
      { label: 'Connect Codex', click: () => installInto('codex', 'codex') },
      { type: 'separator' },
      { label: 'Copy MCP Config (Claude Code, VS Code, Copilot, Zed, …)', click: () => copyConfig('agent') },
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [
      { label: 'Check for Updates…', enabled: app.isPackaged, click: () => checkForUpdates() },
      { label: 'AgentHaven on GitHub', click: () => shell.openExternal('https://github.com/laaielichter/AgentHaven') },
      { label: 'Star AgentHaven on GitHub ⭐', click: () => shell.openExternal('https://github.com/laaielichter/AgentHaven/stargazers') },
      { label: 'Contribute: Good First Issues', click: () => shell.openExternal('https://github.com/laaielichter/AgentHaven/contribute') },
    ] },
  ]));
}

// ---- automatic updates (see updater.js) --------------------------------------------

// An unsigned macOS build is ad-hoc signed by electron-builder; Squirrel.Mac cannot update it.
function isAdhocMac() {
  if (process.platform !== 'darwin') return false;
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  const r = spawnSync('codesign', ['-dv', bundle], { encoding: 'utf8' });
  if (r.status !== 0) return true;
  return /Signature=adhoc/.test(`${r.stdout}${r.stderr}`) || !/TeamIdentifier=(?!not set)\S+/.test(`${r.stdout}${r.stderr}`);
}

// Download a file to the Downloads folder through Chromium's downloader, with progress.
function downloadFile(target, onProgress) {
  return new Promise((resolve, reject) => {
    const ses = win.webContents.session;
    const onWill = (_e, item) => {
      if (item.getURLChain()[0] !== target) return;
      ses.removeListener('will-download', onWill);
      const file = path.join(app.getPath('downloads'), item.getFilename());
      item.setSavePath(file);
      const started = Date.now();
      item.on('updated', () => {
        const total = item.getTotalBytes(); const transferred = item.getReceivedBytes();
        const secs = Math.max((Date.now() - started) / 1000, 0.1);
        onProgress({ percent: total ? Math.round((transferred / total) * 100) : 0, transferred, total, bytesPerSecond: Math.round(transferred / secs) });
        win?.setProgressBar(total ? transferred / total : 2);
      });
      item.once('done', (_ev, st) => {
        win?.setProgressBar(-1);
        if (st === 'completed') resolve(file); else reject(new Error(`Download ${st}.`));
      });
    };
    ses.on('will-download', onWill);
    ses.downloadURL(target);
  });
}

function setupUpdates() {
  // The dashboard page may only talk to the updater from the app's own local origin.
  const fromApp = (e) => Boolean(url) && e.senderFrame && e.senderFrame.url.startsWith(url);
  const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => {
    if (!fromApp(e)) throw new Error('Not allowed');
    if (!updater) return { status: 'unsupported', reason: app.isPackaged ? 'Updates are not available on this system.' : 'Updates work in the installed app, not in a development build.' };
    return fn(...args);
  });
  handle('updates:get', () => updater.get());
  handle('updates:check', () => updater.check({ manual: true }));
  handle('updates:download', () => updater.download());
  handle('updates:install', () => updater.install());
  handle('updates:skip', () => updater.skip());
  handle('updates:auto', (on) => updater.setAutoCheck(on === true));
  handle('updates:seen', () => updater.dismissWhatsNew());
  handle('updates:releases', () => shell.openExternal(updater.get().releaseUrl));

  if (!app.isPackaged || !['win32', 'darwin'].includes(process.platform)) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  updater = createUpdater({
    autoUpdater,
    currentVersion: app.getVersion(),
    platform: process.platform,
    manualInstall: isAdhocMac(),
    settingsFile: path.join(app.getPath('userData'), 'updates.json'),
    send: (state) => {
      if (win && !win.isDestroyed()) win.webContents.send('updates:state', state);
      if (state.status === 'downloading' && !state.manualInstall) win?.setProgressBar(state.percent / 100);
      if (state.status !== 'downloading' && !state.manualInstall) win?.setProgressBar(-1);
    },
    downloadFile,
    openFile: (file) => shell.openPath(file),
    openExternal: (target) => shell.openExternal(target),
    quit: () => app.quit(),
  });
  updater.start();
}

// Help → Check for Updates: the result shows in the dashboard's update bar.
function checkForUpdates() {
  if (!updater) { dialog.showMessageBox(win, { message: 'Updates work in the installed app.' }); return; }
  updater.check({ manual: true }).then((s) => {
    if (s.status === 'up-to-date') dialog.showMessageBox(win, { message: `AgentHaven ${s.currentVersion} is up to date.` });
    else if (s.status === 'error') dialog.showMessageBox(win, { type: 'warning', message: 'Update check failed', detail: s.error });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    ({ url } = await start({ dataDir: defaultDataDir() }));
    buildMenu();
    createWindow();
    setupUpdates();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((err) => { dialog.showErrorBox('AgentHaven could not start', err.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
