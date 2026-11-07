'use strict';
const STATUSES = ['todo', 'doing', 'blocked', 'review', 'done'];
const LABELS = { todo: 'To do', doing: 'Doing', blocked: 'Blocked', review: 'Review', done: 'Done' };
const $ = (s) => document.querySelector(s);
const statusEl = $('#status');

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  for (const c of children) if (c != null) node.append(c);
  return node;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json' }, body: opts.body && JSON.stringify(opts.body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const ago = (iso) => {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

function card(task) {
  const move = (status) => el('button', { className: 'ghost', textContent: `→ ${LABELS[status]}`, onclick: () => act(() => api(`/api/tasks/${task.id}`, { method: 'PATCH', body: { version: task.version, status } })) });
  const last = task.handoffs?.at(-1);
  return el('div', { className: 'card' },
    el('div', { className: 't', textContent: task.title }),
    el('div', { className: 'm' }, task.assignee ? el('span', { className: 'who', textContent: task.assignee }) : 'unassigned', ` · ${ago(task.updatedAt)}`),
    task.description ? el('div', { className: 'm', textContent: task.description }) : null,
    last ? el('div', { className: 'm', textContent: `Handoff from ${last.from}: ${last.summary}` }) : null,
    el('div', { className: 'actions' }, ...STATUSES.filter((s) => s !== task.status).map(move)));
}

async function render() {
  const [tasks, notes, activity] = await Promise.all([api('/api/tasks'), api('/api/notes'), api('/api/activity?limit=30')]);
  $('#board').replaceChildren(...STATUSES.map((s) => {
    const list = tasks.filter((t) => t.status === s);
    return el('div', { className: 'col' }, el('h3', {}, LABELS[s], el('span', { textContent: list.length })), ...list.map(card));
  }));
  $('#notes').replaceChildren(...(notes.length ? notes.slice().reverse().map((n) => el('li', {}, el('strong', { textContent: n.title }), el('div', { textContent: n.body }), el('div', { className: 'm', textContent: `${n.author} · ${ago(n.createdAt)}` })))
    : [el('li', { className: 'empty', textContent: 'No notes yet.' })]));
  $('#activity').replaceChildren(...(activity.length ? activity.map((e) => el('li', {}, el('strong', { textContent: e.actor }), ` ${e.action.replace('.', ' ')} `, el('span', { className: 'm', textContent: ago(e.at) })))
    : [el('li', { className: 'empty', textContent: 'Connect an agent to get started.' })]));
  statusEl.textContent = `Live · ${tasks.length} tasks`;
  statusEl.classList.remove('err');
}

async function act(fn) {
  try { await fn(); } catch (err) { statusEl.textContent = err.message; statusEl.classList.add('err'); }
  await refresh();
}

async function refresh() {
  try { await render(); } catch (err) { statusEl.textContent = `Offline: ${err.message}`; statusEl.classList.add('err'); }
}

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

refresh();
setInterval(refresh, 2000);
