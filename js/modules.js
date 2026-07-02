/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  modules.js
   Renders the parameter panel for each movement module.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── HTML builders ─────────────────────────────────────────────────────── */

  function sectionTitle(label) {
    return `<div class="section-title">${label}</div>`;
  }

  /** Slider row with label, range input, and live value display */
  function sliderRow(id, name, min, max, val, unit) {
    unit = unit || '';
    return `
      <div class="param-row">
        <span class="param-name">${name}</span>
        <input type="range" class="param-slider" id="${id}"
               min="${min}" max="${max}" value="${val}" step="1"
               data-unit="${unit}">
        <span class="param-value mono" id="${id}-val">${val}${unit}</span>
      </div>`;
  }

  /** Segmented control (pill group) */
  function segmented(id, options, activeVal) {
    const btns = options.map(([val, label]) =>
      `<button class="seg-btn${val === activeVal ? ' active' : ''}"
               data-seg="${id}" data-val="${val}">${label}</button>`
    ).join('');
    return `<div class="seg-control" id="${id}">${btns}</div>`;
  }

  function segRow(name, id, options, active) {
    return `
      <div class="param-row">
        <span class="param-name">${name}</span>
        ${segmented(id, options, active)}
      </div>`;
  }

  /* ── PERIMETRO ─────────────────────────────────────────────────────────── */
  function renderPerimetro() {
    return `
      ${sectionTitle('Movimento')}
      ${sliderRow('p-vel', 'Velocità', 0, 200, 60)}
      ${segRow('Direzione', 'p-dir',
        [['forward','Forward'], ['back','Back']],
        'forward')}
      ${segRow('Follow Action', 'p-fa',
        [['loop','Loop'], ['backandforth','Back & Forth']],
        'loop')}
    `;
  }

  /* ── SEGMENTO ──────────────────────────────────────────────────────────── */
  function renderSegmento() {
    return `
      ${sectionTitle('Velocità')}
      ${sliderRow('s-vmax', 'Max', 0, 200, 120)}
      ${sliderRow('s-vmin', 'Min', 0, 200,  40)}
      ${sectionTitle('Distanza')}
      ${sliderRow('s-dmax', 'Max', 0, 360, 90, '°')}
      ${sliderRow('s-dmin', 'Min', 0, 360, 20, '°')}
      ${sectionTitle('Comportamento')}
      ${segRow('Direzione', 's-dir',
        [['forward','→'], ['back','←'], ['backandforth','↔'], ['random','?']],
        'forward')}
    `;
  }

  /* ── TRAVERSA ──────────────────────────────────────────────────────────── */
  function renderTraversa() {
    return `
      ${sectionTitle('Velocità')}
      ${sliderRow('t-vmax', 'Max', 0, 200, 100)}
      ${sliderRow('t-vmin', 'Min', 0, 200,  30)}
      ${sectionTitle('Comportamento')}
      ${segRow('Direzione', 't-dir',
        [['wrap','Wrap'], ['back','Back'], ['random','Rand']],
        'wrap')}
      ${segRow('Opposizione', 't-opp',
        [['origine','Origine'], ['talete','Talete']],
        'origine')}
    `;
  }

  /* ── ALEATORIO ─────────────────────────────────────────────────────────── */
  function renderAleatorio() {
    return `
      ${sectionTitle('Velocità')}
      ${sliderRow('a-vmax', 'Max', 0, 200, 80)}
      ${sliderRow('a-vmin', 'Min', 0, 200, 20)}
      ${sectionTitle('Distribuzione')}
      ${sliderRow('a-spread', 'Spread', 0, 100, 30, '%')}
      ${segRow('Tipologia', 'a-tipo',
        [['random','Random'], ['drunk','Drunk'], ['poiss','Poiss']],
        'random')}
      ${sliderRow('a-mint', 'Min Transfer', 0, 180, 30, '°')}
    `;
  }

  /* ── Render + bind events ──────────────────────────────────────────────── */
  function renderModule(name) {
    const container = document.getElementById('module-params');
    if (!container) return;

    const renderers = {
      perimetro: renderPerimetro,
      segmento:  renderSegmento,
      traversa:  renderTraversa,
      aleatorio: renderAleatorio,
    };

    const fn = renderers[name];
    if (!fn) return;

    container.innerHTML = fn();
    bindSliders(container);
    bindSegmented(container, name);
    updateReadheadForModule(name);
  }

  /* ── Bind sliders ──────────────────────────────────────────────────────── */
  function bindSliders(container) {
    container.querySelectorAll('input[type="range"]').forEach(slider => {
      const valEl = document.getElementById(slider.id + '-val');
      if (!valEl) return;
      const unit = slider.dataset.unit || '';
      slider.addEventListener('input', () => {
        valEl.textContent = slider.value + unit;
      });
    });
  }

  /* ── Bind segmented controls ───────────────────────────────────────────── */
  function bindSegmented(container, moduleName) {
    container.querySelectorAll('.seg-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const segId = btn.dataset.seg;
        const group = document.getElementById(segId);
        if (group) {
          group.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }

        // Traversa opposition → update circle ghost
        if (segId === 't-opp' && window.CircleState && window.CircleAPI) {
          window.CircleState.ghostOpposition = btn.dataset.val;
          window.CircleAPI.draw();
        }
      });
    });
  }

  /* ── Readhead adjustments per module ───────────────────────────────────── */
  function updateReadheadForModule(name) {
    const easeEl   = document.getElementById('rh-ease');
    const randBtns = document.querySelectorAll('.rh-rand-btn');

    if (!easeEl) return;

    if (name === 'segmento') {
      // Add random ease option if missing
      if (!easeEl.querySelector('[value="random"]')) {
        const opt = document.createElement('option');
        opt.value = 'random';
        opt.textContent = '?  random';
        easeEl.appendChild(opt);
      }
      randBtns.forEach(b => { b.style.display = 'inline-flex'; });
    } else {
      const randOpt = easeEl.querySelector('[value="random"]');
      if (randOpt) randOpt.remove();
      randBtns.forEach(b => { b.style.display = 'none'; });
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────── */
  window.ModulesAPI = { renderModule };

  document.addEventListener('DOMContentLoaded', () => {
    window.ModulesAPI.renderModule('perimetro');
  });
})();
