'use strict';
// Git awareness: parallel agents mostly collide in git, not on the board.
// Studies of agent pull requests find most merge conflicts are edits to the
// same lines of the same file, and worktrees isolate folders but do not stop
// two branches from touching the same code. AgentHaven therefore:
//
// - gives each task its own worktree and branch (`createWorktree`),
// - compares what an agent actually changed with the files its task claims
//   (`checkScope`): edits outside the claim, and edits to files another
//   active task holds, are flagged before they become conflicts,
// - looks across all active branches for files changed in more than one
//   (`radar`), so overlapping work is serialised before anyone merges.
//
// Only a human sets the repository. Git runs with argument lists, never a shell.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Store, ConflictError, ValidationError, ACTIVE, overlaps } = require('./store');

function git(cwd, args, { allowFail = false, raw = false } = {}) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    return raw ? out : out.trim();
  } catch (err) {
    if (allowFail) return null;
    throw new ValidationError(`git ${args[0]} failed: ${(err.stderr || err.message || '').toString().trim().split('\n')[0]}`);
  }
}

const lines = (s) => (s ? s.split('\n').map((l) => l.trim()).filter(Boolean) : []);

// Shell-style globs: ** spans folders, * stays inside one, ? is one character.
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matchesAny = (file, globs) => globs.some((g) => globToRe(g).test(file));

function repoOf(store) {
  const repo = store.getSettings().repo;
  if (!repo?.path) throw new ValidationError('no repository set; a human sets it in the dashboard (Code) or with "agenthaven repo <path>"');
  return repo;
}

// Human only: which repository the board works on, and its base branch.
function setRepo(store, { actor, dir, base }) {
  const data = store.read();
  if (!Store.isHuman(data, actor)) throw new ConflictError('only a human sets the repository');
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) throw new ValidationError('dir must be an absolute path to a git repository');
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  const branch = base || git(top, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { allowFail: true })?.replace(/^origin\//, '') || git(top, ['rev-parse', '--abbrev-ref', 'HEAD']);
  git(top, ['rev-parse', '--verify', `${branch}^{commit}`]);
  const repo = { path: path.resolve(top), base: branch };
  store.setSettings({ repo }, actor);
  return repo;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
}

// One worktree and branch per task, next to the repository.
function createWorktree(store, id, { actor }) {
  const repo = repoOf(store);
  const task = store.getTask(id);
  const data = store.read();
  if (task.assignee !== actor && !Store.isAuthority(data, actor)) throw new ConflictError(task.assignee ? `${task.assignee} holds this task` : 'claim the task first', task);
  if (task.worktree && fs.existsSync(task.worktree.path)) return task.worktree;
  const dir = path.join(path.dirname(repo.path), `${path.basename(repo.path)}-agenthaven`, id);
  const branch = `agenthaven/${id.slice(5)}-${slug(task.title)}`;
  const exists = git(repo.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true });
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(repo.path, exists ? ['worktree', 'add', dir, branch] : ['worktree', 'add', '-b', branch, dir, repo.base]);
  const worktree = { path: dir, branch, base: repo.base };
  store.withLock((d) => {
    const t = Store.findTask(d, id);
    t.worktree = worktree;
    Store.log(d, actor, 'task.worktree', id, `${branch} at ${dir}`);
  });
  return worktree;
}

// Files changed on a branch since it left the base, plus uncommitted and untracked ones.
function changedFiles(cwd, base) {
  const mergeBase = git(cwd, ['merge-base', base, 'HEAD'], { allowFail: true }) || base;
  const committed = lines(git(cwd, ['diff', '--name-only', mergeBase, 'HEAD']));
  // -z: NUL-separated, no quoting, and the leading status columns stay intact.
  const parts = git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { raw: true }).split('\0').filter(Boolean);
  const working = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    working.push(entry.slice(3));
    if (entry[0] === 'R' || entry[0] === 'C') i += 1; // the next part is the old path of a rename or copy
  }
  return { files: [...new Set([...committed, ...working])].sort(), uncommitted: working.length };
}

function head(cwd) {
  return git(cwd, ['rev-parse', 'HEAD']);
}

// What the agent changed versus what its task claims.
function checkScope(store, id, { actor, dir } = {}) {
  const task = store.getTask(id);
  const repo = repoOf(store);
  const cwd = dir || task.worktree?.path || repo.path;
  const base = task.worktree?.base || repo.base;
  const { files, uncommitted } = changedFiles(cwd, base);
  const outOfScope = task.files.length ? files.filter((f) => !task.files.some((c) => overlaps(f, c))) : [];
  const data = store.fresh();
  const foreign = [];
  for (const other of data.tasks) {
    if (other.id === id || !ACTIVE.includes(other.status) || !other.assignee || other.assignee === task.assignee) continue;
    const hit = files.filter((f) => other.files.some((c) => overlaps(f, c)));
    if (hit.length) foreign.push({ task: other.id, title: other.title, agent: other.assignee, files: hit });
  }
  const scope = { at: new Date().toISOString(), head: head(cwd), changed: files, uncommitted, outOfScope, foreign, ok: !outOfScope.length && !foreign.length };
  store.withLock((d) => {
    const t = Store.findTask(d, id);
    t.scope = scope;
    if (!scope.ok) {
      const parts = [];
      if (outOfScope.length) parts.push(`${outOfScope.length} file(s) outside the task's files: ${outOfScope.slice(0, 8).join(', ')}`);
      for (const f of foreign) parts.push(`${f.files.join(', ')} belong(s) to ${f.agent} ("${f.title}")`);
      Store.log(d, actor || 'agenthaven', 'task.scope_warning', id, parts.join('; '));
      if (t.assignee) Store.message(d, { from: 'agenthaven', to: t.assignee, body: `Scope check on "${t.title}": ${parts.join('; ')}. Add the files to the task if they belong to it, or undo the changes.`, task: id, kind: 'scope' });
      for (const f of foreign) Store.message(d, { from: 'agenthaven', to: f.agent, body: `${t.assignee || 'someone'} changed ${f.files.join(', ')} in "${t.title}", which your task "${f.title}" holds. Talk before either of you merges.`, task: f.task, kind: 'scope' });
    }
  });
  return scope;
}

// Files changed on more than one active branch: the merge conflicts of tomorrow.
function radar(store) {
  const repo = repoOf(store);
  const tasks = store.listTasks({ full: true }).filter((t) => t.worktree && t.status !== 'done' && fs.existsSync(t.worktree.path));
  const changes = tasks.map((t) => {
    try { return { task: t, files: changedFiles(t.worktree.path, t.worktree.base || repo.base).files }; } catch { return { task: t, files: [] }; }
  });
  const conflicts = [];
  for (let i = 0; i < changes.length; i++) {
    for (let j = i + 1; j < changes.length; j++) {
      const shared = changes[i].files.filter((f) => changes[j].files.includes(f));
      if (shared.length) conflicts.push({ files: shared, a: { id: changes[i].task.id, title: changes[i].task.title, agent: changes[i].task.assignee }, b: { id: changes[j].task.id, title: changes[j].task.title, agent: changes[j].task.assignee } });
    }
  }
  return { at: new Date().toISOString(), branches: changes.map((c) => ({ id: c.task.id, title: c.task.title, agent: c.task.assignee, branch: c.task.worktree.branch, changed: c.files.length })), conflicts,
    advice: conflicts.length ? 'Serialise the overlapping tasks: let one merge first, then rebase the other, or make one depend on the other.' : 'No overlapping changes between active branches.' };
}

module.exports = { git, setRepo, createWorktree, changedFiles, checkScope, radar, head, globToRe, matchesAny };
