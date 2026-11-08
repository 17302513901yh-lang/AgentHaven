'use strict';
// AgentHaven workspace store: one JSON file per workspace, atomic writes,
// optimistic concurrency (version numbers) and an append-only activity log.
//
// The board is built for many agents from different vendors at once:
// - leases: a claimed task returns to the board when its agent goes quiet,
// - dependencies, priorities and skills decide what `nextTask` hands out,
// - acceptance criteria and review by someone else gate "done",
// - progress, usage (tokens, cost), metrics and budgets per task,
// - an agent registry with presence, comments, and a cursor-based event feed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done'];
const ACTIVE = ['doing', 'blocked', 'review'];
const AGENT_KINDS = ['llm', 'human', 'neural-network', 'script', 'other'];
const WORKSPACE_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const SCHEMA = 2;
const LIMITS = { files: 100, deps: 50, skills: 20, criteria: 50, comments: 300, metricKeys: 20, metricPoints: 500, log: 5000 };

const minutes = (env, fallback) => {
  const n = Number(env);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const LEASE_MS = minutes(process.env.AGENTHAVEN_LEASE_MINUTES, 30) * 60000;
const ONLINE_MS = 2 * 60000;
const IDLE_MS = 15 * 60000;

// Paths are compared in one normal form: forward slashes, no `./`, `//` or `a/../`.
const normFile = (f) => {
  const s = String(f).trim().replace(/\\/g, '/');
  if (!s) return '';
  const n = path.posix.normalize(s).replace(/^\.\/+/, '').replace(/\/+$/, '');
  return n === '.' ? '' : n;
};
const normFiles = (files) => (Array.isArray(files) ? [...new Set(files.map(normFile).filter(Boolean))].slice(0, LIMITS.files) : []);
// Paths overlap when equal or when one is a directory prefix of the other.
const overlaps = (a, b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
const normWords = (list, max) => (Array.isArray(list) ? [...new Set(list.map((s) => String(s).trim().toLowerCase()).filter(Boolean))].slice(0, max) : []);

class ConflictError extends Error {
  constructor(message, current) {
    super(message);
    this.name = 'ConflictError';
    this.code = 'CONFLICT';
    this.current = current;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.code = 'INVALID';
  }
}

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
    this.code = 'NOT_FOUND';
  }
}

function defaultDataDir() {
  if (process.env.AGENTHAVEN_HOME) return process.env.AGENTHAVEN_HOME;
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'AgentHaven');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'AgentHaven');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'agenthaven');
}

function requireText(value, field, max = 10000) {
  if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`);
  if (value.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return value.trim();
}

function optionalText(value, field, max = 10000) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  if (value.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return value;
}

function priorityOf(value) {
  if (value === undefined || value === null) return 2;
  const p = typeof value === 'string' ? Number(value.replace(/^p/i, '')) : value;
  if (!Number.isInteger(p) || p < 0 || p > 3) throw new ValidationError('priority must be 0 (urgent) to 3 (low)');
  return p;
}

function nonNegative(value, field) {
  if (value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new ValidationError(`${field} must be a number ≥ 0`);
  return value;
}

function budgetOf(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'object') throw new ValidationError('budget must be an object like {"costUsd": 5, "tokens": 2000000}');
  const b = {};
  if (value.costUsd !== undefined) b.costUsd = nonNegative(value.costUsd, 'budget.costUsd');
  if (value.tokens !== undefined) b.tokens = nonNegative(value.tokens, 'budget.tokens');
  return Object.keys(b).length ? b : null;
}

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();

function criteriaFrom(list, previous = []) {
  if (!Array.isArray(list)) throw new ValidationError('criteria must be a list of text');
  return list.slice(0, LIMITS.criteria).map((item) => {
    const text = requireText(typeof item === 'string' ? item : item?.text, 'criterion', 500);
    const old = previous.find((c) => c.text === text);
    return old || { id: newId('c'), text, done: false };
  });
}

// Fills in fields added after schema 1, so old workspace files keep working.
function upgradeTask(t) {
  t.priority ??= 2;
  t.files ||= [];
  t.dependsOn ||= [];
  t.skills ||= [];
  t.criteria ||= [];
  t.review ??= false;
  t.progress ??= null;
  t.usage ||= { tokens: 0, costUsd: 0 };
  t.budget ??= null;
  t.metrics ||= {};
  t.comments ||= [];
  t.handoffs ||= [];
  t.leaseUntil ??= null;
  t.blockedReason ??= null;
  return t;
}

class Store {
  constructor({ dataDir = defaultDataDir(), workspace = 'default', leaseMs = LEASE_MS } = {}) {
    if (!WORKSPACE_RE.test(workspace)) throw new ValidationError('invalid workspace name');
    this.dataDir = dataDir;
    this.workspace = workspace;
    this.leaseMs = leaseMs;
    this.file = path.join(dataDir, `${workspace}.json`);
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Always re-read from disk so several processes (desktop app, MCP plugins
  // of different agents, the workboard sync) can share one workspace file.
  read() {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      data = {};
    }
    data.schema = SCHEMA;
    data.tasks ||= []; data.notes ||= []; data.log ||= []; data.agents ||= {}; data.settings ||= {};
    data.seq ??= data.log.length;
    data.log.forEach((e, i) => { e.seq ??= i + 1; });
    data.tasks.forEach(upgradeTask);
    return data;
  }

  write(data) {
    const tmp = `${this.file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  withLock(fn) {
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + 5000;
    for (;;) {
      try { fs.mkdirSync(lock); break; } catch (err) {
        if (err.code !== 'EEXIST') throw err;
        try { // stale lock (crashed process)
          if (Date.now() - fs.statSync(lock).mtimeMs > 10000) { fs.rmdirSync(lock); continue; }
        } catch { /* lock vanished, retry */ }
        if (Date.now() > deadline) throw new Error('workspace is busy, try again');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
      }
    }
    try {
      const data = this.read();
      this.reap(data);
      const result = fn(data);
      this.write(data);
      return result;
    } finally {
      fs.rmdirSync(lock);
    }
  }

  static log(data, actor, action, ref, detail) {
    data.seq += 1;
    data.log.push({ id: newId('evt'), seq: data.seq, at: now(), actor, action, ref, detail });
    if (data.log.length > LIMITS.log) data.log.splice(0, data.log.length - LIMITS.log);
  }

  // ---- presence and leases ------------------------------------------------

  static seen(data, actor) {
    const agent = data.agents[actor] ||= { name: actor, kind: actor === 'you' ? 'human' : 'llm', firstSeen: now() };
    agent.lastSeen = now();
    return agent;
  }

  lease(task) {
    task.leaseUntil = task.status === 'doing' && task.assignee ? new Date(Date.now() + this.leaseMs).toISOString() : null;
  }

  // Returns tasks whose agent went quiet past the lease to the board.
  reap(data) {
    const t0 = Date.now();
    for (const task of data.tasks) {
      if (task.status !== 'doing' || !task.assignee || !task.leaseUntil || Date.parse(task.leaseUntil) > t0) continue;
      const from = task.assignee;
      task.handoffs.push({ at: now(), from, to: null, summary: `Lease expired: no sign of life from ${from} for ${Math.round(this.leaseMs / 60000)} min. Back on the board.`, nextSteps: '', auto: true });
      Object.assign(task, { assignee: null, status: 'todo', leaseUntil: null, updatedAt: now(), lastActor: 'agenthaven', version: task.version + 1 });
      Store.log(data, 'agenthaven', 'task.lease_expired', task.id, { from });
    }
  }

  hasExpired(data) {
    const t0 = Date.now();
    return data.tasks.some((t) => t.status === 'doing' && t.assignee && t.leaseUntil && Date.parse(t.leaseUntil) <= t0);
  }

  // Fresh state with expired leases released (takes the lock only when needed).
  fresh() {
    const data = this.read();
    if (!this.hasExpired(data)) return data;
    this.withLock(() => {});
    return this.read();
  }

  // Marks an agent as alive and renews the leases of the tasks it is doing.
  heartbeat({ actor, status } = {}) {
    actor = requireText(actor, 'actor', 100);
    return this.withLock((data) => {
      const agent = Store.seen(data, actor);
      if (status !== undefined) agent.status = optionalText(status, 'status', 300) || '';
      const renewed = [];
      for (const t of data.tasks) if (t.assignee === actor && t.status === 'doing') { this.lease(t); renewed.push({ id: t.id, leaseUntil: t.leaseUntil }); }
      return { agent: actor, renewed };
    });
  }

  // ---- agents ---------------------------------------------------------------

  registerAgent({ actor, kind, vendor, model, skills, description }) {
    actor = requireText(actor, 'actor', 100);
    if (kind !== undefined && !AGENT_KINDS.includes(kind)) throw new ValidationError(`kind must be one of ${AGENT_KINDS.join(', ')}`);
    return this.withLock((data) => {
      const isNew = !data.agents[actor];
      const agent = Store.seen(data, actor);
      if (kind !== undefined) agent.kind = kind;
      if (vendor !== undefined) agent.vendor = optionalText(vendor, 'vendor', 100);
      if (model !== undefined) agent.model = optionalText(model, 'model', 100);
      if (description !== undefined) agent.description = optionalText(description, 'description', 500);
      if (skills !== undefined) agent.skills = normWords(skills, LIMITS.skills);
      if (isNew) Store.log(data, actor, 'agent.joined', actor, { kind: agent.kind, vendor: agent.vendor, model: agent.model });
      return agent;
    });
  }

  listAgents() {
    const data = this.fresh();
    const t0 = Date.now();
    return Object.values(data.agents).map((a) => {
      const age = t0 - Date.parse(a.lastSeen || 0);
      const doing = data.tasks.filter((t) => t.assignee === a.name && ACTIVE.includes(t.status)).map((t) => ({ id: t.id, title: t.title, status: t.status }));
      return { ...a, skills: a.skills || [], presence: age < ONLINE_MS ? 'online' : age < IDLE_MS ? 'idle' : 'offline', tasks: doing };
    }).sort((a, b) => Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0));
  }

  // ---- tasks ----------------------------------------------------------------

  static findTask(data, id) {
    const task = data.tasks.find((t) => t.id === id);
    if (!task) throw new NotFoundError(`task ${id} not found`);
    return task;
  }

  static depsOpen(data, task) {
    return task.dependsOn.map((id) => data.tasks.find((t) => t.id === id)).filter((d) => d && d.status !== 'done');
  }

  static checkDeps(data, id, deps) {
    if (!Array.isArray(deps)) throw new ValidationError('dependsOn must be a list of task ids');
    const list = [...new Set(deps.map(String))].slice(0, LIMITS.deps);
    for (const d of list) {
      if (d === id) throw new ValidationError('a task cannot depend on itself');
      if (!data.tasks.some((t) => t.id === d)) throw new ValidationError(`dependency ${d} not found`);
    }
    // Reject cycles: walk from each dependency and make sure we never reach `id`.
    const seen = new Set();
    const walk = (tid) => {
      if (tid === id) throw new ValidationError('dependencies would form a cycle');
      if (seen.has(tid)) return;
      seen.add(tid);
      for (const next of data.tasks.find((t) => t.id === tid)?.dependsOn || []) walk(next);
    };
    list.forEach(walk);
    return list;
  }

  // Throws when another agent is actively working on any of these files.
  static assertFilesFree(data, taskId, actor, files) {
    for (const other of data.tasks) {
      if (other.id === taskId || !ACTIVE.includes(other.status) || !other.assignee || other.assignee === actor) continue;
      const hit = files.find((f) => other.files.some((g) => overlaps(f, g)));
      if (hit) throw new ConflictError(`${hit} is being worked on by ${other.assignee} in "${other.title}" (${other.id})`, other);
    }
  }

  static isHuman(data, actor) {
    return actor === 'you' || data.agents[actor]?.kind === 'human';
  }

  // Done means: criteria met, and reviewed by someone else when the task asks for review.
  // A human may close any task; an agent only its own (or an unclaimed) task without review.
  static assertCanFinish(data, task, actor) {
    const open = task.criteria.filter((c) => !c.done);
    if (open.length) throw new ConflictError(`${open.length} acceptance criteria still open: ${open.map((c) => c.text).join('; ')}`, task);
    if (Store.isHuman(data, actor)) return;
    if (task.review) throw new ConflictError('this task needs review by someone else: use submit_for_review, then another agent or a human approves', task);
  }

  // A compact view for lists: no comment threads or metric series.
  static summary(task) {
    const { comments, metrics, handoffs, ...rest } = task;
    const last = {};
    for (const [k, pts] of Object.entries(metrics)) if (pts.length) last[k] = pts[pts.length - 1].v;
    return { ...rest, metrics: last, comments: comments.length, lastHandoff: handoffs[handoffs.length - 1] || null };
  }

  listTasks({ status, assignee, full = false } = {}) {
    const data = this.fresh();
    return data.tasks
      .filter((t) => (!status || t.status === status) && (!assignee || t.assignee === assignee))
      .map((t) => (full ? t : { ...Store.summary(t), waitingOn: Store.depsOpen(data, t).map((d) => d.id) }));
  }

  getTask(id) {
    const data = this.fresh();
    const task = Store.findTask(data, id);
    return { ...task, waitingOn: Store.depsOpen(data, task).map((d) => ({ id: d.id, title: d.title, status: d.status })) };
  }

  createTask({ title, description, files, dependsOn, priority, skills, criteria, review, budget, actor }) {
    actor = requireText(actor, 'actor', 100);
    return this.withLock((data) => {
      const id = newId('task');
      const task = upgradeTask({
        id,
        title: requireText(title, 'title', 200),
        description: optionalText(description, 'description') || '',
        status: 'todo',
        priority: priorityOf(priority),
        assignee: null,
        files: normFiles(files),
        dependsOn: dependsOn === undefined ? [] : Store.checkDeps(data, id, dependsOn),
        skills: normWords(skills, LIMITS.skills),
        criteria: criteria === undefined ? [] : criteriaFrom(criteria),
        review: Boolean(review),
        budget: budgetOf(budget) || null,
        createdBy: actor,
        createdAt: now(),
        updatedAt: now(),
        version: 1,
      });
      Store.seen(data, actor);
      data.tasks.push(task);
      Store.log(data, actor, 'task.created', task.id, task.title);
      return task;
    });
  }

  // `version` is required: an agent must prove it saw the latest state, so
  // concurrent edits never silently overwrite each other.
  updateTask(id, { version, actor, ...changes }) {
    actor = requireText(actor, 'actor', 100);
    if (!Number.isInteger(version)) throw new ValidationError('version is required (read the task first)');
    return this.withLock((data) => {
      const task = Store.findTask(data, id);
      if (task.version !== version) {
        throw new ConflictError(`task was changed by ${task.lastActor || task.createdBy} (version ${task.version}); re-read and retry`, task);
      }
      if (task.assignee && task.assignee !== actor && !Store.isHuman(data, actor)) {
        throw new ConflictError(`${task.assignee} holds this task; comment on it or ask them to hand it off`, task);
      }
      const applied = {};
      if (changes.title !== undefined) applied.title = requireText(changes.title, 'title', 200);
      if (changes.description !== undefined) applied.description = optionalText(changes.description, 'description');
      if (changes.status !== undefined) {
        if (!STATUSES.includes(changes.status)) throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`);
        applied.status = changes.status;
      }
      if (changes.assignee !== undefined) applied.assignee = changes.assignee === null || changes.assignee === '' ? null : requireText(changes.assignee, 'assignee', 100);
      if (changes.files !== undefined) applied.files = normFiles(changes.files);
      if (changes.priority !== undefined) applied.priority = priorityOf(changes.priority);
      if (changes.dependsOn !== undefined) applied.dependsOn = Store.checkDeps(data, id, changes.dependsOn);
      if (changes.skills !== undefined) applied.skills = normWords(changes.skills, LIMITS.skills);
      if (changes.criteria !== undefined) applied.criteria = criteriaFrom(changes.criteria, task.criteria);
      if (changes.review !== undefined) applied.review = Boolean(changes.review);
      if (changes.budget !== undefined) applied.budget = budgetOf(changes.budget);
      if (changes.blockedReason !== undefined) applied.blockedReason = optionalText(changes.blockedReason, 'blockedReason', 500) || null;
      if (!Object.keys(applied).length) throw new ValidationError('nothing to update');
      const next = { ...task, ...applied };
      if (applied.status === 'done' && task.status !== 'done') Store.assertCanFinish(data, task, actor);
      if (ACTIVE.includes(next.status) && next.assignee) {
        if (next.status === 'doing' && Store.depsOpen(data, next).length) throw new ConflictError(`waiting on ${Store.depsOpen(data, next).map((d) => `"${d.title}"`).join(', ')}`, task);
        Store.assertFilesFree(data, id, next.assignee, next.files);
      }
      if (next.status !== 'blocked') applied.blockedReason = null;
      Object.assign(task, applied, { updatedAt: now(), lastActor: actor, version: task.version + 1 });
      if (task.status === 'done') { task.leaseUntil = null; task.progress = 100; } else this.lease(task);
      Store.seen(data, actor);
      Store.log(data, actor, applied.status === 'done' ? 'task.done' : 'task.updated', id, applied);
      return task;
    });
  }

  static claimInLock(store, data, task, actor) {
    if (task.status === 'done') throw new ConflictError('task is already done', task);
    if (task.assignee && task.assignee !== actor) throw new ConflictError(`task is already claimed by ${task.assignee}`, task);
    const open = Store.depsOpen(data, task);
    if (open.length) throw new ConflictError(`waiting on ${open.map((d) => `"${d.title}" (${d.id}, ${d.status})`).join(', ')}`, task);
    Store.assertFilesFree(data, task.id, actor, task.files);
    Object.assign(task, { assignee: actor, status: ['todo', 'blocked'].includes(task.status) ? 'doing' : task.status, blockedReason: null, updatedAt: now(), lastActor: actor, version: task.version + 1 });
    store.lease(task);
    Store.seen(data, actor);
    Store.log(data, actor, 'task.claimed', task.id, task.title);
    return task;
  }

  claimTask(id, { actor }) {
    actor = requireText(actor, 'actor', 100);
    return this.withLock((data) => Store.claimInLock(this, data, Store.findTask(data, id), actor));
  }

  // Why a task cannot be picked up by `actor` right now, or null when it can.
  static blocker(data, task, actor, skills) {
    if (task.status !== 'todo' || task.assignee) return 'not open';
    const open = Store.depsOpen(data, task);
    if (open.length) return `waits on ${open.length} task(s)`;
    if (task.skills.some((s) => !skills.includes(s))) return `needs skills ${task.skills.join(', ')}`;
    try { Store.assertFilesFree(data, task.id, actor, task.files); } catch (err) { return err.message; }
    return null;
  }

  // Pull model: hands the agent the most important task it can start now.
  nextTask({ actor, claim = false, skills }) {
    actor = requireText(actor, 'actor', 100);
    const pick = (data) => {
      const own = skills !== undefined ? normWords(skills, LIMITS.skills) : data.agents[actor]?.skills || [];
      const mine = data.tasks.find((t) => t.assignee === actor && t.status === 'doing');
      const open = data.tasks.filter((t) => t.status === 'todo' && !t.assignee)
        .sort((a, b) => a.priority - b.priority || Date.parse(a.createdAt) - Date.parse(b.createdAt));
      const reasons = [];
      for (const t of open) {
        const why = Store.blocker(data, t, actor, own);
        if (!why) return { task: t, alreadyDoing: mine ? mine.id : null, skipped: reasons.slice(0, 20) };
        reasons.push(`${t.id}: ${why}`);
      }
      const reviewable = data.tasks.filter((t) => t.status === 'review' && t.assignee !== actor).map((t) => ({ id: t.id, title: t.title, by: t.assignee }));
      return { task: null, alreadyDoing: mine ? mine.id : null, skipped: reasons.slice(0, 20), reviewable,
        hint: open.length ? 'No open task fits right now (see skipped).' : 'The board has no open tasks. Review work in "reviewable" or create the next task.' };
    };
    if (!claim) return pick(this.fresh());
    return this.withLock((data) => {
      const res = pick(data);
      if (res.task) res.task = Store.claimInLock(this, data, res.task, actor);
      return res;
    });
  }

  handoff(id, { actor, to, summary, nextSteps }) {
    actor = requireText(actor, 'actor', 100);
    summary = requireText(summary, 'summary');
    const target = to ? requireText(to, 'to', 100) : null;
    return this.withLock((data) => {
      const task = Store.findTask(data, id);
      if (task.assignee && task.assignee !== actor && !Store.isHuman(data, actor)) throw new ConflictError(`only ${task.assignee} can hand off this task`, task);
      if (target) Store.assertFilesFree(data, id, target, task.files);
      const entry = { at: now(), from: actor, to: target, summary, nextSteps: optionalText(nextSteps, 'nextSteps') || '' };
      task.handoffs.push(entry);
      Object.assign(task, { assignee: target, status: target ? 'doing' : 'todo', updatedAt: now(), lastActor: actor, version: task.version + 1 });
      this.lease(task);
      Store.seen(data, actor);
      Store.log(data, actor, 'task.handoff', id, { to: target, summary });
      return task;
    });
  }

  // ---- review ---------------------------------------------------------------

  submitForReview(id, { actor, summary }) {
    actor = requireText(actor, 'actor', 100);
    summary = requireText(summary, 'summary');
    return this.withLock((data) => {
      const task = Store.findTask(data, id);
      if (task.assignee !== actor) throw new ConflictError(task.assignee ? `only ${task.assignee} can submit this task` : 'claim the task first', task);
      task.comments.push({ id: newId('cmt'), at: now(), actor, body: `Ready for review: ${summary}`, kind: 'review-request' });
      Object.assign(task, { status: 'review', leaseUntil: null, updatedAt: now(), lastActor: actor, version: task.version + 1 });
      Store.seen(data, actor);
      Store.log(data, actor, 'task.review_requested', id, summary);
      return task;
    });
  }

  reviewTask(id, { actor, approve, comment }) {
    actor = requireText(actor, 'actor', 100);
    if (typeof approve !== 'boolean') throw new ValidationError('approve must be true or false');
    if (!approve) comment = requireText(comment, 'comment (say what has to change)');
    return this.withLock((data) => {
      const task = Store.findTask(data, id);
      if (task.status !== 'review') throw new ConflictError(`task is ${task.status}, not in review`, task);
      if (task.assignee === actor) throw new ConflictError('you cannot review your own work; ask another agent or a human', task);
      if (approve) {
        const open = task.criteria.filter((c) => !c.done);
        if (open.length) throw new ConflictError(`${open.length} acceptance criteria still open: ${open.map((c) => c.text).join('; ')}`, task);
      }
      if (comment) task.comments.push({ id: newId('cmt'), at: now(), actor, body: comment, kind: approve ? 'approval' : 'changes-requested' });
      Object.assign(task, approve ? { status: 'done', reviewedBy: actor, progress: 100 } : { status: 'doing' });
      Object.assign(task, { updatedAt: now(), lastActor: actor, version: task.version + 1 });
      this.lease(task);
      Store.seen(data, actor);
      Store.log(data, actor, approve ? 'task.approved' : 'task.changes_requested', id, comment || '');
      return task;
    });
  }

  setCriterion(id, { actor, criterion, done }) {
    actor = requireText(actor, 'actor', 100);
    if (typeof done !== 'boolean') throw new ValidationError('done must be true or false');
    return this.withLock((data) => {
      const task = Store.findTask(data, id);
      const c = task.criteria.find((x, i) => x.id === criterion || String(i + 1) === String(criterion) || x.text === criterion);
      if (!c) throw new NotFoundError(`criterion ${criterion} not found (use its id, its number from 1, or its exact text)`);
      Object.assign(c, done ? { done: true, by: actor, at: now() } : { done: false, by: undefined, at: undefined });
      Object.assign(task, { updatedAt: now(), lastActor: actor, version: task.version + 1 });
      if (task.assignee === actor) this.lease(task);
      Store.seen(data, actor);
      Store.log(data, actor, done ? 'criterion.checked' : 'criterion.unchecked', id, c.text);
      return task;
    });
  }

  // ---- progress, usage, metrics, budget --------------------------------------

  reportProgress(id, { actor, progress, message, usage, metrics }) {
    actor = requireText(actor, 'actor', 100);
    if (progress !== undefined && progress !== null && (typeof progress !== 'number' || progress < 0 || progress > 100)) throw new ValidationError('progress must be 0..100');
    const add = usage === undefined ? {} : usage;
    if (typeof add !== 'object' || add === null) throw new ValidationError('usage must be an object like {"tokens": 1200, "costUsd": 0.02}');
    const tokens = nonNegative(add.tokens, 'usage.tokens');
    const cost = nonNegative(add.costUsd, 'usage.costUsd');
    if (metrics !== undefined && (typeof metrics !== 'object' || metrics === null)) throw new ValidationError('metrics must be an object like {"loss": 0.41, "accuracy": 0.87}');
    return this.withLock((data) => {
      const task = Store.findTask(data, id);
      if (task.assignee !== actor) throw new ConflictError(task.assignee ? `${task.assignee} holds this task` : 'claim the task first', task);
      if (progress !== undefined && progress !== null) task.progress = Math.round(progress * 10) / 10;
      if (message !== undefined) task.progressNote = optionalText(message, 'message', 500);
      task.usage.tokens += tokens;
      task.usage.costUsd = Math.round((task.usage.costUsd + cost) * 1e6) / 1e6;
      const at = now();
      for (const [key, value] of Object.entries(metrics || {})) {
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new ValidationError(`metric ${key} must be a number`);
        if (!/^[\w.\-/]{1,40}$/.test(key)) throw new ValidationError(`metric name ${key} is not allowed (letters, digits, . _ - /)`);
        if (!task.metrics[key] && Object.keys(task.metrics).length >= LIMITS.metricKeys) throw new ValidationError(`at most ${LIMITS.metricKeys} metrics per task`);
        const series = task.metrics[key] ||= [];
        series.push({ at, v: value });
        if (series.length > LIMITS.metricPoints) series.splice(0, series.length - LIMITS.metricPoints);
      }
      const over = Store.overBudget(task);
      Object.assign(task, { updatedAt: at, lastActor: actor, version: task.version + 1 });
      if (over && task.status !== 'blocked') {
        Object.assign(task, { status: 'blocked', blockedReason: `Budget exceeded: ${over}. A human must raise the budget or stop the task.` });
        Store.log(data, 'agenthaven', 'task.budget_exceeded', id, over);
      }
      this.lease(task);
      Store.seen(data, actor);
      Store.log(data, actor, 'task.progress', id, { progress: task.progress, message: task.progressNote });
      return { id, status: task.status, progress: task.progress, usage: task.usage, budget: task.budget, blockedReason: task.blockedReason, version: task.version, leaseUntil: task.leaseUntil };
    });
  }

  static overBudget(task) {
    const b = task.budget;
    if (!b) return null;
    if (b.costUsd !== undefined && task.usage.costUsd > b.costUsd) return `$${task.usage.costUsd.toFixed(2)} of $${b.costUsd.toFixed(2)}`;
    if (b.tokens !== undefined && task.usage.tokens > b.tokens) return `${task.usage.tokens} of ${b.tokens} tokens`;
    return null;
  }

  // ---- comments and notes ----------------------------------------------------

  comment(id, { actor, body }) {
    actor = requireText(actor, 'actor', 100);
    body = requireText(body, 'body', 5000);
    return this.withLock((data) => {
      const task = Store.findTask(data, id);
      const c = { id: newId('cmt'), at: now(), actor, body };
      task.comments.push(c);
      if (task.comments.length > LIMITS.comments) task.comments.splice(0, task.comments.length - LIMITS.comments);
      Object.assign(task, { updatedAt: now(), version: task.version + 1 });
      if (task.assignee === actor) this.lease(task);
      Store.seen(data, actor);
      Store.log(data, actor, 'task.commented', id, body.slice(0, 200));
      return c;
    });
  }

  listNotes({ query } = {}) {
    const q = query && query.toLowerCase();
    return this.read().notes.filter((n) => !q || `${n.title}\n${n.body}\n${n.tags.join(' ')}`.toLowerCase().includes(q));
  }

  addNote({ title, body, tags, actor }) {
    actor = requireText(actor, 'actor', 100);
    const note = {
      id: newId('note'),
      title: requireText(title, 'title', 200),
      body: requireText(body, 'body', 50000),
      tags: Array.isArray(tags) ? tags.map(String).slice(0, 20) : [],
      author: actor,
      createdAt: now(),
    };
    return this.withLock((data) => {
      data.notes.push(note);
      Store.seen(data, actor);
      Store.log(data, actor, 'note.added', note.id, note.title);
      return note;
    });
  }

  deleteTask(id, { version, actor }) {
    actor = requireText(actor, 'actor', 100);
    if (!Number.isInteger(version)) throw new ValidationError('version is required (read the task first)');
    return this.withLock((data) => {
      const i = data.tasks.findIndex((t) => t.id === id);
      if (i < 0) throw new NotFoundError(`task ${id} not found`);
      if (data.tasks[i].version !== version) throw new ConflictError('task was changed; re-read and retry', data.tasks[i]);
      const [task] = data.tasks.splice(i, 1);
      for (const t of data.tasks) if (t.dependsOn.includes(id)) t.dependsOn = t.dependsOn.filter((d) => d !== id);
      Store.log(data, actor, 'task.deleted', id, task.title);
      return { deleted: id };
    });
  }

  // ---- overview -----------------------------------------------------------

  // Which files are currently being worked on, and by whom.
  fileClaims() {
    return this.fresh().tasks
      .filter((t) => ACTIVE.includes(t.status) && t.assignee && t.files.length)
      .flatMap((t) => t.files.map((file) => ({ file, agent: t.assignee, task: t.id, title: t.title, status: t.status })));
  }

  stats() {
    const data = this.fresh();
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    let tokens = 0; let costUsd = 0;
    for (const t of data.tasks) { counts[t.status] += 1; tokens += t.usage.tokens; costUsd += t.usage.costUsd; }
    const t0 = Date.now();
    const online = Object.values(data.agents).filter((a) => t0 - Date.parse(a.lastSeen || 0) < ONLINE_MS).length;
    return { counts, total: data.tasks.length, usage: { tokens, costUsd: Math.round(costUsd * 100) / 100 }, agents: Object.keys(data.agents).length, online, seq: data.seq };
  }

  static listWorkspaces(dataDir = defaultDataDir()) {
    try {
      const names = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((n) => WORKSPACE_RE.test(n));
      return [...new Set(['default', ...names])].sort();
    } catch { return ['default']; }
  }

  activity({ limit = 50 } = {}) {
    return this.read().log.slice(-Math.min(Math.max(1, limit), 500)).reverse();
  }

  // Cursor-based feed: everything after `since`, oldest first.
  events({ since = 0, limit = 100 } = {}) {
    const data = this.fresh();
    const n = Math.min(Math.max(1, Number(limit) || 100), 500);
    const items = data.log.filter((e) => e.seq > Number(since || 0)).slice(0, n);
    return { events: items, cursor: items.length ? items[items.length - 1].seq : Math.max(Number(since) || 0, 0), latest: data.seq };
  }

  getSettings() { return this.read().settings; }

  setSettings(changes, actor = 'you') {
    return this.withLock((data) => {
      Object.assign(data.settings, changes);
      // Internal bookkeeping (sync cursors) is not activity worth a log line.
      if (actor !== 'agenthaven') Store.log(data, actor, 'settings.updated', this.workspace, Object.keys(changes).join(', '));
      return data.settings;
    });
  }
}

module.exports = { Store, ConflictError, ValidationError, NotFoundError, STATUSES, ACTIVE, AGENT_KINDS, defaultDataDir, overlaps, normFile };
