'use strict';
// AgentHaven desktop app (Windows + macOS) — Electron shell around the local
// dashboard server. Agents connect through the bundled MCP plugin.
const path = require('node:path');
const { app, BrowserWindow, Menu, clipboard, dialog, shell } = require('electron');
const { start } = require('../src/server');
const { Store, defaultDataDir } = require('../src/store');

let win;
let url;

function mcpConfig(agent) {
  // The packaged app executable doubles as a Node runtime for the plugin.
  return { mcpServers: { agenthaven: {
    command: process.execPath,
    args: [path.join(__dirname, '..', 'bin', 'agenthaven.js'), 'mcp', '--agent', agent],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  } } };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 500, title: 'AgentHaven', backgroundColor: '#f7f7ee',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url: target }) => { shell.openExternal(target); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(url)) e.preventDefault(); });
  win.loadURL(url);
}

function buildMenu() {
  const copy = (agent) => () => {
    clipboard.writeText(JSON.stringify(mcpConfig(agent), null, 2));
    dialog.showMessageBox(win, { message: `MCP config for "${agent}" copied`, detail: 'Paste it into your agent\'s MCP settings (e.g. claude_desktop_config.json, .cursor/mcp.json) and restart the agent.' });
  };
  const isMac = process.platform === 'darwin';
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [
      { label: 'Open Data Folder', click: () => shell.openPath(defaultDataDir()) },
      isMac ? { role: 'close' } : { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'Agents', submenu: [
      { label: 'Copy MCP Config for Claude', click: copy('claude') },
      { label: 'Copy MCP Config for Cursor', click: copy('cursor') },
      { label: 'Copy MCP Config for Codex', click: copy('codex') },
      { label: 'Copy MCP Config (other agent)', click: copy('agent') },
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'AgentHaven on GitHub', click: () => shell.openExternal('https://github.com/laaielichter/AgentHaven') }] },
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    ({ url } = await start({ store: new Store() }));
    buildMenu();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
