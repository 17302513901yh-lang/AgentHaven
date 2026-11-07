'use strict';
const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done'];
const LABELS = { todo: 'To do', doing: 'Doing', blocked: 'Blocked', review: 'Review', done: 'Done' };
const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
let workspace = localStorage.getItem('workspace') || 'default';
let tasks = [];
let editing = null;
let dragging = null;

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
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
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

const move = (task, status) => act(() => api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { version: task.version, status } }));

function card(task) {
  const last = task.handoffs?.at(-1);
  const node = el('button', { className: 'card', type: 'button', draggable: true, title: 'Open task (drag to move)', onclick: () => openTask(task) },
    el('span', { className: 't', textContent: task.title }),
    el('span', { className: 'm' }, task.assignee ? el('span', { className: 'who', textContent: task.assignee }) : 'unassigned', ` · ${ago(task.updatedAt)}`),
    task.files.length ? el('span', { className: 'm files', textContent: task.files.join(', ') }) : null,
    last ? el('span', { className: 'm', textContent: `↪ ${last.from}: ${last.summary}` }) : null);
  node.addEventListener('dragstart', () => { dragging = task; });
  return node;
}

function column(status) {
  const list = tasks.filter((t) => t.status === status);
  const col = el('div', { className: 'col' }, el('h3', {}, LABELS[status], el('span', { textContent: list.length })), ...list.map(card));
  col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
  col.addEventListener('dragleave', () => col.classList.remove('over'));
  col.addEventListener('drop', (e) => { e.preventDefault(); col.classList.remove('over'); if (dragging && dragging.status !== status) move(dragging, status); dragging = null; });
  return col;
}

async function render() {
  const q = $('#note-search').value.trim();
  const [t, notes, activity, claims] = await Promise.all([
    api('/api/tasks'), api(`/api/notes${q ? `?q=${encodeURIComponent(q)}` : ''}`), api('/api/activity?limit=30'), api('/api/claims'),
  ]);
  tasks = t;
  $('#board').replaceChildren(...STATUSES.map(column));
  $('#onboarding').hidden = tasks.length > 0 || activity.length > 0;
  $('#claims').replaceChildren(...(claims.length ? claims.map((c) => el('li', {}, el('code', { textContent: c.file }), ' ', el('span', { className: 'who', textContent: c.agent })))
    : [el('li', { className: 'empty', textContent: 'No files claimed.' })]));
  $('#notes').replaceChildren(...(notes.length ? notes.slice().reverse().map((n) => el('li', {}, el('strong', { textContent: n.title }), el('div', { className: 'body', textContent: n.body }), el('div', { className: 'm', textContent: `${n.author} · ${ago(n.createdAt)}${n.tags.length ? ` · #${n.tags.join(' #')}` : ''}` })))
    : [el('li', { className: 'empty', textContent: q ? 'No matching notes.' : 'No notes yet.' })]));
  $('#activity').replaceChildren(...(activity.length ? activity.map((e) => el('li', {}, el('strong', { textContent: e.actor }), ` ${e.action.replace('task.', '').replace('note.', 'note ')} `, el('span', { className: 'm', textContent: ago(e.at) })))
    : [el('li', { className: 'empty', textContent: 'Nothing yet.' })]));
  statusEl.textContent = `Live · ${tasks.length} tasks`;
  statusEl.classList.remove('err');
}

async function loadWorkspaces(extra) {
  const names = await (await fetch('/api/workspaces')).json();
  if (extra && !names.includes(extra)) names.push(extra);
  if (!names.includes(workspace)) workspace = 'default';
  $('#workspace').replaceChildren(...names.map((n) => el('option', { value: n, textContent: n, selected: n === workspace })));
}

function showError(err) { statusEl.textContent = err.message; statusEl.classList.add('err'); }

async function act(fn) {
  try { await fn(); } catch (err) { showError(err); return; }
  await refresh();
}

async function refresh() {
  if (document.querySelector('dialog[open]')) return; // don't redraw under an open dialog
  try { await render(); } catch (err) { statusEl.textContent = `Offline: ${err.message}`; statusEl.classList.add('err'); }
}

function openTask(task) {
  editing = task;
  const f = $('#task-form');
  f.title.value = task.title;
  f.description.value = task.description || '';
  f.status.replaceChildren(...STATUSES.map((s) => el('option', { value: s, textContent: LABELS[s], selected: s === task.status })));
  f.assignee.value = task.assignee || '';
  f.files.value = task.files.join('\n');
  $('#dlg-handoffs').replaceChildren(...(task.handoffs || []).map((h) => el('p', { textContent: `${ago(h.at)} — ${h.from} → ${h.to || 'board'}: ${h.summary}${h.nextSteps ? ` (next: ${h.nextSteps})` : ''}` })));
  $('#task-dialog').showModal();
}

$('#task-form').addEventListener('submit', (e) => {
  const f = e.target;
  const body = {
    version: editing.version, title: f.title.value, description: f.description.value, status: f.status.value,
    assignee: f.assignee.value.trim() || null, files: f.files.value.split('\n').map((s) => s.trim()).filter(Boolean),
  };
  const id = editing.id;
  setTimeout(() => act(() => api(`/api/tasks/${id}`, { method: 'PATCH', body })));
});
$('#dlg-cancel').addEventListener('click', () => $('#task-dialog').close());
$('#dlg-delete').addEventListener('click', () => {
  if (!confirm(`Delete "${editing.title}"?`)) return;
  const { id, version } = editing;
  $('#task-dialog').close();
  act(() => api(`/api/tasks/${id}?version=${version}`, { method: 'DELETE' }));
});
$('#task-dialog').addEventListener('close', () => { editing = null; refresh(); });

$('#new-task').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = e.target.title.value;
  e.target.reset();
  act(() => api('/api/tasks', { method: 'POST', body: { title } }));
});
$('#new-note').addEventListener('submit', (e) => {
  e.preventDefault();
  const body = { title: e.target.title.value, body: e.target.body.value };
  e.target.reset();
  act(() => api('/api/notes', { method: 'POST', body }));
});
let searchTimer;
$('#note-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 200); });

$('#workspace').addEventListener('change', (e) => { workspace = e.target.value; localStorage.setItem('workspace', workspace); refresh(); });
$('#new-workspace').addEventListener('click', () => $('#ws-dialog').showModal());
$('#ws-cancel').addEventListener('click', () => $('#ws-dialog').close());
$('#ws-form').addEventListener('submit', (e) => {
  workspace = e.target.name.value;
  localStorage.setItem('workspace', workspace);
  e.target.reset();
  setTimeout(() => loadWorkspaces(workspace).then(refresh));
});

loadWorkspaces().then(refresh).catch(showError);
setInterval(refresh, 2000);
