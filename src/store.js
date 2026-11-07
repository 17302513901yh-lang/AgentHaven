'use strict';
// AgentHaven workspace store: one JSON file per workspace, atomic writes,
// optimistic concurrency (version numbers) and an append-only activity log.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done'];

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

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();

class Store {
  constructor({ dataDir = defaultDataDir(), workspace = 'default' } = {}) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(workspace)) throw new ValidationError('invalid workspace name');
    this.dataDir = dataDir;
    this.file = path.join(dataDir, `${workspace}.json`);
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Always re-read from disk so several processes (desktop app, MCP plugins
  // of different agents) can share one workspace file safely.
  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      data.tasks ||= []; data.notes ||= []; data.log ||= [];
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') return { schema: 1, tasks: [], notes: [], log: [] };
      throw err;
    }
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
      const result = fn(data);
      this.write(data);
      return result;
    } finally {
      fs.rmdirSync(lock);
    }
  }

  static log(data, actor, action, ref, detail) {
    data.log.push({ id: newId('evt'), at: now(), actor, action, ref, detail });
    if (data.log.length > 5000) data.log.splice(0, data.log.length - 5000);
  }

  listTasks({ status, assignee } = {}) {
    return this.read().tasks.filter((t) => (!status || t.status === status) && (!assignee || t.assignee === assignee));
  }

  getTask(id) {
    const task = this.read().tasks.find((t) => t.id === id);
    if (!task) throw new ValidationError(`task ${id} not found`);
    return task;
  }

  createTask({ title, description, files, actor }) {
    actor = requireText(actor, 'actor', 100);
    const task = {
      id: newId('task'),
      title: requireText(title, 'title', 200),
      description: optionalText(description, 'description') || '',
      status: 'todo',
      assignee: null,
      files: Array.isArray(files) ? files.map(String).slice(0, 100) : [],
      createdBy: actor,
      createdAt: now(),
      updatedAt: now(),
      version: 1,
    };
    return this.withLock((data) => {
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
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new ValidationError(`task ${id} not found`);
      if (task.version !== version) {
        throw new ConflictError(`task was changed by ${task.lastActor || task.createdBy} (version ${task.version}); re-read and retry`, task);
      }
      const applied = {};
      if (changes.title !== undefined) applied.title = requireText(changes.title, 'title', 200);
      if (changes.description !== undefined) applied.description = optionalText(changes.description, 'description');
      if (changes.status !== undefined) {
        if (!STATUSES.includes(changes.status)) throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`);
        applied.status = changes.status;
      }
      if (changes.assignee !== undefined) applied.assignee = changes.assignee === null ? null : requireText(changes.assignee, 'assignee', 100);
      if (changes.files !== undefined) applied.files = Array.isArray(changes.files) ? changes.files.map(String).slice(0, 100) : [];
      if (!Object.keys(applied).length) throw new ValidationError('nothing to update');
      Object.assign(task, applied, { updatedAt: now(), lastActor: actor, version: task.version + 1 });
      Store.log(data, actor, 'task.updated', id, applied);
      return task;
    });
  }

  claimTask(id, { actor }) {
    actor = requireText(actor, 'actor', 100);
    return this.withLock((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new ValidationError(`task ${id} not found`);
      if (task.assignee && task.assignee !== actor) throw new ConflictError(`task is already claimed by ${task.assignee}`, task);
      Object.assign(task, { assignee: actor, status: task.status === 'todo' ? 'doing' : task.status, updatedAt: now(), lastActor: actor, version: task.version + 1 });
      Store.log(data, actor, 'task.claimed', id);
      return task;
    });
  }

  handoff(id, { actor, to, summary, nextSteps }) {
    actor = requireText(actor, 'actor', 100);
    summary = requireText(summary, 'summary');
    const target = to ? requireText(to, 'to', 100) : null;
    return this.withLock((data) => {
      const task = data.tasks.find((t) => t.id === id);
      if (!task) throw new ValidationError(`task ${id} not found`);
      if (task.assignee && task.assignee !== actor) throw new ConflictError(`only ${task.assignee} can hand off this task`, task);
      const entry = { at: now(), from: actor, to: target, summary, nextSteps: optionalText(nextSteps, 'nextSteps') || '' };
      task.handoffs = [...(task.handoffs || []), entry];
      Object.assign(task, { assignee: target, status: target ? 'doing' : 'todo', updatedAt: now(), lastActor: actor, version: task.version + 1 });
      Store.log(data, actor, 'task.handoff', id, { to: target, summary });
      return task;
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
      Store.log(data, actor, 'note.added', note.id, note.title);
      return note;
    });
  }

  activity({ limit = 50 } = {}) {
    return this.read().log.slice(-Math.min(Math.max(1, limit), 500)).reverse();
  }
}

module.exports = { Store, ConflictError, ValidationError, STATUSES, defaultDataDir };
