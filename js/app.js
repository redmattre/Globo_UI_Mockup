/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  app.js
   Application state, navigation, overlay panel, readhead, height slider,
   slave indicator, secondary-panel content renderers.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── App state ─────────────────────────────────────────────────────────── */
  const state = {
    currentModule:   'perimetro',
    currentSettings: 'rig',
    secondaryOpen:   false,
    instanceNumber:  1,
    slaveGroup:      2,     // 0 = standalone; N = N diagonal lines shown
    gsState: { audio: 'global', rig: 'stray', generali: 'global' },
    readheadPos:     0.,  // 0 to 1
    activeReadhead:  'A',    // which readhead's ease settings are shown/edited right now
    ease: {                  // separate ease curve per readhead — A actually drives
      A: { type: 'in', intensity: 0 },   // playback easing; H's is stored for later use
      H: { type: 'in', intensity: 0 },
    },
    playing:         false,
  };

  const PLAY_CYCLE_MS = 4000; // 0 -> 1 sweep duration, then loops back to 0
  let playRAF   = null;
  let playStart = null;

  /* ═══════════════════════════════════════════════════════════════════════
     PANEL NAVIGATION
  ════════════════════════════════════════════════════════════════════════ */
  function openSecondary() {
    state.secondaryOpen = true;
    const p = document.getElementById('secondary-panel');
    if (p) p.removeAttribute('hidden');
    document.getElementById('logo-btn')?.classList.add('active');
    renderSettings(state.currentSettings);
    syncGSToggle();
  }

  function closeSecondary() {
    state.secondaryOpen = false;
    const p = document.getElementById('secondary-panel');
    if (p) p.setAttribute('hidden', '');
    document.getElementById('logo-btn')?.classList.remove('active');
  }

  function toggleSecondary() {
    state.secondaryOpen ? closeSecondary() : openSecondary();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MODULE TABS
  ════════════════════════════════════════════════════════════════════════ */
  function switchModule(name, opts) {
    state.currentModule = name;
    document.querySelectorAll('#module-tabs .tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.module === name);
    });
    if (window.ModulesAPI) window.ModulesAPI.renderModule(name);
    if (window.CircleAPI)  window.CircleAPI.setModule(name);
    // Perimetro has a single speed — lock the min handle to 0
    if (window.SpeedRangeAPI) window.SpeedRangeAPI.setLocked(name === 'perimetro');
    // Diretto spreads sound statically over the drawn arcs — no position to
    // read, no spat algorithm to pick, nothing to transport.
    setDirettoMode(name === 'diretto');
    // Skipped while a preset is being restored — it would otherwise overwrite
    // the very slot we're in the middle of applying.
    if (!(opts && opts.skipAutosave) && window.ArcsAPI) window.ArcsAPI.autosave();
  }

  /** Diretto has no movement: dim + block interaction on the readhead, the
   *  spat selector and the whole transport footer (speed + loop/direction/play). */
  function setDirettoMode(active) {
    const readhead = document.getElementById('readhead-bar');
    const spatSelect = document.getElementById('spat-select');
    const footer = document.querySelector('.params-footer');
    [readhead, spatSelect, footer].forEach(el => {
      if (el) el.classList.toggle('disabled-ui', active);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SETTINGS TABS
  ════════════════════════════════════════════════════════════════════════ */
  function switchSettings(name) {
    state.currentSettings = name;
    document.querySelectorAll('#settings-tabs .tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.settings === name);
    });
    renderSettings(name);
    syncGSToggle();
  }

  function syncGSToggle() {
    const toggle = document.getElementById('gs-toggle');
    if (!toggle) return;
    const current = state.gsState[state.currentSettings] || 'global';
    toggle.querySelectorAll('.gs-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.gs === current);
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SECONDARY PANEL CONTENT RENDERERS
  ════════════════════════════════════════════════════════════════════════ */
  function renderSettings(tab) {
    const body = document.getElementById('settings-body');
    if (!body) return;
    const map = { audio: renderAudio, rig: renderRig, generali: renderGenerali };
    const fn = map[tab];
    if (fn) {
      body.innerHTML = fn();
      bindSettingsEvents(tab);
    }
  }

  /* ── Audio tab ─────────────────────────────────────────────────────────── */
  const AUDIO_TYPES = [
    { key: 'dbap',       label: 'DBAP' },
    { key: 'vbap',       label: 'VBAP' },
    { key: 'ambisonics', label: 'AmbiV' },
    { key: 'soundscape', label: 'Soundscape' },
  ];

  // Mockup parameters — distinct per algorithm, purely visual (no real DSP behind them)
  const AUDIO_PARAMS = {
    dbap: [
      { id: 'au-rolloff', name: 'Rolloff', min: 0, max: 100, val: 60, unit: '%' },
      { id: 'au-blur',    name: 'Blur',    min: 0, max: 100, val: 20, unit: '%' },
      { id: 'au-weight',  name: 'Weight',  min: 0, max: 100, val: 50, unit: '%' },
    ],
    vbap: [
      { id: 'au-spread', name: 'Spread', min: 0, max: 100, val: 30, unit: '%' },
      { id: 'au-focus',  name: 'Focus',  min: 0, max: 100, val: 70, unit: '%' },
      { id: 'au-fade',   name: 'Fade',   min: 0, max: 100, val: 40, unit: '%' },
    ],
    ambisonics: [
      { id: 'au-order', name: 'Order', min: 1, max: 7, val: 3, unit: '' },
    ],
    soundscape: [
      { id: 'au-gain',    name: 'Gain',     min: 0, max: 100, val: 80, unit: '' },
      { id: 'au-doppler', name: 'Doppler',  min: 0, max: 100, val: 0,  unit: '%' },
      { id: 'au-air',     name: 'Air Abs.', min: 0, max: 100, val: 20, unit: '%' },
    ],
  };

  function currentSpatKey() {
    const active = document.querySelector('#spat-menu .spat-choice.active');
    return (active && AUDIO_PARAMS[active.dataset.spat]) ? active.dataset.spat : 'vbap';
  }

  function renderAudioParams(key) {
    return (AUDIO_PARAMS[key] || []).map(p => `
      <div class="param-row">
        <span class="param-name">${p.name}</span>
        <input type="range" class="param-slider" id="${p.id}" min="${p.min}" max="${p.max}" value="${p.val}" data-unit="${p.unit}">
        <span class="param-value mono" id="${p.id}-val">${p.val}${p.unit}</span>
      </div>`).join('');
  }

  function renderAudio() {
    const active = currentSpatKey();
    return `
      <div class="settings-left audio-left">
        <ul class="spat-list">
          ${AUDIO_TYPES.map(t =>
            `<li class="spat-item${t.key === active ? ' active' : ''}" data-spat="${t.key}">${t.label}</li>`
          ).join('')}
        </ul>
      </div>
      <div class="settings-right audio-right">
        <div id="audio-params">${renderAudioParams(active)}</div>
      </div>`;
  }

  /* ── Rig tab (roster, position editor, subsets — implemented in rig.js) ─── */
  function renderRig() {
    return window.RigAPI ? window.RigAPI.render() : '';
  }

  /* ── Generali tab ──────────────────────────────────────────────────────── */
  // Rows mirror the Rig speaker roster (each speaker needs a physical output);
  // one output column per speaker, diagonal-routed by default.
  function renderGenerali() {
    const speakers = window.RigAPI ? window.RigAPI.getSpeakers() : [];
    const outputs  = speakers.map((_, i) => i + 1);

    const headerCells = outputs.map(o => `<span class="matrix-lbl mono" data-bus="${o}">${o}</span>`).join('');
    const rows = speakers.map((sp, ri) => {
      const cells = outputs.map((o, oi) =>
        `<button class="matrix-cell${ri === oi ? ' active' : ''}" data-ch="${sp.id}" data-bus="${o}"></button>`
      ).join('');
      return `
        <div class="matrix-row">
          <span class="matrix-lbl matrix-row-lbl mono" data-ch="${sp.id}">${sp.name}</span>
          ${cells}
        </div>`;
    }).join('');

    const interpMs = window.ArcsAPI ? window.ArcsAPI.getInterpolationTime() : 800;

    return `
      <div class="settings-left generali-left">
        <div class="param-row">
          <span class="param-name">Interpolation Switch Time</span>
          <input type="number" class="che-input param-numbox mono" id="g-interp-time" min="0" max="10000" step="50" value="${interpMs}">
          <span class="param-value mono">ms</span>
        </div>
        <div class="param-row wrap">
          <span class="param-name">Lock Paradigms to Speaker Position</span>
          <button class="bool-toggle mono" id="g-lock-paradigms" title="Lock Paradigms to Speaker Position">OFF</button>
        </div>
      </div>
      <div class="settings-right generali-right">
        <div class="matrix-scroll">
          <div class="matrix-grid" id="generali-matrix">
            <div class="matrix-header"><span class="matrix-lbl matrix-corner"></span>${headerCells}</div>
            ${rows}
          </div>
        </div>
      </div>`;
  }

  /* ── Bind settings events (sliders, spat list, matrix) ─────────────────── */
  function bindRangeSliders(container) {
    container.querySelectorAll('input[type="range"]').forEach(slider => {
      const valEl = document.getElementById(slider.id + '-val');
      if (!valEl) return;
      const unit = slider.dataset.unit || '';
      slider.addEventListener('input', () => { valEl.textContent = slider.value + unit; });
    });
  }

  function bindSettingsEvents(tab) {
    const body = document.getElementById('settings-body');
    if (!body) return;

    bindRangeSliders(body);

    // Spat list (Audio tab) — each type shows its own mockup parameters
    if (tab === 'audio') {
      body.querySelectorAll('.spat-item').forEach(item => {
        item.addEventListener('click', () => {
          body.querySelectorAll('.spat-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          // Mirror to main panel dropdown
          setSpatChoice(item.dataset.spat);
          const paramsEl = document.getElementById('audio-params');
          if (paramsEl) {
            paramsEl.innerHTML = renderAudioParams(item.dataset.spat);
            bindRangeSliders(paramsEl);
          }
        });
      });
    }

    // Output matrix (Generali tab) — click to toggle a routing, hover to
    // highlight the row/column so it's easier to read across a bigger grid
    if (tab === 'generali') {
      body.querySelectorAll('.matrix-cell').forEach(cell => {
        cell.addEventListener('click', () => cell.classList.toggle('active'));
      });
      const grid = document.getElementById('generali-matrix');
      if (grid) {
        grid.addEventListener('mouseover', e => {
          const cell = e.target.closest('.matrix-cell');
          if (!cell) return;
          const ch = cell.dataset.ch, bus = cell.dataset.bus;
          grid.querySelectorAll('.matrix-cell, .matrix-lbl').forEach(el => {
            el.classList.toggle('row-hover', el.dataset.ch === ch);
            el.classList.toggle('col-hover', el.dataset.bus === bus);
          });
        });
        grid.addEventListener('mouseleave', () => {
          grid.querySelectorAll('.row-hover, .col-hover').forEach(el => el.classList.remove('row-hover', 'col-hover'));
        });
      }

      const interpInput = document.getElementById('g-interp-time');
      if (interpInput) {
        interpInput.addEventListener('input', () => {
          const ms = Math.max(0, parseInt(interpInput.value, 10) || 0);
          if (window.ArcsAPI) window.ArcsAPI.setInterpolationTime(ms);
        });
      }

      // Mockup toggle — visual only, off by default
      const lockToggle = document.getElementById('g-lock-paradigms');
      if (lockToggle) {
        lockToggle.addEventListener('click', () => {
          const active = lockToggle.classList.toggle('active');
          lockToggle.textContent = active ? 'ON' : 'OFF';
        });
      }
    }

    // Rig tab: roster, position editor, subsets (own module — see rig.js)
    if (tab === 'rig' && window.RigAPI) window.RigAPI.bind();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     READHEAD
  ════════════════════════════════════════════════════════════════════════ */
  /** Maps t (0-1) through the chosen ease curve at given intensity (0-100). */
  function applyEase(t, type, intensity) {
    const k = 1 + 3 * (intensity / 100); // k=1 -> linear; k=4 -> strong curve
    switch (type) {
      case 'in':     return Math.pow(t, k);
      case 'out':    return 1 - Math.pow(1 - t, k);
      case 'double':
        return t < 0.5
          ? Math.pow(2 * t, k) / 2
          : 1 - Math.pow(2 * (1 - t), k) / 2;
      default:       return t;
    }
  }

  /** Reposition density dots to reflect the active readhead's ease type + intensity. */
  function updateDots() {
    const dotsEl = document.getElementById('rh-dots');
    if (!dotsEl) return;
    const dots = dotsEl.querySelectorAll('.rh-dot');
    const N    = dots.length;
    const ease = state.ease[state.activeReadhead];
    dots.forEach((dot, i) => {
      const rawT  = (i + 0.5) / N;
      const eased = applyEase(rawT, ease.type, ease.intensity);
      dot.style.left = (eased * 100).toFixed(2) + '%';
    });
  }

  /** Refresh the ease button/menu/force-slider/dots to reflect whichever
   *  readhead (A or H) is currently active — each keeps its own ease
   *  settings, so switching the A/H toggle swaps which one is shown here. */
  function syncEaseUIToActiveReadhead() {
    const ease = state.ease[state.activeReadhead];
    const btn  = document.getElementById('rh-ease-btn');
    const menu = document.getElementById('rh-ease-menu');
    if (btn) btn.dataset.ease = ease.type;
    if (menu) {
      menu.querySelectorAll('.rh-ease-choice').forEach(c => {
        c.classList.toggle('active', c.dataset.ease === ease.type);
      });
    }
    const forceEl    = document.getElementById('rh-force');
    const forceValEl = document.getElementById('rh-force-val');
    if (forceEl)    forceEl.value = ease.intensity;
    if (forceValEl) forceValEl.textContent = ease.intensity + '%';
    updateDots();
  }

  function initReadhead() {
    // Generate 15 density dots, positioned via JS
    const dotsEl = document.getElementById('rh-dots');
    if (dotsEl) {
      dotsEl.innerHTML = Array(15).fill('<span class="rh-dot"></span>').join('');
      updateDots();
    }

    const track   = document.getElementById('rh-track');
    const marker  = document.getElementById('rh-marker');
    const markerH = document.getElementById('rh-marker-h');
    if (!track || !marker) return;

    // A/H switch — which readhead is currently in control. The other one is
    // locked: neither a direct grab on its marker nor a click on the empty
    // track background will move it until it's switched back in.
    const switchBtn = document.getElementById('rh-switch-btn');
    function updateActiveReadheadVisual() {
      marker.classList.toggle('dim', state.activeReadhead !== 'A');
      if (markerH) markerH.classList.toggle('dim', state.activeReadhead !== 'H');
    }
    updateActiveReadheadVisual();
    syncEaseUIToActiveReadhead();
    if (switchBtn) {
      switchBtn.addEventListener('click', () => {
        state.activeReadhead = state.activeReadhead === 'A' ? 'H' : 'A';
        switchBtn.textContent = state.activeReadhead;
        updateActiveReadheadVisual();
        syncEaseUIToActiveReadhead();
      });
    }

    // Place marker at initial position
    setReadheadPos(state.readheadPos);

    // Drag — azimuth readhead (A)
    let dragging = false;
    marker.addEventListener('mousedown', e => {
      if (state.activeReadhead !== 'A') return;
      dragging = true; e.preventDefault();
    });
    track.addEventListener('mousedown', e => {
      if ((e.target === track || e.target === dotsEl) && state.activeReadhead === 'A') {
        dragging = true;
        moveMarker(e);
      }
    });
    window.addEventListener('mousemove', e => { if (dragging) moveMarker(e); });
    window.addEventListener('mouseup',   () => { dragging = false; });

    function moveMarker(e) {
      const rect = track.getBoundingClientRect();
      const x    = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      state.readheadPos = x / rect.width;
      setReadheadPos(state.readheadPos);
      applyReadheadToCircle(state.readheadPos);
    }

    // Drag — height readhead (H): reads 0–1 through the heightMin/heightMax
    // range of whichever arc the sound object is azimuthally inside right
    // now. Only the isometric view can show elevation, so this only ever
    // triggers a redraw there.
    if (markerH) {
      setHeightReadPos(window.CircleState ? window.CircleState.heightReadPos : 0);

      let draggingH = false;
      markerH.addEventListener('mousedown', e => {
        if (state.activeReadhead !== 'H') return;
        draggingH = true; e.preventDefault(); e.stopPropagation();
      });
      track.addEventListener('mousedown', e => {
        if ((e.target === track || e.target === dotsEl) && state.activeReadhead === 'H') {
          draggingH = true;
          moveMarkerH(e);
        }
      });
      window.addEventListener('mousemove', e => { if (draggingH) moveMarkerH(e); });
      window.addEventListener('mouseup',   () => { draggingH = false; });

      function moveMarkerH(e) {
        const rect = track.getBoundingClientRect();
        const x    = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        const pct  = x / rect.width;
        if (window.CircleState) window.CircleState.heightReadPos = pct;
        setHeightReadPos(pct);
        if (window.CircleIsoAPI && window.CircleIsoAPI.isActive()) window.CircleIsoAPI.draw();
      }
    }

    // Intensity slider — updates dots + circle in real time
    const forceEl    = document.getElementById('rh-force');
    const forceValEl = document.getElementById('rh-force-val');
    if (forceEl && forceValEl) {
      forceEl.addEventListener('input', () => {
        state.ease[state.activeReadhead].intensity = Number(forceEl.value);
        forceValEl.textContent = forceEl.value + '%';
        updateDots();
        if (state.activeReadhead === 'A') applyReadheadToCircle(state.readheadPos);
      });
    }
  }

  function setReadheadPos(pos) {
    const marker = document.getElementById('rh-marker');
    if (marker) marker.style.left = (pos * 100).toFixed(1) + '%';
  }

  function setHeightReadPos(pos) {
    const markerH = document.getElementById('rh-marker-h');
    if (markerH) markerH.style.left = (pos * 100).toFixed(1) + '%';
  }

  /** Apply ease curve to raw readhead pos, then map to positionAngle on circle.
   *  Always uses readhead A's ease settings — A is the one that actually
   *  drives the azimuth sweep; H's ease is stored separately (see state.ease)
   *  and only shown/edited when the A/H toggle is switched to H. */
  function applyReadheadToCircle(pos) {
    if (!window.CircleState || !window.CircleAPI) return;
    const ease = state.ease.A;
    const easedPos = applyEase(pos, ease.type, ease.intensity);
    if (window.ArcsAPI) {
      window.ArcsAPI.applyReadhead(easedPos);
    } else {
      var cs  = window.CircleState;
      var arc = cs.arcs ? cs.arcs[cs.selected || 0] : cs;
      var left  = arc.left  !== undefined ? arc.left  : (cs.leftAngle  || 0);
      var right = arc.right !== undefined ? arc.right : (cs.rightAngle || 60);
      var span  = ((right - left) + 360) % 360;
      cs.positionAngle = ((left + easedPos * span) + 360) % 360;
      window.CircleAPI.draw();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     TRANSPORT TOGGLE  (mockup play/pause — sweeps the readhead 0 -> 1, loops)
  ════════════════════════════════════════════════════════════════════════ */
  function playTick(ts) {
    if (!state.playing) return;
    if (playStart === null) playStart = ts;
    const pos = ((ts - playStart) % PLAY_CYCLE_MS) / PLAY_CYCLE_MS; // 0 -> 1, then restarts at 0
    state.readheadPos = pos;
    setReadheadPos(pos);
    applyReadheadToCircle(pos);
    playRAF = requestAnimationFrame(playTick);
  }

  function setPlaying(playing) {
    state.playing = playing;
    const btn = document.getElementById('transport-toggle');
    if (btn) {
      btn.dataset.state = playing ? 'playing' : 'paused';
      btn.title = playing ? 'Pause' : 'Play';
    }
    if (playing) {
      playStart = null;
      playRAF = requestAnimationFrame(playTick);
    } else if (playRAF !== null) {
      cancelAnimationFrame(playRAF);
      playRAF = null;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     HEIGHT RANGE  (dual-handle vertical slider next to the circle — the
     currently selected arc's elevation MIN/MAX, same drag pattern as the
     unified speed range in the footer, just vertical.)
  ════════════════════════════════════════════════════════════════════════ */
  function initHeightSlider() {
    const track      = document.getElementById('height-range');
    const fill       = document.getElementById('height-fill');
    const thumbMin   = document.getElementById('height-thumb-min');
    const thumbMax   = document.getElementById('height-thumb-max');
    const valEl      = document.getElementById('height-val');
    const lblBot     = document.querySelector('.height-lbl.bot');
    const modeToggle = document.getElementById('height-mode-toggle');
    if (!track || !fill || !thumbMin || !thumbMax || !valEl) return;

    let dragging = null; // 'min' | 'max' | null

    function bounds() {
      const mode = modeToggle ? modeToggle.dataset.mode : 'hemisphere';
      return mode === 'sphere' ? { min: -90, max: 90 } : { min: 0, max: 90 };
    }
    function pctFromAngle(angle) {
      const b = bounds();
      return ((b.max - angle) / (b.max - b.min)) * 100;
    }
    function angleFromPct(pct) {
      const b = bounds();
      return b.max - (pct / 100) * (b.max - b.min);
    }
    function currentArc() {
      return (window.CircleState && window.CircleState.arcs)
        ? window.CircleState.arcs[window.CircleState.selected]
        : null;
    }

    function render() {
      const arc = currentArc();
      if (!arc) return;
      const pMin = pctFromAngle(arc.heightMin);
      const pMax = pctFromAngle(arc.heightMax);
      const top  = Math.min(pMin, pMax), bottom = Math.max(pMin, pMax);
      thumbMin.style.top = pMin + '%';
      thumbMax.style.top = pMax + '%';
      fill.style.top     = top + '%';
      fill.style.height  = (bottom - top) + '%';
      valEl.textContent  = arc.heightMin === arc.heightMax
        ? arc.heightMin + '°'
        : arc.heightMin + '°/' + arc.heightMax + '°';
    }

    function angleFromEvent(e) {
      const rect = track.getBoundingClientRect();
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      return Math.round(angleFromPct((y / rect.height) * 100));
    }

    function moveTo(angle) {
      const arc = currentArc();
      if (!arc) return;
      const b = bounds();
      angle = Math.max(b.min, Math.min(b.max, angle));
      // No hard clamp against the other handle — that's what caused the
      // freeze (min could never pass a max stuck at 0 in hemisphere mode).
      // Instead let the dragged handle cross over: whichever value ends up
      // smaller becomes the min, larger becomes the max, and the handle
      // being dragged keeps following the cursor under its new label.
      if (dragging === 'min') {
        if (angle <= arc.heightMax) { arc.heightMin = angle; }
        else { arc.heightMin = arc.heightMax; arc.heightMax = angle; dragging = 'max'; }
      } else if (dragging === 'max') {
        if (angle >= arc.heightMin) { arc.heightMax = angle; }
        else { arc.heightMax = arc.heightMin; arc.heightMin = angle; dragging = 'min'; }
      }
      render();
      // The isometric view (if visible) has its own live height handles —
      // keep its wall-patch/dots tracking this slider in real time too.
      if (window.CircleIsoAPI && window.CircleIsoAPI.isActive()) window.CircleIsoAPI.draw();
    }

    /** Double-click a thumb to punch in a precise value — same shared popup
     *  (window.ValueEditorAPI, defined in circle.js) used by the flat
     *  circle's own handles and by the isometric view's handles. */
    function openHeightEditor(which, e) {
      const arc = currentArc();
      if (!arc || !window.ValueEditorAPI) return;
      const b = bounds();
      window.ValueEditorAPI.open({
        label: which === 'min' ? 'Elevazione min (°)' : 'Elevazione max (°)',
        value: Math.round(which === 'min' ? arc.heightMin : arc.heightMax),
        min: b.min, max: b.max,
        screenX: e.clientX, screenY: e.clientY,
        onApply(raw) {
          const v = Math.max(b.min, Math.min(b.max, raw));
          if (which === 'min') {
            if (v <= arc.heightMax) arc.heightMin = v; else { arc.heightMin = arc.heightMax; arc.heightMax = v; }
          } else {
            if (v >= arc.heightMin) arc.heightMax = v; else { arc.heightMax = arc.heightMin; arc.heightMin = v; }
          }
          render();
          if (window.ArcsAPI) window.ArcsAPI.autosave();
          if (window.CircleIsoAPI && window.CircleIsoAPI.isActive()) window.CircleIsoAPI.draw();
        },
      });
    }
    thumbMin.addEventListener('dblclick', e => { e.stopPropagation(); openHeightEditor('min', e); });
    thumbMax.addEventListener('dblclick', e => { e.stopPropagation(); openHeightEditor('max', e); });

    thumbMin.addEventListener('mousedown', e => { dragging = 'min'; e.preventDefault(); e.stopPropagation(); });
    thumbMax.addEventListener('mousedown', e => { dragging = 'max'; e.preventDefault(); e.stopPropagation(); });
    track.addEventListener('mousedown', e => {
      if (e.target === thumbMin || e.target === thumbMax) return;
      const arc = currentArc();
      if (!arc) return;
      const angle = angleFromEvent(e);
      dragging = (Math.abs(angle - arc.heightMin) <= Math.abs(angle - arc.heightMax)) ? 'min' : 'max';
      moveTo(angle);
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => { if (dragging) moveTo(angleFromEvent(e)); });
    window.addEventListener('mouseup', () => {
      if (dragging && window.ArcsAPI) window.ArcsAPI.autosave();
      dragging = null;
    });

    if (modeToggle) {
      modeToggle.addEventListener('click', () => {
        const mode = modeToggle.dataset.mode === 'sphere' ? 'hemisphere' : 'sphere';
        modeToggle.dataset.mode = mode;
        modeToggle.title = mode === 'sphere'
          ? 'Sfera (clic: semisfera)'
          : 'Semisfera (clic: sfera)';
        const arc = currentArc();
        if (arc) {
          arc.heightMode = mode;
          // Hemisphere has no below-horizon range — clamp back into [0, 90]
          if (mode === 'hemisphere') {
            arc.heightMin = Math.max(0, arc.heightMin);
            arc.heightMax = Math.max(0, arc.heightMax);
          }
        }
        if (lblBot) lblBot.textContent = mode === 'sphere' ? '−90°' : '0°';
        if (window.ArcsAPI) {
          window.ArcsAPI.autosave();
          window.ArcsAPI.syncHeightSlider(window.CircleState.selected);
        }
      });
    }

    render();

    window.HeightRangeAPI = {
      /** Refresh the control to reflect arc `idx` — its color, mode, values. */
      sync(idx) {
        const arc = (window.CircleState && window.CircleState.arcs) ? window.CircleState.arcs[idx] : null;
        if (!arc) return;
        if (modeToggle) {
          modeToggle.dataset.mode = arc.heightMode;
          modeToggle.title = arc.heightMode === 'sphere'
            ? 'Sfera (clic: semisfera)'
            : 'Semisfera (clic: sfera)';
        }
        if (lblBot) lblBot.textContent = arc.heightMode === 'sphere' ? '−90°' : '0°';
        const color = window.ARC_COLORS ? window.ARC_COLORS[idx] : null;
        if (color) {
          track.style.setProperty('--thumb-color', color); // inherited by fill + thumbs
          valEl.style.color = color;                        // sibling of track, needs it directly
        }
        render();
      },
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SUBGROUP SELECTOR  (mockup — which speaker subgroup(s) this spat drives;
     multi-select, options are hardcoded, real subgroups will come from the
     Rig page)
  ════════════════════════════════════════════════════════════════════════ */
  function initSubgroupSelect() {
    const btn  = document.getElementById('subgroup-btn');
    const menu = document.getElementById('subgroup-menu');
    if (!btn || !menu) return;

    function close() {
      menu.hidden = true;
      btn.classList.remove('open');
    }
    function open() {
      menu.hidden = false;
      btn.classList.add('open');
    }
    function updateTitle() {
      const names = Array.from(menu.querySelectorAll('.subgroup-item.active'))
        .map(i => i.textContent.trim());
      btn.title = names.length ? 'Subgroup: ' + names.join(', ') : 'Nessun subgroup selezionato';
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });

    menu.querySelectorAll('.subgroup-item').forEach(item => {
      item.addEventListener('click', () => {
        item.classList.toggle('active');
        updateTitle();
        if (window.ArcsAPI) {
          window.ArcsAPI.refreshSubgroupBadge();
          // Persist the selection into the current pattern preset
          window.ArcsAPI.autosave();
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('#subgroup-select')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });

    updateTitle();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BRAND CREDITS  (click the logo to show dev/build info)
  ════════════════════════════════════════════════════════════════════════ */
  function initBrandMenu() {
    const menu     = document.getElementById('brand-menu');
    const backdrop = document.getElementById('brand-backdrop');
    if (!menu || !backdrop) return;

    function close() {
      menu.classList.remove('open');
      backdrop.classList.remove('open');
    }
    function open() {
      menu.classList.add('open');
      backdrop.classList.add('open');
    }

    // Both the main panel and the settings panel have their own trigger
    // button (same brand, same credits modal — one shared #brand-menu).
    document.querySelectorAll('.brand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.contains('open') ? close() : open();
      });
    });
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('open')) close();
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SPAT SELECTOR  (custom dropdown in header, same pattern as the subgroup
     button — not an OS-native <select>)
  ════════════════════════════════════════════════════════════════════════ */
  function setSpatChoice(key) {
    // The main panel and the settings panel each have their own spat-select
    // instance — both mirror the same global choice, so update them together.
    document.querySelectorAll('.spat-select').forEach(sel => {
      const menu = sel.querySelector('.spat-menu');
      const btn  = sel.querySelector('.spat-btn');
      if (!menu || !btn) return;
      const choice = menu.querySelector('.spat-choice[data-spat="' + key + '"]');
      if (!choice) return;
      menu.querySelectorAll('.spat-choice').forEach(c => c.classList.remove('active'));
      choice.classList.add('active');
      btn.textContent = choice.textContent;
    });
  }

  function initSpatSelect() {
    document.querySelectorAll('.spat-select').forEach(sel => {
      const btn  = sel.querySelector('.spat-btn');
      const menu = sel.querySelector('.spat-menu');
      if (!btn || !menu) return;

      function close() {
        menu.hidden = true;
        btn.classList.remove('open');
      }
      function open() {
        menu.hidden = false;
        btn.classList.add('open');
      }

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden ? open() : close();
      });
      menu.querySelectorAll('.spat-choice').forEach(choice => {
        choice.addEventListener('click', () => {
          setSpatChoice(choice.dataset.spat);
          close();
        });
      });
      document.addEventListener('click', (e) => {
        if (!menu.hidden && !sel.contains(e.target)) close();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !menu.hidden) close();
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EASE SELECTOR  (custom dropdown for the readhead ease curve, same
     pattern as spat/subgroup — not an OS-native <select>)
  ════════════════════════════════════════════════════════════════════════ */
  function setEaseChoice(key) {
    const menu = document.getElementById('rh-ease-menu');
    const btn  = document.getElementById('rh-ease-btn');
    if (!menu || !btn) return;
    const choice = menu.querySelector('.rh-ease-choice[data-ease="' + key + '"]');
    if (!choice) return;
    menu.querySelectorAll('.rh-ease-choice').forEach(c => c.classList.remove('active'));
    choice.classList.add('active');
    btn.dataset.ease = key;
    state.ease[state.activeReadhead].type = key;
    updateDots();
    if (state.activeReadhead === 'A') applyReadheadToCircle(state.readheadPos);
  }

  function initEaseSelect() {
    const btn  = document.getElementById('rh-ease-btn');
    const menu = document.getElementById('rh-ease-menu');
    if (!btn || !menu) return;

    function close() {
      menu.hidden = true;
      btn.classList.remove('open');
    }
    function open() {
      menu.hidden = false;
      btn.classList.add('open');
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });
    // Delegated: modules.js adds/removes the "random" choice dynamically
    menu.addEventListener('click', (e) => {
      const choice = e.target.closest('.rh-ease-choice');
      if (!choice) return;
      setEaseChoice(choice.dataset.ease);
      close();
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('#rh-ease-select')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     UNIFIED SPEED RANGE  (params footer — dual-handle min/max, shared by
     every movement paradigm. Perimetro has only one speed, so the min
     handle locks to 0 while it's the active module.)
  ════════════════════════════════════════════════════════════════════════ */
  function initSpeedRange() {
    const track    = document.getElementById('speed-track');
    const fill     = document.getElementById('speed-fill');
    const thumbMin = document.getElementById('speed-thumb-min');
    const thumbMax = document.getElementById('speed-thumb-max');
    const lblMin   = document.getElementById('speed-min-val');
    const lblMax   = document.getElementById('speed-max-val');
    if (!track || !fill || !thumbMin || !thumbMax || !lblMin || !lblMax) return;

    const ABS_MIN = 0, ABS_MAX = 200, MIN_GAP = 5;
    let min = 40, max = 120;
    let locked     = false; // true while Perimetro is the active module
    let preLockMin = min;   // remembered min, restored when unlocked
    let dragging   = null;  // 'min' | 'max' | null

    function render() {
      const pMin = ((min - ABS_MIN) / (ABS_MAX - ABS_MIN)) * 100;
      const pMax = ((max - ABS_MIN) / (ABS_MAX - ABS_MIN)) * 100;
      thumbMin.style.left = pMin + '%';
      thumbMax.style.left = pMax + '%';
      fill.style.left  = pMin + '%';
      fill.style.width = (pMax - pMin) + '%';
      lblMin.textContent = Math.round(min);
      lblMax.textContent = Math.round(max);
      thumbMin.classList.toggle('locked', locked);
    }

    function posFromEvent(e) {
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      return ABS_MIN + (x / rect.width) * (ABS_MAX - ABS_MIN);
    }

    function moveTo(val) {
      if (dragging === 'min' && !locked) {
        min = Math.max(ABS_MIN, Math.min(val, max - MIN_GAP));
        preLockMin = min;
      } else if (dragging === 'max') {
        max = Math.min(ABS_MAX, Math.max(val, min + MIN_GAP));
      }
      render();
    }

    thumbMin.addEventListener('mousedown', e => {
      if (locked) return;
      dragging = 'min';
      e.preventDefault();
    });
    thumbMax.addEventListener('mousedown', e => {
      dragging = 'max';
      e.preventDefault();
    });
    track.addEventListener('mousedown', e => {
      if (e.target === thumbMin || e.target === thumbMax) return;
      const val = posFromEvent(e);
      dragging = (!locked && Math.abs(val - min) <= Math.abs(val - max)) ? 'min' : 'max';
      moveTo(val);
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => { if (dragging) moveTo(posFromEvent(e)); });
    window.addEventListener('mouseup',   () => {
      if (dragging && window.ArcsAPI) window.ArcsAPI.autosave();
      dragging = null;
    });

    render();

    window.SpeedRangeAPI = {
      getValues() { return { min, max }; },
      setValues(v) {
        if (!v) return;
        max = Math.max(ABS_MIN, Math.min(v.max, ABS_MAX));
        if (locked) {
          preLockMin = (typeof v.min === 'number') ? v.min : preLockMin;
          min = ABS_MIN;
        } else {
          min = Math.max(ABS_MIN, Math.min(v.min, max - MIN_GAP));
          preLockMin = min;
        }
        render();
      },
      setLocked(next) {
        if (next === locked) return;
        locked = next;
        if (locked) {
          preLockMin = min;
          min = ABS_MIN;
        } else {
          min = preLockMin;
        }
        render();
      },
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     SLAVE INDICATOR  (diagonal lines, bottom-right of params section)
  ════════════════════════════════════════════════════════════════════════ */
  function drawSlaveIndicator() {
    const canvas  = document.getElementById('slave-canvas');
    const section = document.querySelector('.params-section');
    if (!canvas || !section) return;

    const count = state.slaveGroup;
    const size  = 64;
    canvas.width  = size;
    canvas.height = size;
    canvas.style.width  = size + 'px';
    canvas.style.height = size + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    if (count === 0) return;

    ctx.strokeStyle = '#ACAAA4';
    ctx.lineWidth = 1;

    // Draw N lines in the bottom-right triangle (clipped by CSS to corner)
    // Each line: from (size - k*gap, size) to (size, size - k*gap)
    const gap = size / (count + 1);
    for (let i = 1; i <= count; i++) {
      const offset = i * gap;
      ctx.beginPath();
      ctx.moveTo(size - offset, size);
      ctx.lineTo(size,          size - offset);
      ctx.stroke();
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     EVENT BINDINGS
  ════════════════════════════════════════════════════════════════════════ */
  function bindEvents() {
    // Logo buttons
    document.getElementById('logo-btn')
      ?.addEventListener('click', toggleSecondary);
    document.getElementById('logo-btn-2')
      ?.addEventListener('click', closeSecondary);

    // ESC key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && state.secondaryOpen) closeSecondary();
    });

    // Module tab bar (event delegation)
    document.getElementById('module-tabs')
      ?.addEventListener('click', e => {
        const tab = e.target.closest('.tab[data-module]');
        if (tab && !tab.disabled) switchModule(tab.dataset.module);
      });

    // Settings tab bar (event delegation)
    document.getElementById('settings-tabs')
      ?.addEventListener('click', e => {
        const tab = e.target.closest('.tab[data-settings]');
        if (tab) switchSettings(tab.dataset.settings);
      });

    // Global / stray toggle
    document.getElementById('gs-toggle')
      ?.addEventListener('click', e => {
        const btn = e.target.closest('.gs-btn');
        if (!btn) return;
        state.gsState[state.currentSettings] = btn.dataset.gs;
        syncGSToggle();
      });

    // Transport toggle (mockup play/pause)
    document.getElementById('transport-toggle')
      ?.addEventListener('click', () => setPlaying(!state.playing));

    // Loop / direction: mockup, just a visual toggle for now
    document.getElementById('loop-toggle')
      ?.addEventListener('click', function () {
        this.classList.toggle('active');
        if (window.ArcsAPI) window.ArcsAPI.autosave();
      });
    document.getElementById('direction-toggle')
      ?.addEventListener('click', function () {
        this.classList.toggle('active');
        if (window.ArcsAPI) window.ArcsAPI.autosave();
      });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     RESIZE PANEL SPLIT
  ════════════════════════════════════════════════════════════════════════ */
  function initResize() {
    const handle = document.getElementById('panel-resize');
    const circ   = document.querySelector('.circle-section');
    const body   = document.querySelector('.panel-body');
    if (!handle || !circ || !body) return;

    let dragging = false;
    let startX, startW;

    handle.addEventListener('mousedown', e => {
      dragging = true;
      startX   = e.clientX;
      startW   = circ.getBoundingClientRect().width;
      handle.classList.add('dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const bodyW = body.getBoundingClientRect().width;
      const newW  = Math.max(200, Math.min(bodyW - 180, startW + (e.clientX - startX)));
      circ.style.flex = `0 0 ${newW}px`;
    });

    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     APP BRIDGE  (cross-module communication hook)
  ════════════════════════════════════════════════════════════════════════ */
  window.AppBridge = {
    getReadheadPos() { return state.readheadPos; },
    computePositionAngle(pos) {
      return window.ArcsAPI ? window.ArcsAPI.computePositionAngle(pos) : 0;
    },
    onCircleChange() {},
    setEaseChoice,
    getCurrentModule() { return state.currentModule; },
    switchModule,
  };

  /* ═══════════════════════════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initReadhead();
    initHeightSlider();
    initResize();
    initSubgroupSelect();
    initSpatSelect();
    initEaseSelect();
    initBrandMenu();
    initSpeedRange();
    if (window.SpeedRangeAPI) window.SpeedRangeAPI.setLocked(state.currentModule === 'perimetro');
    drawSlaveIndicator();
    // Init arc buttons + pattern bar (ArcsAPI defined in arcs.js)
    if (window.ArcsAPI) window.ArcsAPI.init();
    // Align position dot with initial readhead position
    applyReadheadToCircle(state.readheadPos);
  });
})();
