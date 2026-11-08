'use strict';
// Local HTTP API + dashboard. Bound to 127.0.0.1 only; Host/Origin checks
// block DNS-rebinding and cross-site requests from web pages.
//
// Scripts, training jobs and agents without MCP act as themselves by sending
// an `X-AgentHaven-Agent: <name>` header; without it requests come from the
// human at the dashboard ("you").
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store, defaultDataDir } = require('./store');
const workboard = require('./workboard');
const dreams = require('./dream');
const checks = require('./checks');
const gitx = require('./git');

const UI_DIR = path.join(__dirname, '..', 'ui');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const AGENT_RE = /^[\w.@-]{1,100}$/;
const STATUS = { CONFLICT: 409, INVALID: 400, NOT_FOUND: 404 };

function createServer({ store, dataDir, human = 'you', onError = () => {}, dream = true } = {}) {
  // One Store per workspace, selected with ?workspace=name (default: "default").
  const stores = new Map();
  const watchers = new Map();
  dataDir ||= store ? store.dataDir : defaultDataDir();
  const dreamers = new Map();
  const storeFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Store({ dataDir, workspace: name }));
    const s = stores.get(name);
    // Every open workspace dreams on its own schedule (settings.dream.everyHours).
    if (dream && !dreamers.has(name)) dreamers.set(name, dreams.schedule(s, { onError: (err) => onError(err, name) }));
    return s;
  };
  if (store) { stores.set(store.workspace, store); storeFor(store.workspace); }
  const pick = (q) => storeFor(q.get('workspace') || (store ? store.workspace : 'default'));
  const lessons = (s, t, actor) => ({ ...t, lessons: dreams.lessonsFor(s, t, { agent: actor }) });

  const link = (s, dir) => {
    watchers.get(s.workspace)?.stop();
    watchers.delete(s.workspace);
    if (!dir) return;
    watchers.set(s.workspace, workboard.watch(s, dir, { onError: (err) => onError(err, s.workspace) }));
  };
  // Resume the workboard sync of every workspace that has a linked folder.
  for (const name of Store.listWorkspaces(dataDir)) {
    try {
      const dir = storeFor(name).getSettings().workboardDir;
      if (dir) link(storeFor(name), dir);
    } catch (err) { onError(err, name); }
  }

  const routes = [
    ['GET', /^\/api\/tasks$/, (q, b, a) => a.s.listTasks({ status: q.get('status') || undefined, assignee: q.get('assignee') || undefined })],
    ['POST', /^\/api\/tasks$/, (q, b, a) => a.s.createTask({ ...b, actor: a.actor })],
    ['GET', /^\/api\/tasks\/next$/, (q, b, a) => a.s.nextTask({ actor: a.actor, claim: false })],
    ['POST', /^\/api\/tasks\/next$/, (q, b, a) => { const r = a.s.nextTask({ actor: a.actor, claim: b.claim !== false, skills: b.skills }); if (r.task) r.task = lessons(a.s, r.task, a.actor); return r; }],
    ['GET', /^\/api\/tasks\/([\w-]+)$/, (q, b, a, id) => lessons(a.s, a.s.getTask(id), a.actor)],
    ['PATCH', /^\/api\/tasks\/([\w-]+)$/, (q, b, a, id) => a.s.updateTask(id, { ...b, actor: a.actor })],
    ['DELETE', /^\/api\/tasks\/([\w-]+)$/, (q, b, a, id) => a.s.deleteTask(id, { version: q.has('version') ? Number(q.get('version')) : undefined, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/claim$/, (q, b, a, id) => lessons(a.s, a.s.claimTask(id, { actor: a.actor }), a.actor)],
    ['GET', /^\/api\/guard$/, (q, b, a) => a.s.guardLog({ limit: Number(q.get('limit')) || 50 })],
    ['POST', /^\/api\/notes\/([\w-]+)\/release$/, (q, b, a, id) => a.s.releaseNote(id, { actor: a.actor })],
    ['POST', /^\/api\/notes\/([\w-]+)\/remove$/, (q, b, a, id) => a.s.releaseNote(id, { actor: a.actor, remove: true })],
    ['GET', /^\/api\/inbox$/, (q, b, a) => a.s.inbox({ actor: a.actor, markRead: q.get('markRead') !== 'false' })],
    ['POST', /^\/api\/messages$/, (q, b, a) => a.s.sendMessage({ ...b, actor: a.actor })],
    ['GET', /^\/api\/tasks\/([\w-]+)\/context$/, (q, b, a, id) => { const c = a.s.getContext(id, { actor: a.actor }); return { ...c, lessons: dreams.lessonsFor(a.s, c.task, { agent: a.actor }) }; }],
    ['POST', /^\/api\/tasks\/([\w-]+)\/questions$/, (q, b, a, id) => a.s.askQuestion(id, { ...b, to: b.to || 'anyone', actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/answers$/, (q, b, a, id) => a.s.answerQuestion(id, { ...b, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/split$/, (q, b, a, id) => a.s.splitTask(id, { ...b, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/resolve$/, (q, b, a, id) => a.s.resolveEscalation(id, { ...b, actor: a.actor })],
    ['POST', /^\/api\/lead$/, (q, b, a) => a.s.takeLead({ ...b, actor: a.actor })],
    ['PATCH', /^\/api\/mode$/, (q, b, a) => a.s.setMode({ ...b, actor: a.actor })],
    ['PUT', /^\/api\/goal$/, (q, b, a) => a.s.setGoal({ ...b, actor: a.actor })],
    ['GET', /^\/api\/dreams$/, (q, b, a) => ({ settings: dreams.settingsOf(a.s), lastDreamAt: a.s.getSettings().lastDreamAt || null, dreams: dreams.listDreams(a.s, { limit: Number(q.get('limit')) || 10 }) })],
    ['POST', /^\/api\/dreams$/, (q, b, a) => dreams.dream(a.s)],
    ['GET', /^\/api\/dreams\/digest$/, (q, b, a) => dreams.digest(a.s, { since: q.has('since') ? Number(q.get('since')) : undefined })],
    ['POST', /^\/api\/dreams\/submit$/, (q, b, a) => dreams.recordDream(a.s, { actor: a.actor, summary: b.summary, proposals: b.proposals })],
    ['PATCH', /^\/api\/dreams\/settings$/, (q, b, a) => dreams.setDreamSettings(a.s, b, a.actor)],
    ['GET', /^\/api\/dreams\/prompt$/, () => ({ prompt: dreams.CLAUDE_DREAMER })],
    ['POST', /^\/api\/dreams\/proposals\/([\w-]+)\/apply$/, (q, b, a, id) => dreams.applyProposal(a.s, id, { actor: a.actor })],
    ['POST', /^\/api\/dreams\/proposals\/([\w-]+)\/dismiss$/, (q, b, a, id) => dreams.dismissProposal(a.s, id, { actor: a.actor, reason: b.reason })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/handoff$/, (q, b, a, id) => a.s.handoff(id, { ...b, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/progress$/, (q, b, a, id) => a.s.reportProgress(id, { ...b, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/criteria$/, (q, b, a, id) => a.s.setCriterion(id, { ...b, criterion: String(b.criterion), actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/submit$/, (q, b, a, id) => checks.submit(a.s, id, { ...b, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/worktree$/, (q, b, a, id) => gitx.createWorktree(a.s, id, { actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/scope$/, (q, b, a, id) => gitx.checkScope(a.s, id, { actor: a.actor, dir: b.dir })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/checks$/, (q, b, a, id) => checks.startChecks(a.s, id, { actor: a.actor })],
    ['GET', /^\/api\/radar$/, (q, b, a) => gitx.radar(a.s)],
    ['GET', /^\/api\/code$/, (q, b, a) => ({ repo: a.s.getSettings().repo || null, ...checks.settingsOf(a.s) })],
    ['PUT', /^\/api\/code\/repo$/, (q, b, a) => gitx.setRepo(a.s, { ...b, actor: a.actor })],
    ['PUT', /^\/api\/code\/checks$/, (q, b, a) => checks.setChecks(a.s, { ...b, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/review$/, (q, b, a, id) => a.s.reviewTask(id, { ...b, actor: a.actor })],
    ['POST', /^\/api\/tasks\/([\w-]+)\/comments$/, (q, b, a, id) => a.s.comment(id, { ...b, actor: a.actor })],
    ['GET', /^\/api\/notes$/, (q, b, a) => a.s.listNotes({ query: q.get('q') || undefined })],
    ['POST', /^\/api\/notes$/, (q, b, a) => a.s.addNote({ ...b, actor: a.actor })],
    ['GET', /^\/api\/claims$/, (q, b, a) => a.s.fileClaims()],
    ['GET', /^\/api\/agents$/, (q, b, a) => a.s.listAgents()],
    ['POST', /^\/api\/agents$/, (q, b, a) => a.s.registerAgent({ ...b, actor: a.actor })],
    ['POST', /^\/api\/heartbeat$/, (q, b, a) => a.s.heartbeat({ ...b, actor: a.actor })],
    ['GET', /^\/api\/stats$/, (q, b, a) => a.s.stats()],
    ['GET', /^\/api\/events$/, (q, b, a) => a.s.events({ since: Number(q.get('since')) || 0, limit: Number(q.get('limit')) || 100 })],
    ['GET', /^\/api\/workspaces$/, () => Store.listWorkspaces(dataDir)],
    ['GET', /^\/api\/activity$/, (q, b, a) => a.s.activity({ limit: Number(q.get('limit')) || 50 })],
    ['GET', /^\/api\/workboard$/, (q, b, a) => {
      const dir = a.s.getSettings().workboardDir || null;
      return { dir, linked: watchers.has(a.s.workspace), instructions: dir ? workboard.agentInstructions(dir) : null };
    }],
    ['POST', /^\/api\/workboard$/, (q, b, a) => {
      if (typeof b.dir !== 'string' || !path.isAbsolute(b.dir)) throw Object.assign(new Error('dir must be an absolute folder path'), { code: 'INVALID' });
      const dir = path.resolve(b.dir);
      fs.mkdirSync(dir, { recursive: true });
      a.s.setSettings({ workboardDir: dir, workboardResults: [] }, a.actor);
      workboard.syncOnce(a.s, dir);
      link(a.s, dir);
      return { dir, linked: true, instructions: workboard.agentInstructions(dir) };
    }],
    ['DELETE', /^\/api\/workboard$/, (q, b, a) => { a.s.setSettings({ workboardDir: null }, a.actor); link(a.s, null); return { linked: false }; }],
  ];

  // Server-sent events: one "change" message whenever the workspace file changes.
  function stream(req, res, s) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
    let last = -1;
    const check = () => {
      let m = 0;
      try { m = fs.statSync(s.file).mtimeMs; } catch { /* not created yet */ }
      if (m !== last) { last = m; res.write(`event: change\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`); }
    };
    check();
    const poll = setInterval(check, 500);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(poll); clearInterval(ping); });
  }

  const server = http.createServer((req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'" });
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
      let s;
      try { s = pick(url.searchParams); } catch (err) { return send(400, { error: err.message }); }
      const header = req.headers['x-agenthaven-agent'];
      if (header !== undefined && !AGENT_RE.test(header)) return send(400, { error: 'X-AgentHaven-Agent may use letters, digits, . _ - @' });
      const ctx = { s, actor: header || human };
      if (url.pathname === '/api/stream' && req.method === 'GET') return stream(req, res, s);
      for (const [method, re, fn] of routes) {
        const m = url.pathname.match(re);
        if (!m || method !== req.method) continue;
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
        req.on('end', () => {
          try {
            if (!['GET', 'DELETE'].includes(req.method) && raw && !String(req.headers['content-type']).startsWith('application/json')) return send(415, { error: 'use application/json' });
            const body = raw ? JSON.parse(raw) : {};
            if (typeof body !== 'object' || body === null || Array.isArray(body)) return send(400, { error: 'body must be a JSON object' });
            send(req.method === 'POST' ? 201 : 200, fn(url.searchParams, body, ctx, m[1]));
          } catch (err) {
            const status = STATUS[err.code] || (err instanceof SyntaxError ? 400 : 500);
            send(status, { error: err.message, code: err.code, current: err.current });
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
  server.on('close', () => { for (const w of [...watchers.values(), ...dreamers.values()]) w.stop(); watchers.clear(); dreamers.clear(); });
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
