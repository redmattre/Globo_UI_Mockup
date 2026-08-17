/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  modules.js
   Renders the parameter panel for each movement module.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── HTML builders ─────────────────────────────────────────────────────── */

  /** Slider row with label, range input, and live value display. The unit
   *  is its own tight suffix after the number (see .unit-suffix in
   *  components.css) rather than appended straight onto the value text. */
  function sliderRow(id, name, min, max, val, unit, tooltip) {
    unit = unit || '';
    return `
      <div class="param-row">
        <span class="param-name"${tooltip ? ` title="${tooltip}"` : ''}>${name}</span>
        <input type="range" class="param-slider" id="${id}"
               min="${min}" max="${max}" value="${val}" step="1"
               data-unit="${unit}">
        <span class="param-value mono"><span id="${id}-val">${val}</span><span class="unit-suffix">${unit}</span></span>
      </div>`;
  }

  /** Double-slider row: two independent handles on one track (min/max of a
   *  range), same visual as the persistent Speed control above this panel
   *  (see .dslider-track in components.css) but a plain linear range — no
   *  exponential curve/merge/lock, those are Speed-specific (initSpeedRange
   *  in app.js). Values shown together on the right, dash-joined, with the
   *  unit shown once as a tight suffix rather than repeated per number. */
  function doubleSliderRow(id, name, min, max, valLo, valHi, unit, tooltip) {
    unit = unit || '';
    return `
      <div class="param-row">
        <span class="param-name"${tooltip ? ` title="${tooltip}"` : ''}>${name}</span>
        <div class="dslider-track" id="${id}-track"
             data-min="${min}" data-max="${max}" data-unit="${unit}"
             data-lo="${valLo}" data-hi="${valHi}">
          <div class="dslider-fill" id="${id}-fill"></div>
          <div class="dslider-thumb" id="${id}-thumb-lo" title="Minimo"></div>
          <div class="dslider-thumb" id="${id}-thumb-hi" title="Massimo"></div>
        </div>
        <span class="param-value mono dslider-val" id="${id}-val"><span>${valLo}</span><span class="dslider-sep">–</span><span>${valHi}</span><span class="unit-suffix">${unit}</span></span>
      </div>`;
  }

  /** Single-thumb exponential slider — same low-end-fine/high-end-coarse
   *  curve and ms/s unit-switching as the persistent Rate/Speed control
   *  (see initSpeedRange in app.js), just one handle instead of two.
   *  Reuses the double-slider's track/fill/thumb look (see .dslider-track
   *  in components.css) — the fill just grows from the left edge up to
   *  the single thumb, like a plain fader — via the extra .exp-track hook
   *  class, which is what tells bindDoubleSliders to leave it alone (see
   *  bindExpSliders below). opts.zeroInf shows "∞" at 0 instead of "0ms"
   *  (Trail Decay: no decay at all). */
  function expSliderRow(id, name, max, val, opts) {
    opts = opts || {};
    const zeroInf = !!opts.zeroInf;
    const tooltip = opts.tooltip;
    return `
      <div class="param-row">
        <span class="param-name"${tooltip ? ` title="${tooltip}"` : ''}>${name}</span>
        <div class="dslider-track exp-track" id="${id}-track"
             data-max="${max}" data-val="${val}" data-zero-inf="${zeroInf ? '1' : ''}">
          <div class="dslider-fill" id="${id}-fill"></div>
          <div class="dslider-thumb" id="${id}-thumb"></div>
        </div>
        <span class="param-value mono" id="${id}-val"></span>
      </div>`;
  }

  /** Toggle / Multitoggle row: same widget either way — a toggle IS a
   *  multitoggle with exactly two options (see .mtoggle in components.css).
   *  The segments carry no text; the active choice's own label shows in
   *  the value slot on the right instead, same spot every other row type
   *  shows its value in. */
  function toggleRow(name, id, options, activeVal, tooltip) {
    const segs = options.map(o =>
      `<button class="mtoggle-seg${o.key === activeVal ? ' active' : ''}"
               data-val="${o.key}" data-label="${o.label}" title="${o.label}"></button>`
    ).join('');
    const activeOpt = options.find(o => o.key === activeVal) || options[0] || { label: '' };
    return `
      <div class="param-row">
        <span class="param-name"${tooltip ? ` title="${tooltip}"` : ''}>${name}</span>
        <div class="mtoggle" id="${id}">${segs}</div>
        <span class="param-value mono" id="${id}-val">${activeOpt.label}</span>
      </div>`;
  }

  /* ── PERIMETRO ─────────────────────────────────────────────────────────── */
  // Rate (position-transfer speed) is the shared persistent Speed control,
  // just relabelled while this paradigm is active too — see the
  // switchModule label swap in app.js (same as Aleatorio's Rate).
  // Transfer Ease/Transfer Decay only mean anything if the point actually
  // crosses a zone boundary as it goes around — see updateArcButtons in
  // arcs.js, which greys both rows out only when there's a single active
  // zone spanning the full 360° (no boundary at all). With more than one
  // zone there's always a boundary somewhere, so both stay enabled.
  function renderPerimetro() {
    return `
      ${sliderRow('p-trail', 'Trail', 0, 360, 90, '°')}
      ${expSliderRow('p-trail-decay', 'Trail Decay', 10000, 0, { zeroInf: true })}
      ${expSliderRow('p-transfer-ease', 'Transfer Ease', 10000, 200)}
      ${toggleRow('Transfer Decay', 'p-transfer-decay', [
        { key: 'none', label: 'None' },
        { key: '1.5x', label: '1.5x' },
        { key: '2x',   label: '2x'   },
        { key: '4x',   label: '4x'   },
      ], 'none')}
    `;
  }

  /* ── SEGMENTO ──────────────────────────────────────────────────────────── */
  function renderSegmento() {
    return doubleSliderRow('s-span', 'Ampiezza', 0, 360, 20, 90, '°');
  }

  /* ── TRAVERSA ──────────────────────────────────────────────────────────── */
  function renderTraversa() {
    return toggleRow('Opposizione', 't-opp', [
      { key: 'origine', label: 'Origine' },
      { key: 'talete',  label: 'Talete'  },
    ], 'origine');
  }

  /* ── ALEATORIO ─────────────────────────────────────────────────────────── */
  // Rate (the position-transfer speed) is the shared persistent Speed
  // control, just relabelled while this paradigm is active — see the
  // switchModule label swap in app.js.
  function renderAleatorio() {
    return `
      ${sliderRow('a-smooth', 'Smooth', 0, 100, 50, '%',
        'Smoothness of transition time between random positions')}
      ${sliderRow('a-step-az', 'Step Azimuth', 0, 100, 50, '%',
        'Minimum transfer step in percentage of azimutal header')}
      ${sliderRow('a-step-el', 'Step Elevation', 0, 100, 50, '%',
        'Minimum transfer step in percentage of elevation header')}
      ${sliderRow('a-lock-speaker', 'Lock on Spks', 0, 100, 0, '%',
        'anchor the randomness to the speakers positions in percentage')}
      ${toggleRow('Type', 'a-type', [
        { key: 'white', label: 'White' },
        { key: 'pink',  label: 'Pink'  },
        { key: 'poiss', label: 'Poiss' },
      ], 'white')}
    `;
  }

  /* ── DIRETTO ───────────────────────────────────────────────────────────── */
  // No movement: sound is spread statically across the drawn arcs, so the
  // readhead, spat selector and transport controls are all disabled.
  function renderDiretto() {
    return `<div class="empty-hint">Nessun movimento — il suono è distribuito staticamente sugli archi disegnati sul cerchio.</div>`;
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
      diretto:   renderDiretto,
    };

    const fn = renderers[name];
    if (!fn) return;

    container.innerHTML = fn();
    bindSliders(container);
    bindDoubleSliders(container);
    bindExpSliders(container);
    bindToggles(container);
    updateReadheadForModule(name);
  }

  /* ── Bind sliders ──────────────────────────────────────────────────────── */
  function bindSliders(container) {
    container.querySelectorAll('input[type="range"]').forEach(slider => {
      const valEl = document.getElementById(slider.id + '-val');
      if (!valEl) return;
      // Unit lives in its own static .unit-suffix sibling now, not appended
      // to this number on every input — see sliderRow above.
      slider.addEventListener('input', () => {
        valEl.textContent = slider.value;
        if (window.ArcsAPI) window.ArcsAPI.autosave();
      });
    });
  }

  /* ── Bind double sliders (see doubleSliderRow) ───────────────────────────
     Plain linear drag, no exponential curve/merge/lock (that's Speed-
     specific, see initSpeedRange in app.js). Uses pointer capture on the
     track itself so a single set of listeners handles both thumbs and the
     track-click-to-jump case, with no window-level listeners to worry
     about leaking across paradigm switches (this whole container gets torn
     down and rebuilt on every renderModule() call). */
  function bindDoubleSliders(container) {
    // .exp-track is the single-thumb variant (see bindExpSliders below) —
    // it reuses this same .dslider-track look but has its own bind logic.
    container.querySelectorAll('.dslider-track:not(.exp-track)').forEach(track => {
      const id      = track.id.replace(/-track$/, '');
      const fill    = document.getElementById(id + '-fill');
      const thumbLo = document.getElementById(id + '-thumb-lo');
      const thumbHi = document.getElementById(id + '-thumb-hi');
      const valEl   = document.getElementById(id + '-val');
      if (!fill || !thumbLo || !thumbHi || !valEl) return;

      const min  = parseFloat(track.dataset.min);
      const max  = parseFloat(track.dataset.max);
      const unit = track.dataset.unit || '';
      let lo = parseFloat(track.dataset.lo);
      let hi = parseFloat(track.dataset.hi);
      let dragging = null; // 'lo' | 'hi' | null

      function pct(v) { return ((v - min) / (max - min)) * 100; }

      function render() {
        const pLo = pct(lo), pHi = pct(hi);
        thumbLo.style.left = pLo + '%';
        thumbHi.style.left = pHi + '%';
        fill.style.left  = pLo + '%';
        fill.style.width = (pHi - pLo) + '%';
        valEl.innerHTML = `<span>${Math.round(lo)}</span><span class="dslider-sep">–</span><span>${Math.round(hi)}</span><span class="unit-suffix">${unit}</span>`;
        track.dataset.lo = lo;
        track.dataset.hi = hi;
      }

      function valueFromEvent(e) {
        const rect = track.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        return min + (x / rect.width) * (max - min);
      }

      function moveTo(v) {
        if (dragging === 'lo') lo = Math.max(min, Math.min(v, hi));
        else if (dragging === 'hi') hi = Math.min(max, Math.max(v, lo));
        render();
      }

      function startDrag(which, e) {
        dragging = which;
        track.setPointerCapture(e.pointerId);
        moveTo(valueFromEvent(e));
        e.preventDefault();
      }

      thumbLo.addEventListener('pointerdown', e => { startDrag('lo', e); e.stopPropagation(); });
      thumbHi.addEventListener('pointerdown', e => { startDrag('hi', e); e.stopPropagation(); });
      track.addEventListener('pointerdown', e => {
        if (e.target === thumbLo || e.target === thumbHi) return;
        const v = valueFromEvent(e);
        startDrag(Math.abs(v - lo) <= Math.abs(v - hi) ? 'lo' : 'hi', e);
      });
      track.addEventListener('pointermove', e => { if (dragging) moveTo(valueFromEvent(e)); });
      track.addEventListener('pointerup', () => {
        if (dragging && window.ArcsAPI) window.ArcsAPI.autosave();
        dragging = null;
      });

      render();
    });
  }

  /* ── Bind single-thumb exponential sliders (see expSliderRow) ────────────
     Same curve/unit-switching idea as the persistent Rate/Speed control
     (initSpeedRange in app.js), reimplemented locally rather than shared —
     that one also handles the merge/lock behaviour this doesn't need, and
     the two live in different files with no shared module to import from.
     Pointer capture on the track, same leak-free pattern as
     bindDoubleSliders. */
  function bindExpSliders(container) {
    const CURVE = 5.2;
    container.querySelectorAll('.exp-track').forEach(track => {
      const id    = track.id.replace(/-track$/, '');
      const fill  = document.getElementById(id + '-fill');
      const thumb = document.getElementById(id + '-thumb');
      const valEl = document.getElementById(id + '-val');
      if (!fill || !thumb || !valEl) return;

      const absMax  = parseFloat(track.dataset.max);
      const zeroInf = track.dataset.zeroInf === '1';
      let val = parseFloat(track.dataset.val);
      let dragging = false;

      function valueToT(v) {
        return Math.pow(Math.max(0, Math.min(1, v / absMax)), 1 / CURVE);
      }
      function tToValue(t) {
        return absMax * Math.pow(Math.max(0, Math.min(1, t)), CURVE);
      }

      /** Below 1000ms it's a plain integer; at/above it's seconds with one
       *  decimal — same convention as the persistent Rate/Speed control.
       *  0 reads as "∞" instead of "0ms" when zeroInf is set (Trail Decay:
       *  nothing ever decays). */
      function format(v) {
        const rounded = Math.round(v);
        if (zeroInf && rounded === 0) return { text: '∞', unit: '' };
        return rounded >= 1000
          ? { text: (rounded / 1000).toFixed(1), unit: 's' }
          : { text: String(rounded), unit: 'ms' };
      }

      function render() {
        const p = valueToT(val) * 100;
        thumb.style.left = p + '%';
        fill.style.left  = '0%';
        fill.style.width = p + '%';
        const f = format(val);
        valEl.innerHTML = `<span>${f.text}</span><span class="unit-suffix">${f.unit}</span>`;
        track.dataset.val = val;
      }

      function valueFromEvent(e) {
        const rect = track.getBoundingClientRect();
        const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        return tToValue(x / rect.width);
      }

      function startDrag(e) {
        dragging = true;
        track.setPointerCapture(e.pointerId);
        val = valueFromEvent(e);
        render();
        e.preventDefault();
      }

      thumb.addEventListener('pointerdown', e => { startDrag(e); e.stopPropagation(); });
      track.addEventListener('pointerdown', e => {
        if (e.target === thumb) return;
        startDrag(e);
      });
      track.addEventListener('pointermove', e => { if (dragging) { val = valueFromEvent(e); render(); } });
      track.addEventListener('pointerup', () => {
        if (dragging && window.ArcsAPI) window.ArcsAPI.autosave();
        dragging = false;
      });

      render();
    });
  }

  /* ── Bind toggle / multitoggle controls (see toggleRow) ──────────────────
     Same handler either way — a toggle is just a multitoggle with two
     segments. Updates the active segment plus the value slot on the right. */
  function bindToggles(container) {
    container.querySelectorAll('.mtoggle').forEach(group => {
      const valEl = document.getElementById(group.id + '-val');
      group.querySelectorAll('.mtoggle-seg').forEach(seg => {
        seg.addEventListener('click', () => {
          group.querySelectorAll('.mtoggle-seg').forEach(s => s.classList.remove('active'));
          seg.classList.add('active');
          if (valEl) valEl.textContent = seg.dataset.label || '';

          // Traversa opposition → update circle ghost
          if (group.id === 't-opp' && window.CircleState && window.CircleAPI) {
            window.CircleState.ghostOpposition = seg.dataset.val;
            window.CircleAPI.draw();
          }
          if (window.ArcsAPI) window.ArcsAPI.autosave();
        });
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
    container.querySelectorAll('.dslider-track:not(.exp-track)').forEach(track => {
      const id = track.id.replace(/-track$/, '');
      snap[id] = { lo: parseFloat(track.dataset.lo), hi: parseFloat(track.dataset.hi) };
    });
    container.querySelectorAll('.exp-track').forEach(track => {
      const id = track.id.replace(/-track$/, '');
      snap[id] = parseFloat(track.dataset.val);
    });
    container.querySelectorAll('.mtoggle').forEach(group => {
      const active = group.querySelector('.mtoggle-seg.active');
      if (active) snap[group.id] = active.dataset.val;
    });
    return snap;
  }

  function applyModuleParams(snap) {
    const container = document.getElementById('module-params');
    if (!container || !snap) return;
    Object.keys(snap).forEach(key => {
      const el = document.getElementById(key);
      if (el && el.tagName === 'INPUT' && el.type === 'range') {
        el.value = snap[key];
        // Unit lives in its own static .unit-suffix sibling now, not here.
        const valEl = document.getElementById(key + '-val');
        if (valEl) valEl.textContent = snap[key];
        return;
      }
      const track = document.getElementById(key + '-track');
      if (track && track.classList.contains('exp-track') && typeof snap[key] === 'number') {
        const absMax  = parseFloat(track.dataset.max);
        const zeroInf = track.dataset.zeroInf === '1';
        const CURVE   = 5.2;
        const val = snap[key];
        track.dataset.val = val;
        const p = Math.pow(Math.max(0, Math.min(1, val / absMax)), 1 / CURVE) * 100;
        const fill  = document.getElementById(key + '-fill');
        const thumb = document.getElementById(key + '-thumb');
        const valEl = document.getElementById(key + '-val');
        if (thumb) thumb.style.left = p + '%';
        if (fill)  { fill.style.left = '0%'; fill.style.width = p + '%'; }
        if (valEl) {
          const rounded = Math.round(val);
          const f = (zeroInf && rounded === 0)
            ? { text: '∞', unit: '' }
            : rounded >= 1000
              ? { text: (rounded / 1000).toFixed(1), unit: 's' }
              : { text: String(rounded), unit: 'ms' };
          valEl.innerHTML = `<span>${f.text}</span><span class="unit-suffix">${f.unit}</span>`;
        }
        return;
      }
      if (track && snap[key] && typeof snap[key] === 'object') {
        const min  = parseFloat(track.dataset.min);
        const max  = parseFloat(track.dataset.max);
        const unit = track.dataset.unit || '';
        const lo = snap[key].lo, hi = snap[key].hi;
        track.dataset.lo = lo;
        track.dataset.hi = hi;
        const pct = v => ((v - min) / (max - min)) * 100;
        const fill    = document.getElementById(key + '-fill');
        const thumbLo = document.getElementById(key + '-thumb-lo');
        const thumbHi = document.getElementById(key + '-thumb-hi');
        const valEl   = document.getElementById(key + '-val');
        if (thumbLo) thumbLo.style.left = pct(lo) + '%';
        if (thumbHi) thumbHi.style.left = pct(hi) + '%';
        if (fill) { fill.style.left = pct(lo) + '%'; fill.style.width = (pct(hi) - pct(lo)) + '%'; }
        if (valEl) valEl.innerHTML = `<span>${Math.round(lo)}</span><span class="dslider-sep">–</span><span>${Math.round(hi)}</span><span class="unit-suffix">${unit}</span>`;
        return;
      }
      if (el && el.classList.contains('mtoggle')) {
        el.querySelectorAll('.mtoggle-seg').forEach(s => {
          s.classList.toggle('active', s.dataset.val === snap[key]);
        });
        const valEl = document.getElementById(key + '-val');
        const activeSeg = el.querySelector('.mtoggle-seg.active');
        if (valEl && activeSeg) valEl.textContent = activeSeg.dataset.label || '';
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
