'use strict';
const cards = [...document.querySelectorAll('.task-card')];
const detail = document.querySelector('#task-detail');
const status = document.querySelector('#demo-status');
const play = document.querySelector('#handoff-demo');
const reset = document.querySelector('#reset-demo');
const details = {
build: '<span class="detail-author"><span class="mini-avatar peach">B</span> Builder · for the reviewer</span><blockquote>“The draft is ready. Could you check whether the task statuses are clear enough?”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> board-draft.md <span aria-hidden="true">↗</span></div>',
review: '<span class="detail-author"><span class="mini-avatar lime">R</span> Reviewer · for the builder</span><blockquote>“I’m checking how clear the tasks are, using the planner’s notes to guide my review.”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> review-notes.md <span aria-hidden="true">↗</span></div>',
plan: '<span class="detail-author"><span class="mini-avatar lilac">P</span> Planner · for the team</span><blockquote>“Start small: one project, three task statuses, and a place for context. The builder can take it from here.”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> project-agreements.md <span aria-hidden="true">↗</span></div>'
};
function selectTask(name) {
  cards.forEach(card => {
    const selected = card.dataset.task === name;
    card.classList.toggle('selected', selected);
    card.setAttribute('aria-pressed', String(selected));
  });
  detail.innerHTML = details[name];
}
cards.forEach(card => card.addEventListener('click', () => selectTask(card.dataset.task)));
let timer;
let stage = 0;
play.addEventListener('click', () => {
  if (stage === 0) {
    stage = 1; play.disabled = true; selectTask('build');
    status.innerHTML = '<span class="status-dot"></span> Builder is preparing the context…';
    timer = window.setTimeout(() => {
      document.querySelector('#done-slot').append(document.querySelector('[data-task="build"]'));
      document.querySelector('#doing-slot').append(document.querySelector('[data-task="review"]'));
      document.querySelector('#todo-count').textContent = '0';
      document.querySelector('#done-count').textContent = '2';
      selectTask('review');
      status.innerHTML = '<span class="status-dot"></span> Reviewer picks up with the shared context.';
      play.innerHTML = 'Complete the review <span aria-hidden="true">→</span>';
      play.disabled = false; reset.hidden = false;
    }, 1100);
  } else {
    document.querySelector('#done-slot').append(document.querySelector('[data-task="review"]'));
    document.querySelector('#doing-count').textContent = '0';
    document.querySelector('#done-count').textContent = '3';
    status.innerHTML = '<span class="status-dot"></span> Done together. The knowledge stays with the project.';
    detail.innerHTML = '<span class="detail-author"><span class="mini-avatar lime">R</span> Reviewer · for the team</span><blockquote>“The approach is clear. My notes stay with the project, ready for us to build on next time.”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> review-complete.md <span aria-hidden="true">↗</span></div>';
    play.hidden = true; stage = 2;
  }
});
reset.addEventListener('click', () => {
  window.clearTimeout(timer); stage = 0;
  document.querySelector('#todo-slot').append(document.querySelector('[data-task="review"]'));
  document.querySelector('#doing-slot').append(document.querySelector('[data-task="build"]'));
  document.querySelector('#todo-count').textContent = '1';
  document.querySelector('#doing-count').textContent = '1';
  document.querySelector('#done-count').textContent = '1';
  status.innerHTML = '<span class="status-dot"></span> Ready for a handoff.';
  play.innerHTML = 'Play a handoff <span aria-hidden="true">→</span>';
  play.hidden = false; play.disabled = false; reset.hidden = true; selectTask('build'); play.focus();
});
