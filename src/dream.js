'use strict';
// Dreaming: between work sessions, look back at what happened on the board and
// turn it into lessons the next agent gets before it repeats a mistake.
//
// A dream reads a digest of everything since the last dream (reviews sent
// back, claims that expired, budgets that ran over, tasks stuck in blocked,
// handoffs, comments and the shared notes) and proposes changes:
//
//   lesson       a note tagged "lesson", scoped to files and skills; agents get
//                it with get_task, next_task and on the workboard
//   task         a follow-up task that fixes a recurring problem at its root
//   merge-notes  two or more notes that say the same thing become one
//   retire-note  a note that is wrong or no longer true goes away
//   agent-tip    advice for one agent, from its own history
//
// Proposals wait for a human unless the workspace has auto-apply on, just like
// Anthropic's dreaming for managed agents ("review before it changes memory").
// Two dreamers write proposals: the built-in one (rules over the history, no
// model, runs on a schedule) and any LLM agent, e.g. Claude, through the MCP
// tools dream_digest and submit_dream.
const crypto = require('node:crypto');
const path = require('node:path');
const { inspect, MARK } = require('./guard');
const { Store, ValidationError, NotFoundError, ConflictError, overlaps, normFile } = require('./store');

const KINDS = ['lesson', 'task', 'merge-notes', 'retire-note', 'agent-tip'];
const MAX_PROPOSALS = 30;
const KEEP_DREAMS = 50;
const STUCK_MS = 2 * 86400000;
const DEFAULTS = { autoApply: false, everyHours: 6, agentTask: false };

const newId = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;
const now = () => new Date().toISOString();
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const jaccard = (a, b) => {
  const A = words(a); const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n += 1;
  return n / (A.size + B.size - n);
};
const areaOf = (files) => {
  if (!files.length) return null;
  const dirs = files.map((f) => (f.includes('/') ? path.posix.dirname(f) : f));
  return dirs.sort((a, b) => a.length - b.length)[0];
};
const text = (v, field, max) => {
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError(`${field} is required`);
  if (v.length > max) throw new ValidationError(`${field} is too long (max ${max})`);
  return v.trim();
};

function settingsOf(store) {
  return { ...DEFAULTS, ...(store.getSettings().dream || {}) };
}

function setDreamSettings(store, changes, actor = 'you') {
  const next = { ...settingsOf(store) };
  if (changes.autoApply !== undefined) next.autoApply = Boolean(changes.autoApply);
  if (changes.agentTask !== undefined) next.agentTask = Boolean(changes.agentTask);
  if (changes.everyHours !== undefined) {
    const h = Number(changes.everyHours);
    if (!Number.isFinite(h) || h < 0 || h > 24 * 30) throw new ValidationError('everyHours must be 0 (off) to 720');
    next.everyHours = h;
  }
  store.setSettings({ dream: next }, actor);
  return next;
}

// ---- digest --------------------------------------------------------------------

// Everything a dreamer needs, since the last dream (or the whole log the first time).
function digest(store, { since } = {}) {
  const data = store.fresh();
  const from = since ?? (data.settings.dreamSeq || 0);
  const events = data.log.filter((e) => e.seq > from);
  const task = (id) => data.tasks.find((t) => t.id === id);
  const brief = (t) => (t ? { id: t.id, title: t.title, files: t.files, skills: t.skills, status: t.status, assignee: t.assignee } : null);
  const pick = (action) => events.filter((e) => e.action === action);

  const sentBack = pick('task.changes_requested').map((e) => ({ at: e.at, reviewer: e.actor, comment: e.detail, task: brief(task(e.ref)),
    author: task(e.ref)?.comments.slice().reverse().find((c) => c.kind === 'review-request')?.actor || null }));
  const expired = pick('task.lease_expired').map((e) => ({ at: e.at, agent: e.detail?.from, task: brief(task(e.ref)) }));
  const overBudget = pick('task.budget_exceeded').map((e) => ({ at: e.at, detail: e.detail, task: brief(task(e.ref)) }));
  const approved = pick('task.approved').map((e) => ({ at: e.at, reviewer: e.actor, task: brief(task(e.ref)) }));
  const handoffs = pick('task.handoff').map((e) => ({ at: e.at, from: e.actor, to: e.detail?.to, summary: e.detail?.summary, task: brief(task(e.ref)) }));
  const t0 = Date.now();
  const stuck = data.tasks.filter((t) => t.status === 'blocked' && t0 - Date.parse(t.updatedAt) > STUCK_MS)
    .map((t) => ({ ...brief(t), blockedReason: t.blockedReason, since: t.updatedAt }));
  const comments = events.filter((e) => e.action === 'task.commented').slice(-100).map((e) => ({ at: e.at, actor: e.actor, task: e.ref, text: e.detail }));
  const notes = data.notes.filter((n) => !n.quarantined).map((n) => ({ id: n.id, title: n.title, body: n.body.slice(0, 2000), tags: n.tags, author: n.author, createdAt: n.createdAt }));
  return {
    since: from, until: data.seq, events: events.length,
    sentBack, expired, overBudget, approved, handoffs, stuck, comments, notes,
    openProposals: (data.dreams || []).flatMap((d) => d.proposals.filter((p) => p.status === 'proposed').map((p) => ({ id: p.id, kind: p.kind, title: p.title }))),
    guide: 'Look for patterns, not single events: the same kind of review feedback, the same area or agent stalling, budgets that are always too low, notes that repeat or contradict each other. Propose lessons that tell the next agent what to do differently, scoped to files or skills. Propose a task only when a root cause can be fixed once. Cite evidence (task ids). Skip anything already in openProposals or in the notes.',
  };
}

// ---- built-in dreamer ------------------------------------------------------------

// Rules over the digest. Every proposal cites its evidence.
function heuristicProposals(d) {
  const out = [];
  const seen = new Set();
  const lessonExists = (title) => d.notes.some((n) => n.tags.includes('lesson') && jaccard(n.title, title) > 0.6)
    || d.openProposals.some((p) => jaccard(p.title, title) > 0.6);
  const add = (p) => {
    const key = `${p.kind}:${p.title}`;
    if (seen.has(key) || (p.kind === 'lesson' && lessonExists(p.title))) return;
    seen.add(key);
    out.push(p);
  };

  // 1. Review feedback that keeps coming back in one area.
  const byArea = new Map();
  for (const s of d.sentBack) {
    const area = areaOf(s.task?.files || []) || (s.task?.skills[0] ? `skill:${s.task.skills[0]}` : null);
    if (!area) continue;
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(s);
  }
  for (const [area, list] of byArea) {
    if (list.length < 2) continue;
    const isSkill = area.startsWith('skill:');
    const files = isSkill ? [] : [area];
    const skills = isSkill ? [area.slice(6)] : [];
    const quotes = [...new Set(list.map((s) => s.comment).filter(Boolean))].slice(0, 5);
    add({ kind: 'lesson', title: `Work in ${isSkill ? `${area.slice(6)} tasks` : area} was sent back ${list.length} times`,
      body: `Reviewers asked for changes ${list.length} times. Check these before you ask for review:\n${quotes.map((q) => `- ${q}`).join('\n')}`,
      scope: { files, skills }, evidence: list.map((s) => s.task?.id).filter(Boolean) });
  }

  // 2. Tasks that stall again and again: split them.
  const expiries = new Map();
  for (const e of d.expired) if (e.task) expiries.set(e.task.id, [...(expiries.get(e.task.id) || []), e]);
  for (const [id, list] of expiries) {
    if (list.length < 2) continue;
    const t = list[0].task;
    if (t.status === 'done') continue;
    add({ kind: 'task', title: `Split "${t.title}" into smaller tasks`,
      body: `Claims on this task expired ${list.length} times (${[...new Set(list.map((e) => e.agent))].join(', ')}). It is probably too big or unclear for one session. Break it into tasks that each fit in under 30 minutes of work, and make them depend on each other.`,
      task: { priority: 1, dependsOn: [], files: t.files, skills: t.skills }, evidence: [id] });
  }

  // 3. Agents that go quiet while holding work.
  const byAgent = new Map();
  for (const e of d.expired) if (e.agent) byAgent.set(e.agent, [...(byAgent.get(e.agent) || []), e]);
  for (const [agent, list] of byAgent) {
    if (list.length < 2) continue;
    add({ kind: 'agent-tip', agent, title: `${agent}: report progress while you work`,
      body: `Your claim expired ${list.length} times. Call report_progress or heartbeat at least every 15 minutes during long work, and hand the task off with a summary before your session ends.`,
      evidence: list.map((e) => e.task?.id).filter(Boolean) });
  }

  // 4. Budgets that run over.
  if (d.overBudget.length >= 2) {
    add({ kind: 'lesson', title: 'Budgets are set too low for this kind of work',
      body: `${d.overBudget.length} tasks ran over budget (${d.overBudget.map((b) => b.detail).filter(Boolean).join('; ')}). Estimate from finished tasks of the same kind, and report usage early so a human can adjust before the task blocks.`,
      scope: { files: [], skills: [] }, evidence: d.overBudget.map((b) => b.task?.id).filter(Boolean) });
  }

  // 5. Tasks stuck in blocked.
  for (const t of d.stuck) {
    add({ kind: 'task', title: `Unblock "${t.title}"`, body: `Blocked since ${t.since}: ${t.blockedReason || 'no reason given'}. Find who can remove the blocker, or decide to drop the task.`,
      task: { priority: 1, dependsOn: [], files: [], skills: [] }, evidence: [t.id] });
  }

  // 6. Notes that say the same thing.
  const notes = d.notes;
  const merged = new Set();
  for (let i = 0; i < notes.length; i++) {
    if (merged.has(notes[i].id)) continue;
    const group = [notes[i]];
    for (let j = i + 1; j < notes.length; j++) {
      if (!merged.has(notes[j].id) && jaccard(`${notes[i].title} ${notes[i].body}`, `${notes[j].title} ${notes[j].body}`) >= 0.7) group.push(notes[j]);
    }
    if (group.length < 2) continue;
    group.forEach((n) => merged.add(n.id));
    add({ kind: 'merge-notes', title: `Merge ${group.length} notes about "${group[0].title}"`,
      body: group.map((n) => n.body).sort((a, b) => b.length - a.length)[0], notes: group.map((n) => n.id), evidence: group.map((n) => n.id) });
  }
  return out.slice(0, MAX_PROPOSALS);
}

// ---- proposals ---------------------------------------------------------------------

function cleanProposal(p, data) {
  if (!p || typeof p !== 'object') throw new ValidationError('each proposal must be an object');
  if (!KINDS.includes(p.kind)) throw new ValidationError(`proposal kind must be one of ${KINDS.join(', ')}`);
  // Dreams write into shared memory, so they pass the same Guard as everything else.
  const g = (v, field, max) => { const r = inspect(text(v, field, max)); return { t: r.injection.length ? MARK + r.text : r.text, flags: r.injection, secrets: r.secrets }; };
  const gt = g(p.title, 'proposal title', 200);
  const gb = g(p.body, 'proposal body', 5000);
  const flags = [...gt.flags, ...gb.flags];
  const out = { id: newId('prop'), kind: p.kind, title: gt.t, body: gb.t, status: 'proposed', ...(flags.length ? { flags } : {}),
    evidence: Array.isArray(p.evidence) ? p.evidence.map(String).slice(0, 30) : [] };
  if (p.kind === 'lesson') {
    const scope = p.scope || {};
    out.scope = { files: Array.isArray(scope.files) ? scope.files.map(normFile).filter(Boolean).slice(0, 30) : [],
      skills: Array.isArray(scope.skills) ? scope.skills.map((s) => String(s).toLowerCase()).slice(0, 20) : [] };
  }
  if (p.kind === 'task') out.task = { priority: p.task?.priority ?? 2, files: p.task?.files || [], skills: p.task?.skills || [], dependsOn: p.task?.dependsOn || [] };
  if (p.kind === 'merge-notes' || p.kind === 'retire-note') {
    const ids = p.kind === 'retire-note' ? [p.note ?? p.notes?.[0]] : p.notes;
    if (!Array.isArray(ids) || !ids.length || (p.kind === 'merge-notes' && ids.length < 2)) throw new ValidationError(`${p.kind} needs ${p.kind === 'merge-notes' ? 'notes: [two or more note ids]' : 'note: <note id>'}`);
    for (const id of ids) if (!data.notes.some((n) => n.id === id)) throw new ValidationError(`note ${id} not found`);
    out.notes = ids.map(String);
  }
  if (p.kind === 'agent-tip') out.agent = text(p.agent, 'agent', 100);
  return out;
}

// Stores a dream; with auto-apply on, applies its proposals right away.
function recordDream(store, { actor, summary, proposals, since, until }) {
  actor = text(actor, 'actor', 100);
  if (!Array.isArray(proposals)) throw new ValidationError('proposals must be a list');
  const cfg = settingsOf(store);
  const dream = store.withLock((data) => {
    data.dreams ||= [];
    const d = { id: newId('dream'), at: now(), by: actor, since: since ?? (data.settings.dreamSeq || 0), until: until ?? data.seq,
      summary: typeof summary === 'string' ? summary.slice(0, 5000) : '', proposals: proposals.slice(0, MAX_PROPOSALS).map((p) => cleanProposal(p, data)) };
    data.dreams.push(d);
    if (data.dreams.length > KEEP_DREAMS) data.dreams.splice(0, data.dreams.length - KEEP_DREAMS);
    data.settings.dreamSeq = Math.max(data.settings.dreamSeq || 0, d.until);
    data.settings.lastDreamAt = d.at;
    Store.seen(data, actor);
    Store.log(data, actor, 'dream.recorded', d.id, `${d.proposals.length} proposal(s)`);
    return d;
  });
  if (cfg.autoApply) for (const p of dream.proposals.filter((x) => !x.flags)) { try { applyProposal(store, p.id, { actor: 'agenthaven' }); } catch { /* left proposed */ } }
  return listDreams(store, { limit: 1 })[0];
}

function dream(store, { actor = 'dreamer' } = {}) {
  const d = digest(store);
  const proposals = heuristicProposals(d);
  const summary = d.events ? `Looked at ${d.events} event(s): ${d.sentBack.length} sent back in review, ${d.expired.length} expired claims, ${d.overBudget.length} over budget, ${d.stuck.length} stuck, ${d.notes.length} notes. ${proposals.length} proposal(s).`
    : 'Nothing new since the last dream.';
  store.registerAgent({ actor, kind: 'script', vendor: 'AgentHaven', description: 'Built-in dreamer: turns past mistakes into lessons' });
  return recordDream(store, { actor, summary, proposals, since: d.since, until: d.until });
}

function listDreams(store, { limit = 10, status } = {}) {
  const dreams = (store.read().dreams || []).slice(-Math.max(1, Math.min(limit, KEEP_DREAMS))).reverse();
  return status ? dreams.map((d) => ({ ...d, proposals: d.proposals.filter((p) => p.status === status) })) : dreams;
}

function findProposal(data, id) {
  for (const d of data.dreams || []) {
    const p = d.proposals.find((x) => x.id === id);
    if (p) return { d, p };
  }
  throw new NotFoundError(`proposal ${id} not found`);
}

// Applying is a human's call unless auto-apply is on ("agenthaven" applies then).
function applyProposal(store, id, { actor }) {
  actor = text(actor, 'actor', 100);
  const result = store.withLock((data) => {
    if (actor !== 'agenthaven' && !Store.isAuthority(data, actor)) throw new ConflictError('only a human applies dream proposals (or turn on auto-apply)');
    const { p } = findProposal(data, id);
    if (p.status !== 'proposed') throw new ConflictError(`proposal is already ${p.status}`);
    if (p.flags && !Store.isHuman(data, actor)) throw new ConflictError('Guard flagged this proposal; only a human applies it');
    const note = (title, body, tags, extra = {}) => {
      const n = { id: newId('note'), title, body, tags, author: actor === 'agenthaven' ? 'dreamer' : actor, createdAt: now(), ...extra };
      data.notes.push(n);
      return n;
    };
    let ref = null;
    if (p.kind === 'lesson') ref = note(p.title, p.body, ['lesson', ...p.scope.skills], { scope: p.scope, evidence: p.evidence }).id;
    if (p.kind === 'agent-tip') ref = note(p.title, p.body, ['lesson', `agent:${p.agent}`], { scope: { files: [], skills: [], agent: p.agent }, evidence: p.evidence }).id;
    if (p.kind === 'merge-notes') {
      const olds = p.notes.map((nid) => data.notes.find((n) => n.id === nid)).filter(Boolean);
      if (olds.length < 2) throw new ConflictError('the notes to merge are gone');
      ref = note(olds[0].title, p.body, [...new Set(olds.flatMap((n) => n.tags))], { mergedFrom: olds.map((n) => n.id) }).id;
      data.notes = data.notes.filter((n) => !p.notes.includes(n.id));
    }
    if (p.kind === 'retire-note') {
      const before = data.notes.length;
      data.notes = data.notes.filter((n) => !p.notes.includes(n.id));
      if (data.notes.length === before) throw new ConflictError('the note is already gone');
    }
    Object.assign(p, { status: 'applied', appliedBy: actor, appliedAt: now(), ref });
    Store.log(data, actor, 'dream.applied', p.id, p.title);
    return p;
  });
  if (result.kind === 'task') {
    const t = store.createTask({ title: result.title, description: `${result.body}\n\nFrom a dream (proposal ${result.id}). Evidence: ${result.evidence.join(', ') || 'none'}.`,
      priority: result.task.priority, files: result.task.files, skills: result.task.skills, actor: actor === 'agenthaven' ? 'dreamer' : actor });
    store.withLock((data) => { findProposal(data, id).p.ref = t.id; });
    result.ref = t.id;
  }
  return result;
}

function dismissProposal(store, id, { actor, reason }) {
  actor = text(actor, 'actor', 100);
  return store.withLock((data) => {
    if (!Store.isAuthority(data, actor)) throw new ConflictError('only a human dismisses dream proposals');
    const { p } = findProposal(data, id);
    if (p.status !== 'proposed') throw new ConflictError(`proposal is already ${p.status}`);
    Object.assign(p, { status: 'dismissed', dismissedBy: actor, reason: typeof reason === 'string' ? reason.slice(0, 500) : undefined });
    Store.log(data, actor, 'dream.dismissed', p.id, p.title);
    return p;
  });
}

// ---- lessons for a task ------------------------------------------------------------

// The lessons that apply to a task: same files or folders, same skills, words in
// common, or tips for the agent working on it.
function lessonsFor(store, task, { agent } = {}) {
  const lessons = store.read().notes.filter((n) => n.tags.includes('lesson') && !n.quarantined);
  const scored = [];
  for (const n of lessons) {
    const scope = n.scope || { files: [], skills: [] };
    let score = 0;
    if (scope.agent) { if (scope.agent === (agent || task.assignee)) score += 3; else continue; }
    if (scope.files?.some((f) => task.files.some((g) => overlaps(f, g)))) score += 3;
    if (scope.skills?.some((s) => task.skills.includes(s))) score += 2;
    if (jaccard(`${task.title} ${task.description || ''}`, `${n.title} ${n.body}`) > 0.15) score += 1;
    if (score) scored.push({ score, lesson: { id: n.id, title: n.title, body: n.body } });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, 5).map((x) => x.lesson);
}

// ---- schedule ---------------------------------------------------------------------

// Dreams on a schedule. With agentTask on, it also puts a "Dream" task on the
// board for an LLM agent with the skill "dreaming" (for example Claude).
function schedule(store, { onDream, onError, checkEveryMs = 60000 } = {}) {
  const tick = () => {
    try {
      const cfg = settingsOf(store);
      if (!cfg.everyHours) return;
      const last = Date.parse(store.getSettings().lastDreamAt || 0);
      if (Date.now() - last < cfg.everyHours * 3600000) return;
      if (store.stats().seq <= (store.getSettings().dreamSeq || 0)) return; // nothing new
      const d = dream(store);
      if (cfg.agentTask && !store.listTasks().some((t) => t.skills.includes('dreaming') && t.status !== 'done')) {
        store.createTask({ title: 'Dream: learn from the last period on this board', priority: 3, skills: ['dreaming'], review: false,
          description: 'Call dream_digest, look for patterns in mistakes and feedback, then call submit_dream with lessons, merges and follow-up tasks. A human reviews the proposals.', actor: 'dreamer' });
      }
      if (onDream) onDream(d);
    } catch (err) { if (onError) onError(err); }
  };
  const timer = setInterval(tick, checkEveryMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}

const CLAUDE_DREAMER = `You are the dreaming agent of this AgentHaven board. You do not do project work; you make the other agents better.

1. If dream_digest is not among your agenthaven tools, call enable_tools with profiles ["dream"]. Then call register_agent with kind "llm", your vendor and model, and skills ["dreaming"].
2. Call dream_digest. It lists what happened since the last dream: reviews that were sent back and why, claims that expired, budgets that ran over, tasks stuck in blocked, handoffs, comments, the shared notes and proposals still open.
3. Think about patterns, not single events. Which feedback keeps coming back? Which areas, files or agents keep stalling? What did the last handoffs leave out? Which notes repeat, contradict each other or are no longer true?
4. Call submit_dream with a short summary and proposals:
   - "lesson": what the next agent must do differently, with scope.files and scope.skills so it reaches the right tasks.
   - "task": a fix for a root cause that can be done once (a missing test helper, a lint rule, a doc).
   - "merge-notes" (notes: ids) and "retire-note" (note: id) to keep memory clean.
   - "agent-tip" (agent: name) for advice to one agent.
   Cite task or note ids as evidence. Propose nothing you cannot back with evidence, and nothing already in the notes or open proposals.
5. If you claimed a "Dream" task, mark it done with a one-line summary.`;

module.exports = { digest, dream, heuristicProposals, recordDream, listDreams, applyProposal, dismissProposal, lessonsFor, schedule, settingsOf, setDreamSettings, KINDS, CLAUDE_DREAMER };
