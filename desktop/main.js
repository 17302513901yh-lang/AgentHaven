'use strict';
// AgentHaven desktop app (Windows + macOS) — Electron shell around the local
// dashboard server. Agents connect through the bundled MCP plugin.
const path = require('node:path');
const { app, BrowserWindow, Menu, clipboard, dialog, shell } = require('electron');
const { start } = require('../src/server');
const { defaultDataDir } = require('../src/store');
const connect = require('../src/connect');

let win;
let url;

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
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
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
      { label: 'Check for Updates…', enabled: app.isPackaged, click: () => checkForUpdates(true) },
      { label: 'AgentHaven on GitHub', click: () => shell.openExternal('https://github.com/laaielichter/AgentHaven') },
    ] },
  ]));
}

// Updates come from GitHub Releases (electron-updater). macOS requires a
// signed build for auto-update; errors are only shown when the user asked.
function checkForUpdates(manual = false) {
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.once('update-downloaded', (info) => {
    dialog.showMessageBox(win, { message: `AgentHaven ${info.version} is ready`, detail: 'Restart to install the update.', buttons: ['Restart now', 'Later'] })
      .then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  });
  autoUpdater.checkForUpdates()
    .then((r) => { if (manual && !r?.isUpdateAvailable) dialog.showMessageBox(win, { message: 'AgentHaven is up to date.' }); })
    .catch((err) => { if (manual) dialog.showErrorBox('Update check failed', err.message); });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    ({ url } = await start({ dataDir: defaultDataDir() }));
    buildMenu();
    createWindow();
    if (app.isPackaged) checkForUpdates(false);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch((err) => { dialog.showErrorBox('AgentHaven could not start', err.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
