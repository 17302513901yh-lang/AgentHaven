'use strict';
const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done'];
const LABELS = { todo: 'To do', doing: 'Doing', blocked: 'Blocked', review: 'Review', done: 'Done' };
const KIND_ICON = { llm: '🤖', human: '🧑', 'neural-network': '🧠', script: '⚙️', other: '◆' };
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const statusEl = $('#status');
const SVG = 'http://www.w3.org/2000/svg';

let workspace = 'default';
try { workspace = localStorage.getItem('workspace') || 'default'; } catch { /* storage blocked */ }
let tasks = [];
let agents = [];
let editing = null; // full task being edited
let draftCriteria = [];
let dragging = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

async function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${path}${sep}workspace=${encodeURIComponent(workspace)}`, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const ago = (iso) => {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};
const until = (iso) => {
  const m = Math.round((new Date(iso) - Date.now()) / 60000);
  return m <= 0 ? 'expiring' : m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};
const money = (n) => `$${(n || 0).toFixed(2)}`;
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));
const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
const presenceOf = (name) => agents.find((a) => a.name === name)?.presence || 'offline';

function showError(err) { statusEl.textContent = err.message; statusEl.classList.add('err'); }
async function act(fn) {
  try { await fn(); } catch (err) { showError(err); return false; }
  await refresh(true);
  return true;
}

// ---- board -------------------------------------------------------------------

function visible(task) {
  const q = $('#filter').value.trim().toLowerCase();
  const who = $('#filter-agent').value;
  if (who && task.assignee !== who) return false;
  if (!q) return true;
  return `${task.title} ${task.id} ${task.assignee || ''} ${task.files.join(' ')} ${task.skills.join(' ')}`.toLowerCase().includes(q);
}

function card(task) {
  const open = task.criteria.filter((c) => !c.done).length;
  const waiting = task.waitingOn?.length && task.status === 'todo';
  const meta = [
    el('span', { className: `tag p${task.priority}`, textContent: `P${task.priority}` }),
    task.assignee ? el('span', { className: 'who' }, el('span', { className: `dot ${presenceOf(task.assignee)}` }), task.assignee) : null,
    waiting ? el('span', { className: 'tag warn', title: `Starts after ${task.waitingOn.join(', ')}`, textContent: `🔒 ${task.waitingOn.length}` }) : null,
    task.criteria.length ? el('span', { className: `tag ${open ? '' : 'ok'}`, title: 'Acceptance criteria', textContent: `✓ ${task.criteria.length - open}/${task.criteria.length}` }) : null,
    task.review ? el('span', { className: 'tag info', title: 'Needs review by someone else', textContent: 'review' }) : null,
    task.comments ? el('span', { className: 'tag', title: 'Comments', textContent: `💬 ${task.comments}` }) : null,
    task.usage.costUsd || task.usage.tokens ? el('span', { className: `tag ${task.budget ? 'warn' : ''}`, title: 'Spent', textContent: task.usage.costUsd ? money(task.usage.costUsd) + (task.budget?.costUsd !== undefined ? `/${money(task.budget.costUsd)}` : '') : `${tokens(task.usage.tokens)} tok` }) : null,
    task.leaseUntil ? el('span', { className: 'tag', title: `Claim expires ${new Date(task.leaseUntil).toLocaleTimeString()} without activity`, textContent: `⏱ ${until(task.leaseUntil)}` }) : null,
    ...task.skills.map((s) => el('span', { className: 'tag', textContent: s })),
  ];
  const metricBits = Object.entries(task.metrics || {}).slice(0, 3).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ');
  const node = el('button', { className: `card p${task.priority}${waiting ? ' waiting' : ''}`, type: 'button', draggable: true, title: 'Open (drag to move)', onclick: () => openTask(task.id) },
    el('span', { className: 't', textContent: task.title }),
    el('span', { className: 'meta' }, meta),
    task.progress != null && task.status !== 'done' ? el('span', { className: 'bar', title: `${task.progress}%` }, el('span')) : null,
    task.progressNote || metricBits ? el('span', { className: 'note', textContent: [task.progressNote, metricBits].filter(Boolean).join(' — ') }) : null,
    task.blockedReason ? el('span', { className: 'reason', textContent: task.blockedReason }) : null,
    task.files.length ? el('span', { className: 'files', title: task.files.join('\n'), textContent: task.files.join(', ') }) : null,
    task.lastHandoff && task.status === 'todo' ? el('span', { className: 'note', textContent: `↪ ${task.lastHandoff.from}: ${task.lastHandoff.summary}` }) : null);
  const bar = node.querySelector('.bar > span');
  if (bar) bar.style.width = `${task.progress}%`;
  node.addEventListener('dragstart', () => { dragging = task; });
  return node;
}

function column(status) {
  const list = tasks.filter((t) => t.status === status && visible(t))
    .sort((a, b) => (status === 'done' ? b.updatedAt.localeCompare(a.updatedAt) : a.priority - b.priority || a.createdAt.localeCompare(b.createdAt)));
  const col = el('div', { className: 'col', role: 'list', ariaLabel: LABELS[status] },
    el('h3', {}, LABELS[status], el('span', { textContent: list.length })),
    list.length ? list.slice(0, status === 'done' ? 30 : 200).map(card) : el('p', { className: 'empty', textContent: status === 'todo' ? 'Nothing waiting.' : '—' }));
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
  col.addEventListener('dragleave', () => col.classList.remove('over'));
  col.addEventListener('drop', (e) => {
    e.preventDefault(); col.classList.remove('over');
    if (dragging && dragging.status !== status) {
      const t = dragging;
      act(() => api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { version: t.version, status } }));
    }
    dragging = null;
  });
  return col;
}

function renderStats(s) {
  const chip = (label, value, title) => el('span', { className: 'chip', title: title || label }, el('b', { textContent: value }), label);
  $('#stats').replaceChildren(
    chip('doing', s.counts.doing), chip('to do', s.counts.todo), chip('review', s.counts.review),
    s.counts.blocked ? chip('blocked', s.counts.blocked) : null, chip('done', s.counts.done),
    chip('agents online', `${s.online}/${s.agents}`), chip('spent', money(s.usage.costUsd), `${tokens(s.usage.tokens)} tokens`));
}

function renderAgents() {
  $('#agents').replaceChildren(...(agents.length ? agents.map((a) => el('li', {},
    el('span', { title: a.presence }, el('span', { className: `dot ${a.presence}` })),
    el('span', { className: 'name' }, `${KIND_ICON[a.kind] || '◆'} ${a.name}`),
    el('span', { className: 'sub', textContent: [[a.vendor, a.model].filter(Boolean).join(' · '), a.tasks.length ? `on ${a.tasks.map((t) => t.title).join(', ')}` : a.presence === 'online' ? 'free' : `seen ${ago(a.lastSeen)}`, a.status].filter(Boolean).join(' — ') }),
    a.skills.length ? el('span', { className: 'sub', textContent: a.skills.join(', ') }) : null))
    : [el('li', { className: 'empty', textContent: 'No agents yet.' })]));
  $('#agent-names').replaceChildren(...agents.map((a) => el('option', { value: a.name })));
  const sel = $('#filter-agent');
  const cur = sel.value;
  sel.replaceChildren(el('option', { value: '', textContent: 'All agents' }), ...agents.map((a) => el('option', { value: a.name, textContent: a.name, selected: a.name === cur })));
}

async function render() {
  const q = $('#note-search').value.trim();
  const [t, notes, activity, claims, ag, stats] = await Promise.all([
    api('/api/tasks'), api(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`), api('/api/activity?limit=40'), api('/api/claims'), api('/api/agents'), api('/api/stats'),
  ]);
  tasks = t; agents = ag;
  renderStats(stats);
  renderAgents();
  $('#board').replaceChildren(...STATUSES.map(column));
  $('#onboarding').hidden = tasks.length > 0 || activity.length > 0;
  $('#claims').replaceChildren(...(claims.length ? claims.map((c) => el('li', {}, el('code', { textContent: c.file }), ' ', el('span', { className: 'who' }, el('span', { className: `dot ${presenceOf(c.agent)}` }), c.agent)))
    : [el('li', { className: 'empty', textContent: 'No files claimed.' })]));
  $('#notes').replaceChildren(...(notes.length ? notes.slice().reverse().map((n) => el('li', {}, el('strong', { textContent: n.title }), el('div', { className: 'body', textContent: n.body }), el('div', { className: 'm', textContent: `${n.author} · ${ago(n.createdAt)}${n.tags.length ? ` · #${n.tags.join(' #')}` : ''}` })))
    : [el('li', { className: 'empty', textContent: q ? 'No matching notes.' : 'No notes yet.' })]));
  $('#activity').replaceChildren(...(activity.length ? activity.map((e) => el('li', {}, el('strong', { textContent: e.actor }), ` ${e.action.replace(/^task\./, '').replace(/[._]/g, ' ')} `, e.ref?.startsWith('task_') ? el('code', { textContent: tasks.find((x) => x.id === e.ref)?.title || e.ref }) : null, ' ', el('span', { className: 'm', textContent: ago(e.at) })))
    : [el('li', { className: 'empty', textContent: 'Nothing yet.' })]));
  statusEl.textContent = live ? 'Live' : 'Polling';
  statusEl.classList.remove('err');
}

let pending = false;
async function refresh(force) {
  if (!force && document.querySelector('dialog[open]')) { pending = true; return; } // don't redraw under an open dialog
  pending = false;
  try { await render(); } catch (err) { statusEl.textContent = `Offline: ${err.message}`; statusEl.classList.add('err'); }
}

// ---- live updates ------------------------------------------------------------

let live = false;
let source = null;
let timer = null;
function connect() {
  source?.close();
  clearTimeout(timer);
  if (!window.EventSource) return poll();
  source = new EventSource(`/api/stream?workspace=${encodeURIComponent(workspace)}`);
  let debounce;
  source.addEventListener('change', () => { live = true; clearTimeout(debounce); debounce = setTimeout(() => refresh(), 120); });
  source.onerror = () => { live = false; source.close(); timer = setTimeout(connect, 3000); };
}
function poll() { refresh(); timer = setTimeout(poll, 4000); }
setInterval(() => { if (!document.querySelector('dialog[open]')) refresh(); }, 30000); // lease timers and presence

// ---- task dialog ---------------------------------------------------------------

function selectTab(name) {
  $$('.tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.tab').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}
$$('.tabs [role=tab]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));

function sparkline(points) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 200 46');
  svg.setAttribute('preserveAspectRatio', 'none');
  if (points.length < 2) return svg;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs); const hi = Math.max(...vs); const span = hi - lo || 1;
  const d = vs.map((v, i) => `${i ? 'L' : 'M'}${(i / (vs.length - 1)) * 200},${42 - ((v - lo) / span) * 38}`).join(' ');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}

function fillDialog(task) {
  const f = $('#task-form');
  const isNew = !task.id;
  $('#dlg-h').textContent = isNew ? 'New task' : 'Task';
  $('#dlg-id').textContent = task.id || '';
  f.title.value = task.title || '';
  f.description.value = task.description || '';
  f.status.replaceChildren(...STATUSES.map((s) => el('option', { value: s, textContent: LABELS[s], selected: s === (task.status || 'todo') })));
  f.status.disabled = isNew;
  f.priority.value = String(task.priority ?? 2);
  f.assignee.value = task.assignee || '';
  f.assignee.disabled = isNew;
  f.skills.value = (task.skills || []).join(', ');
  f.files.value = (task.files || []).join('\n');
  f.review.checked = Boolean(task.review);
  f.budgetCost.value = task.budget?.costUsd ?? '';
  f.budgetTokens.value = task.budget?.tokens ?? '';
  const deps = new Set(task.dependsOn || []);
  const others = tasks.filter((t) => t.id !== task.id && t.status !== 'done' || deps.has(t.id));
  $('#dlg-deps').replaceChildren(...(others.length ? others.map((t) => el('label', {}, el('input', { type: 'checkbox', value: t.id, checked: deps.has(t.id) }), `${t.title} `, el('span', { className: 'm', textContent: LABELS[t.status] })))
    : [el('span', { className: 'm', textContent: 'No other open tasks.' })]));

  const banner = $('#dlg-banner');
  const waiting = task.waitingOn || [];
  banner.hidden = !(task.blockedReason || waiting.length || task.status === 'review');
  banner.className = `banner${task.blockedReason ? ' bad' : ''}`;
  banner.textContent = task.blockedReason ? task.blockedReason
    : waiting.length ? `Starts after: ${waiting.map((w) => `${w.title} (${LABELS[w.status]})`).join(', ')}`
      : task.status === 'review' ? `${task.assignee} asks for review. Approve, or request changes with a comment.` : '';

  draftCriteria = (task.criteria || []).map((c) => ({ ...c }));
  renderCriteria();
  $('#tab-criteria-n').textContent = draftCriteria.length ? `${draftCriteria.filter((c) => c.done).length}/${draftCriteria.length}` : '';
  const comments = task.comments || [];
  $('#tab-comments-n').textContent = comments.length ? String(comments.length) : '';
  $('#dlg-comments').replaceChildren(...(comments.length ? comments.map((c) => el('li', { className: `k-${c.kind || 'comment'}` }, el('span', { className: 'm', textContent: `${c.actor} · ${ago(c.at)}${c.kind ? ` · ${c.kind.replace(/-/g, ' ')}` : ''}` }), el('div', { className: 'body', textContent: c.body })))
    : [el('li', { className: 'empty', textContent: 'No comments yet.' })]));
  $('#comment-new').disabled = isNew; $('#comment-add').disabled = isNew;

  const usage = task.usage || { tokens: 0, costUsd: 0 };
  $('#dlg-progress').replaceChildren(el('div', { className: 'kpis' },
    el('div', { className: 'kpi' }, el('div', { className: 'm', textContent: 'Progress' }), el('div', { className: 'v', textContent: task.progress == null ? '—' : `${task.progress}%` }), task.progressNote ? el('div', { className: 'm', textContent: task.progressNote }) : null),
    el('div', { className: 'kpi' }, el('div', { className: 'm', textContent: 'Cost' }), el('div', { className: 'v', textContent: money(usage.costUsd) }), task.budget?.costUsd !== undefined ? el('div', { className: 'm', textContent: `budget ${money(task.budget.costUsd)}` }) : null),
    el('div', { className: 'kpi' }, el('div', { className: 'm', textContent: 'Tokens' }), el('div', { className: 'v', textContent: tokens(usage.tokens) }), task.budget?.tokens !== undefined ? el('div', { className: 'm', textContent: `budget ${tokens(task.budget.tokens)}` }) : null),
    el('div', { className: 'kpi' }, el('div', { className: 'm', textContent: 'Claim' }), el('div', { className: 'v', textContent: task.leaseUntil ? until(task.leaseUntil) : '—' }), el('div', { className: 'm', textContent: task.assignee || 'unassigned' }))));
  const metrics = Object.entries(task.metrics || {}).filter(([, pts]) => Array.isArray(pts));
  $('#dlg-metrics').replaceChildren(...(metrics.length ? metrics.map(([k, pts]) => el('div', { className: 'metric' }, el('div', { className: 'm', textContent: `${k} · ${pts.length} points` }), el('div', { className: 'v', textContent: fmt(pts[pts.length - 1].v) }), sparkline(pts)))
    : [el('p', { className: 'm', textContent: 'No metrics reported. Agents and training jobs send them with report_progress (e.g. loss, accuracy, tests passed).' })]));

  const history = [...(task.handoffs || []).map((h) => ({ at: h.at, text: `${h.from} → ${h.to || 'board'}: ${h.summary}${h.nextSteps ? `\nNext: ${h.nextSteps}` : ''}` }))];
  if (task.createdAt) history.unshift({ at: task.createdAt, text: `Created by ${task.createdBy}` });
  if (task.reviewedBy) history.push({ at: task.updatedAt, text: `Approved by ${task.reviewedBy}` });
  $('#dlg-history').replaceChildren(...history.map((h) => el('li', {}, el('span', { className: 'm', textContent: ago(h.at) }), el('div', { className: 'body', textContent: h.text }))));

  $('#dlg-delete').hidden = isNew;
  $('#dlg-approve').hidden = task.status !== 'review';
  $('#dlg-reject').hidden = task.status !== 'review';
}

function renderCriteria() {
  $('#dlg-criteria').replaceChildren(...(draftCriteria.length ? draftCriteria.map((c, i) => el('li', { className: c.done ? 'done' : '' },
    el('input', { type: 'checkbox', checked: c.done, ariaLabel: `Done: ${c.text}`, onchange: (e) => toggleCriterion(i, e.target.checked) }),
    el('span', { className: 'grow', textContent: c.text }),
    c.by ? el('span', { className: 'm', textContent: c.by }) : null,
    el('button', { type: 'button', className: 'ghost icon', textContent: '✕', ariaLabel: 'Remove', onclick: () => { draftCriteria.splice(i, 1); renderCriteria(); } })))
    : [el('li', { className: 'empty', textContent: 'No acceptance criteria. Add what "done" means.' })]));
}

async function toggleCriterion(i, done) {
  const c = draftCriteria[i];
  if (!editing?.id || !c.id) { c.done = done; renderCriteria(); return; }
  try {
    const t = await api(`/api/tasks/${editing.id}/criteria`, { method: 'POST', body: { criterion: c.id, done } });
    editing = { ...editing, ...t };
    draftCriteria = t.criteria.map((x) => ({ ...x }));
    renderCriteria();
  } catch (err) { showError(err); renderCriteria(); }
}

async function openTask(id) {
  try {
    editing = id ? await api(`/api/tasks/${id}`) : { title: $('#task-title').value, priority: Number($('#task-priority').value) };
  } catch (err) { showError(err); return; }
  fillDialog(editing);
  selectTab('details');
  $('#task-dialog').showModal();
}

function formBody(f) {
  const listOf = (s, sep) => s.split(sep).map((x) => x.trim()).filter(Boolean);
  const budget = {};
  if (f.budgetCost.value !== '') budget.costUsd = Number(f.budgetCost.value);
  if (f.budgetTokens.value !== '') budget.tokens = Number(f.budgetTokens.value);
  return {
    title: f.title.value, description: f.description.value, priority: Number(f.priority.value),
    files: listOf(f.files.value, '\n'), skills: listOf(f.skills.value, ','), review: f.review.checked,
    dependsOn: $$('#dlg-deps input:checked').map((i) => i.value),
    criteria: draftCriteria.map((c) => c.text), budget: Object.keys(budget).length ? budget : null,
  };
}

$('#task-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const body = formBody(f);
  const t = editing;
  const run = t.id
    ? () => api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { ...body, version: t.version, status: f.status.value, assignee: f.assignee.value.trim() || null } })
    : () => api('/api/tasks', { method: 'POST', body });
  act(run).then((ok) => { if (ok) { $('#task-dialog').close(); if (!t.id) $('#task-title').value = ''; } });
});
$('#crit-add').addEventListener('click', () => {
  const input = $('#crit-new');
  if (!input.value.trim()) return;
  draftCriteria.push({ text: input.value.trim(), done: false });
  input.value = '';
  renderCriteria();
});
$('#crit-new').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#crit-add').click(); } });
$('#comment-add').addEventListener('click', async () => {
  const body = $('#comment-new').value.trim();
  if (!body || !editing?.id) return;
  try {
    await api(`/api/tasks/${editing.id}/comments`, { method: 'POST', body: { body } });
    $('#comment-new').value = '';
    editing = await api(`/api/tasks/${editing.id}`);
    fillDialog(editing); selectTab('comments');
  } catch (err) { showError(err); }
});
$('#dlg-approve').addEventListener('click', () => act(() => api(`/api/tasks/${editing.id}/review`, { method: 'POST', body: { approve: true } })).then((ok) => ok && $('#task-dialog').close()));
$('#dlg-reject').addEventListener('click', () => {
  const comment = $('#comment-new').value.trim() || prompt('What must change?');
  if (!comment) return;
  act(() => api(`/api/tasks/${editing.id}/review`, { method: 'POST', body: { approve: false, comment } })).then((ok) => { if (ok) { $('#comment-new').value = ''; $('#task-dialog').close(); } });
});
const closeTask = () => $('#task-dialog').close();
$('#dlg-cancel').addEventListener('click', closeTask);
$('#dlg-x').addEventListener('click', closeTask);
$('#dlg-delete').addEventListener('click', () => {
  if (!confirm(`Delete "${editing.title}"?`)) return;
  const { id, version } = editing;
  $('#task-dialog').close();
  act(() => api(`/api/tasks/${id}?version=${version}`, { method: 'DELETE' }));
});
$('#task-dialog').addEventListener('close', () => { editing = null; if (pending) refresh(); });

// ---- quick add, notes, filters -----------------------------------------------------

$('#new-task').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = e.target.title.value;
  const priority = Number(e.target.priority.value);
  e.target.title.value = '';
  act(() => api('/api/tasks', { method: 'POST', body: { title, priority } }));
});
$('#new-task-more').addEventListener('click', () => openTask(null));
$('#new-note').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = { title: e.target.title.value, body: e.target.body.value };
  e.target.reset();
  act(() => api('/api/notes', { method: 'POST', body }));
});
let searchTimer;
$('#note-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => refresh(true), 200); });
$('#filter').addEventListener('input', () => $('#board').replaceChildren(...STATUSES.map(column)));
$('#filter-agent').addEventListener('change', () => $('#board').replaceChildren(...STATUSES.map(column)));

document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
  if (e.key === 'n') { e.preventDefault(); $('#task-title').focus(); }
  if (e.key === '/') { e.preventDefault(); $('#filter').focus(); }
});

// ---- workspaces and file sharing --------------------------------------------------

async function loadWorkspaces(extra) {
  const names = await (await fetch('/api/workspaces')).json();
  if (extra && !names.includes(extra)) names.push(extra);
  if (!names.includes(workspace)) workspace = 'default';
  $('#workspace').replaceChildren(...names.map((n) => el('option', { value: n, textContent: n, selected: n === workspace })));
}
const remember = () => { try { localStorage.setItem('workspace', workspace); } catch { /* storage blocked */ } };
$('#workspace').addEventListener('change', (e) => { workspace = e.target.value; remember(); connect(); refresh(true); });
$('#new-workspace').addEventListener('click', () => $('#ws-dialog').showModal());
$('#ws-cancel').addEventListener('click', () => $('#ws-dialog').close());
$('#ws-form').addEventListener('submit', (e) => {
  workspace = e.target.name.value;
  remember();
  e.target.reset();
  setTimeout(() => loadWorkspaces(workspace).then(() => { connect(); refresh(true); }));
});

function showShare(state) {
  $('#share-state').textContent = state.dir ? `Shared at ${state.dir}${state.linked ? ' · syncing' : ''}` : 'Not shared yet.';
  $('#share-instr-wrap').hidden = !state.instructions;
  $('#share-instr').value = state.instructions || '';
  $('#share-unlink').hidden = !state.dir;
  $('#share-copy').hidden = !state.instructions;
  if (state.dir) $('#share-form').dir.value = state.dir;
}
$('#share-files').addEventListener('click', async () => {
  try { showShare(await api('/api/workboard')); } catch (err) { showError(err); }
  $('#share-dialog').showModal();
});
$('#share-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { showShare(await api('/api/workboard', { method: 'POST', body: { dir: e.target.dir.value.trim() } })); } catch (err) { $('#share-state').textContent = err.message; }
});
$('#share-unlink').addEventListener('click', async () => { try { showShare(await api('/api/workboard', { method: 'DELETE' })); } catch (err) { showError(err); } });
$('#share-copy').addEventListener('click', () => navigator.clipboard?.writeText($('#share-instr').value).then(() => { $('#share-copy').textContent = 'Copied'; setTimeout(() => { $('#share-copy').textContent = 'Copy instructions'; }, 1500); }));
$('#share-cancel').addEventListener('click', () => $('#share-dialog').close());

loadWorkspaces().then(() => { connect(); return refresh(true); }).catch(showError);
