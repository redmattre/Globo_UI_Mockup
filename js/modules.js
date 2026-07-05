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
  // Velocità, direzione e loop sono ora unificate nella barra in basso.
  function renderPerimetro() {
    return '';
  }

  /* ── SEGMENTO ──────────────────────────────────────────────────────────── */
  function renderSegmento() {
    return `
      ${sectionTitle('Distanza')}
      ${sliderRow('s-dmax', 'Max', 0, 360, 90, '°')}
      ${sliderRow('s-dmin', 'Min', 0, 360, 20, '°')}
    `;
  }

  /* ── TRAVERSA ──────────────────────────────────────────────────────────── */
  function renderTraversa() {
    return `
      ${sectionTitle('Comportamento')}
      ${segRow('Opposizione', 't-opp',
        [['origine','Origine'], ['talete','Talete']],
        'origine')}
    `;
  }

  /* ── ALEATORIO ─────────────────────────────────────────────────────────── */
  function renderAleatorio() {
    return `
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
        if (window.ArcsAPI) window.ArcsAPI.autosave();
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
        if (window.ArcsAPI) window.ArcsAPI.autosave();
      });
    });
  }

  /* ── Snapshot / restore the current module's own parameters ─────────────── */
  function snapshotModuleParams() {
    const container = document.getElementById('module-params');
    const snap = {};
    if (!container) return snap;
    container.querySelectorAll('input[type="range"]').forEach(el => {
      snap[el.id] = el.value;
    });
    container.querySelectorAll('.seg-control').forEach(group => {
      const active = group.querySelector('.seg-btn.active');
      if (active) snap[group.id] = active.dataset.val;
    });
    return snap;
  }

  function applyModuleParams(snap) {
    const container = document.getElementById('module-params');
    if (!container || !snap) return;
    Object.keys(snap).forEach(key => {
      const el = document.getElementById(key);
      if (!el) return;
      if (el.tagName === 'INPUT' && el.type === 'range') {
        el.value = snap[key];
        const valEl = document.getElementById(key + '-val');
        if (valEl) valEl.textContent = snap[key] + (el.dataset.unit || '');
      } else if (el.classList.contains('seg-control')) {
        el.querySelectorAll('.seg-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.val === snap[key]);
        });
        if (key === 't-opp' && window.CircleState) {
          window.CircleState.ghostOpposition = snap[key];
        }
      }
    });
  }

  /* ── Readhead adjustments per module ───────────────────────────────────── */
  function updateReadheadForModule(name) {
    const menu     = document.getElementById('rh-ease-menu');
    const randBtns = document.querySelectorAll('.rh-rand-btn');

    if (!menu) return;

    if (name === 'segmento') {
      // Add random ease choice if missing
      if (!menu.querySelector('[data-ease="random"]')) {
        const opt = document.createElement('button');
        opt.className = 'rh-ease-choice';
        opt.dataset.ease = 'random';
        opt.textContent = '? random';
        menu.appendChild(opt);
      }
      randBtns.forEach(b => { b.style.display = 'inline-flex'; });
    } else {
      const randOpt = menu.querySelector('[data-ease="random"]');
      if (randOpt) {
        const wasActive = randOpt.classList.contains('active');
        randOpt.remove();
        if (wasActive && window.AppBridge) window.AppBridge.setEaseChoice('in');
      }
      randBtns.forEach(b => { b.style.display = 'none'; });
    }
  }

  /* ── Public API ────────────────────────────────────────────────────────── */
  window.ModulesAPI = { renderModule, snapshotModuleParams, applyModuleParams };

  document.addEventListener('DOMContentLoaded', () => {
    window.ModulesAPI.renderModule('perimetro');
  });
})();
