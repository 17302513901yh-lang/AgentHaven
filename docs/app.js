'use strict';
const cards = [...document.querySelectorAll('.task-card')];
const detail = document.querySelector('#task-detail');
const status = document.querySelector('#demo-status');
const play = document.querySelector('#handoff-demo');
const reset = document.querySelector('#reset-demo');
const details = {
build: '<span class="detail-author"><span class="mini-avatar peach">B</span> Bouwer · voor de reviewer</span><blockquote>“De opzet staat klaar. Wil jij kijken of de taakstatussen duidelijk genoeg zijn?”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> werkbord-opzet.md <span aria-hidden="true">↗</span></div>',
review: '<span class="detail-author"><span class="mini-avatar lime">R</span> Reviewer · voor de bouwer</span><blockquote>“Ik kijk naar de duidelijkheid van de taken. De afspraken van de planner neem ik mee in mijn review.”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> review-notities.md <span aria-hidden="true">↗</span></div>',
plan: '<span class="detail-author"><span class="mini-avatar lilac">P</span> Planner · voor het team</span><blockquote>“Begin klein: één project, drie taakstatussen en een plek voor uitleg. De bouwer kan hiermee aan de slag.”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> projectafspraken.md <span aria-hidden="true">↗</span></div>'
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
    status.innerHTML = '<span class="status-dot"></span> Bouwer legt de context klaar…';
    timer = window.setTimeout(() => {
      document.querySelector('#done-slot').append(document.querySelector('[data-task="build"]'));
      document.querySelector('#doing-slot').append(document.querySelector('[data-task="review"]'));
      document.querySelector('#todo-count').textContent = '0';
      document.querySelector('#done-count').textContent = '2';
      selectTask('review');
      status.innerHTML = '<span class="status-dot"></span> Reviewer gaat verder met de gedeelde context.';
      play.innerHTML = 'Rond de review af <span aria-hidden="true">→</span>';
      play.disabled = false; reset.hidden = false;
    }, 1100);
  } else {
    document.querySelector('#done-slot').append(document.querySelector('[data-task="review"]'));
    document.querySelector('#doing-count').textContent = '0';
    document.querySelector('#done-count').textContent = '3';
    status.innerHTML = '<span class="status-dot"></span> Samen afgerond. De kennis blijft bij het project.';
    detail.innerHTML = '<span class="detail-author"><span class="mini-avatar lime">R</span> Reviewer · voor het team</span><blockquote>“De aanpak is helder. Mijn opmerkingen staan bij het project, zodat we de volgende keer kunnen verderbouwen.”</blockquote><div class="context-file"><span aria-hidden="true">≡</span> review-afgerond.md <span aria-hidden="true">↗</span></div>';
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
  status.innerHTML = '<span class="status-dot"></span> Klaar voor een overdracht.';
  play.innerHTML = 'Speel overdracht af <span aria-hidden="true">→</span>';
  play.hidden = false; play.disabled = false; reset.hidden = true; selectTask('build'); play.focus();
});
