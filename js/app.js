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
    gsState: { audio: 'global', rig: 'global', generali: 'global', network: 'global' },
    readheadPos:     0.,  // 0 to 1
    activeReadhead:  'A',    // which readhead's ease settings are shown/edited — the A/H
                             // switch that used to change this is gone (see initReadhead
                             // in app.js), and the ease panel itself is parked for now, so
                             // this just stays 'A' (the only one that ever drove anything)
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
     MODULE (PARADIGM) SELECT
  ════════════════════════════════════════════════════════════════════════ */
  function switchModule(name, opts) {
    state.currentModule = name;
    const menu = document.getElementById('module-menu');
    const label = document.getElementById('module-btn-label');
    if (menu) {
      menu.querySelectorAll('.module-choice').forEach(choice => {
        choice.classList.toggle('active', choice.dataset.module === name);
      });
      const active = menu.querySelector('.module-choice.active');
      if (label && active) label.textContent = active.textContent.trim();
    }
    if (window.ModulesAPI) window.ModulesAPI.renderModule(name);
    if (window.CircleAPI)  window.CircleAPI.setModule(name);
    // Refreshes the arc-btn-bar immediately — e.g. Traversa's 4-zone cap
    // (see arcs.js's updateArcButtons) should grey out the remaining OFF
    // buttons the moment you switch in, not just on the next hover.
    if (window.ArcsAPI) window.ArcsAPI.updateArcButtons();
    // Perimetro has a single speed — lock the min handle to 0
    if (window.SpeedRangeAPI) window.SpeedRangeAPI.setLocked(name === 'perimetro');
    // Diretto spreads sound statically over the drawn arcs — no position to
    // read, no spat algorithm to pick, nothing to transport.
    setDirettoMode(name === 'diretto');
    // Diretto (paradigm) and Direct (spat algorithm) are inseparable — one
    // implies the other, in both directions. Guarded on the current spat so
    // this doesn't loop back and forth with setSpatChoice's own matching
    // guard below. Leaving Diretto for any other paradigm means Direct no
    // longer makes sense either — falls back to VBAP rather than leaving
    // the spat selector stuck showing "Direct" for an unrelated paradigm.
    if (name === 'diretto') {
      if (currentSpatKey() !== 'direct') setSpatChoice('direct');
    } else if (currentSpatKey() === 'direct') {
      setSpatChoice('vbap');
    }
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
    const map = { audio: renderAudio, rig: renderRig, generali: renderGenerali, network: renderNetwork };
    const fn = map[tab];
    if (fn) {
      body.innerHTML = fn();
      bindSettingsEvents(tab);
    }
  }

  /* ── Audio tab ─────────────────────────────────────────────────────────── */
  // Same order as the main-panel spat dropdown (VBAP, DBAP, AmbiV, Direct).
  const AUDIO_TYPES = [
    { key: 'vbap',       label: 'VBAP' },
    { key: 'dbap',       label: 'DBAP' },
    { key: 'ambisonics', label: 'AmbiV' },
    { key: 'direct',     label: 'Direct' },
  ];

  // Parameters per algorithm — still mockup (no real DSP behind them), but
  // now the actual parameter set for each, not placeholders. `type` picks
  // the control: 'slider' (range + numeric readout), 'numbox' (a plain
  // number input — for values with no natural 0–100 range, like a
  // millisecond time), or 'toggle' (a small set of mutually exclusive
  // choices, same look as the Generali tab's global/stray switch).
  const AUDIO_PARAMS = {
    vbap: [
      { type: 'slider', id: 'au-smooth', name: 'Smooth', min: 0, max: 1,  step: 0.01, val: 0.5, unit: '' },
      { type: 'slider', id: 'au-spread', name: 'Spread', min: 0, max: 70, step: 1,    val: 20,  unit: '°' },
    ],
    dbap: [
      { type: 'slider', id: 'au-focus', name: 'Focus', min: 0, max: 100, step: 1, val: 50, unit: '%' },
    ],
    ambisonics: [
      { type: 'slider', id: 'au-order',  name: 'Order',  min: 1, max: 7, step: 1, val: 3, unit: '' },
      { type: 'toggle', id: 'au-output', name: 'Output', val: 'decoder', options: [
        { key: 'decoder', label: 'Decoder' },
        { key: 'bformat', label: 'B-format' },
      ] },
    ],
    direct: [
      { type: 'numbox', id: 'au-smooth-ms', name: 'Smooth', min: 0, max: 10000, step: 10, val: 50, unit: 'ms' },
    ],
  };

  function currentSpatKey() {
    const active = document.querySelector('#spat-menu .spat-choice.active');
    return (active && AUDIO_PARAMS[active.dataset.spat]) ? active.dataset.spat : 'vbap';
  }

  function renderAudioParams(key) {
    return (AUDIO_PARAMS[key] || []).map(p => {
      if (p.type === 'numbox') {
        return `
          <div class="param-row">
            <span class="param-name">${p.name}</span>
            <input type="number" class="che-input param-numbox mono" id="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.val}">
            <span class="param-value mono">${p.unit}</span>
          </div>`;
      }
      if (p.type === 'toggle') {
        return `
          <div class="param-row">
            <span class="param-name">${p.name}</span>
            <div class="gs-toggle param-toggle" id="${p.id}">
              ${p.options.map(o =>
                `<button class="gs-btn${o.key === p.val ? ' active' : ''}" data-value="${o.key}">${o.label}</button>`
              ).join('')}
            </div>
          </div>`;
      }
      return `
        <div class="param-row">
          <span class="param-name">${p.name}</span>
          <input type="range" class="param-slider" id="${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.val}" data-unit="${p.unit}">
          <span class="param-value mono" id="${p.id}-val">${p.val}${p.unit}</span>
        </div>`;
    }).join('');
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

  /* ── Network tab (placeholder — nothing here yet) ─────────────────────── */
  function renderNetwork() {
    return '';
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

  /** Binds the audio params' toggle-type controls (e.g. Ambisonics'
   *  decoder/B-format switch) — same click-to-select-one pattern as
   *  .gs-toggle elsewhere, just scoped to whichever .param-toggle it's in. */
  function bindParamToggles(container) {
    container.querySelectorAll('.param-toggle').forEach(toggle => {
      toggle.querySelectorAll('.gs-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          toggle.querySelectorAll('.gs-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    });
  }

  function bindSettingsEvents(tab) {
    const body = document.getElementById('settings-body');
    if (!body) return;

    bindRangeSliders(body);
    bindParamToggles(body);

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
            bindParamToggles(paramsEl);
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
    // Azimuth slider (readhead A) — its own standalone track above the arc
    // on/off buttons, same drag-anywhere-on-track behaviour the old shared
    // track used, just retargeted to the new element.
    const azTrack = document.getElementById('az-slider-track');
    if (azTrack) {
      setReadheadPos(state.readheadPos);

      let dragging = false;
      azTrack.addEventListener('mousedown', e => {
        dragging = true;
        moveAz(e);
        e.preventDefault();
      });
      window.addEventListener('mousemove', e => { if (dragging) moveAz(e); });
      window.addEventListener('mouseup',   () => { dragging = false; });

      function moveAz(e) {
        const rect = azTrack.getBoundingClientRect();
        const x    = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
        state.readheadPos = x / rect.width;
        setReadheadPos(state.readheadPos);
        applyReadheadToCircle(state.readheadPos);
      }
    }

    // Elevation slider (readhead H) — its own standalone vertical track to
    // the left of the height-range slider. Reads 0–1 through the
    // heightMin/heightMax range of whichever arc the sound object is
    // azimuthally inside right now. Moves the position dot's radius on the
    // flat circle (see positionDotPoint in circle.js) and the dot's
    // elevation in the isometric view. Top of the track = 1 (matches the
    // adjacent height-range's own top=max convention), bottom = 0.
    const elTrack = document.getElementById('el-slider-track');
    if (elTrack) {
      setHeightReadPos(window.CircleState ? window.CircleState.heightReadPos : 0);

      let draggingH = false;
      elTrack.addEventListener('mousedown', e => {
        draggingH = true;
        moveEl(e);
        e.preventDefault();
      });
      window.addEventListener('mousemove', e => { if (draggingH) moveEl(e); });
      window.addEventListener('mouseup',   () => { draggingH = false; });

      function moveEl(e) {
        const rect = elTrack.getBoundingClientRect();
        const y    = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
        const pct  = 1 - (y / rect.height);
        if (window.CircleState) window.CircleState.heightReadPos = pct;
        setHeightReadPos(pct);
        // Position-only update (see circle.js) — heightReadPos changing
        // doesn't touch arc geometry, so this is the same cheap path used
        // by the A readhead's own drag, avoiding a full rebuild per pixel.
        if (window.CircleAPI) window.CircleAPI.updatePositionDot();
        if (window.CircleIsoAPI && window.CircleIsoAPI.isActive()) window.CircleIsoAPI.draw();
      }
    }

    // Ease density dots — parked along with the rest of the ease controls
    // (see #readhead-bar[hidden] in components.css) but kept fully live, so
    // both work immediately if that panel is ever shown again.
    const dotsEl = document.getElementById('rh-dots');
    if (dotsEl) {
      dotsEl.innerHTML = Array(15).fill('<span class="rh-dot"></span>').join('');
      updateDots();
    }
    syncEaseUIToActiveReadhead();
  }

  function setReadheadPos(pos) {
    const thumb = document.getElementById('az-slider-thumb');
    if (thumb) thumb.style.left = (pos * 100).toFixed(1) + '%';
  }

  function setHeightReadPos(pos) {
    const thumb = document.getElementById('el-slider-thumb');
    if (thumb) thumb.style.top = ((1 - pos) * 100).toFixed(1) + '%';
  }

  /** Apply ease curve to raw readhead pos, then map to positionAngle on circle.
   *  Always uses readhead A's ease settings — A is the one that actually
   *  drives the azimuth sweep; H's ease is stored separately (see state.ease)
   *  but the panel to edit it is parked for now (see #readhead-bar[hidden]
   *  in components.css) — state.activeReadhead just stays 'A'. */
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

  /** Snaps to the nearest 0.5° — same grid the azimuth handles in circle.js/
   *  circle-iso.js use, so elevation can't be dragged/typed any finer either. */
  function roundToHalf(deg) { return Math.round(deg * 2) / 2; }

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
      return roundToHalf(angleFromPct((y / rect.height) * 100));
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
      // The flat circle now shows a height indicator on the selected zone
      // too (see circle.js's height ring), and the isometric view (if
      // visible) has its own live height handles — keep both tracking this
      // slider in real time.
      if (window.CircleAPI) window.CircleAPI.draw();
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
        value: roundToHalf(which === 'min' ? arc.heightMin : arc.heightMax),
        min: b.min, max: b.max,
        screenX: e.clientX, screenY: e.clientY,
        onApply(raw) {
          const v = Math.max(b.min, Math.min(b.max, roundToHalf(raw)));
          if (which === 'min') {
            if (v <= arc.heightMax) arc.heightMin = v; else { arc.heightMin = arc.heightMax; arc.heightMax = v; }
          } else {
            if (v >= arc.heightMin) arc.heightMax = v; else { arc.heightMax = arc.heightMin; arc.heightMin = v; }
          }
          render();
          if (window.ArcsAPI) window.ArcsAPI.autosave();
          if (window.CircleAPI) window.CircleAPI.draw();
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
     SUBGROUP SELECTOR  (which speaker subset(s), among the Rig tab's fixed
     16 tags, this spat drives; multi-select — a preset can use several.)
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
      const names = Array.from(menu.querySelectorAll('.subgroup-item.active')).map(i => i.textContent.trim());
      btn.title = names.length ? 'Subgroup: ' + names.join(', ') : 'Nessun subgroup selezionato';
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });

    // Multi-select — a preset can drive several subsets at once, so a click
    // just toggles that one item; the menu stays open for picking more.
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.subgroup-item');
      if (!item) return;
      item.classList.toggle('active');
      updateTitle();
      if (window.ArcsAPI) {
        window.ArcsAPI.refreshSubgroupBadge();
        // Persist the selection into the current pattern preset
        window.ArcsAPI.autosave();
      }
      // The speaker illustrations (both views) only show the currently
      // selected subgroup's speakers — see drawSpeakerIcons in circle.js.
      if (window.CircleAPI) window.CircleAPI.draw();
    });

    document.addEventListener('click', (e) => {
      if (!menu.hidden && !e.target.closest('#subgroup-select')) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });

    rebuildSubgroupMenu();
    updateTitle();
  }

  /** Rebuilds the subgroup dropdown from the Rig tab's tags that are
   *  currently in use (window.RigAPI.getUsedSubsets()) — a tag nobody's
   *  speakers are assigned to doesn't show up at all. Called on init and
   *  again, via window.AppBridge.rebuildSubgroupMenu, every time a speaker
   *  is retagged/added/removed on the Rig tab, since any of those can
   *  change which tags are in use. */
  function rebuildSubgroupMenu() {
    const menu = document.getElementById('subgroup-menu');
    const btn  = document.getElementById('subgroup-btn');
    if (!menu || !window.RigAPI) return;

    // An empty menu means this is the very first build (nothing rendered
    // yet, so there's no real prior selection to preserve) — default to
    // the first used tag (normally "Subset A", the one every speaker
    // starts in). Any later rebuild still respects whatever the user
    // actually had selected, including nothing at all.
    const isFirstBuild = menu.children.length === 0;
    const prevActive = new Set(
      Array.from(menu.querySelectorAll('.subgroup-item.active')).map(i => i.dataset.subgroup)
    );
    const subsets = window.RigAPI.getUsedSubsets();
    if (isFirstBuild && subsets.length > 0) prevActive.add(subsets[0].id);

    menu.innerHTML = subsets.map(su =>
      `<button class="subgroup-item${prevActive.has(su.id) ? ' active' : ''}" data-subgroup="${su.id}">${su.name}</button>`
    ).join('');

    const activeNames = subsets.filter(su => prevActive.has(su.id)).map(su => su.name);
    if (btn) btn.title = activeNames.length ? 'Subgroup: ' + activeNames.join(', ') : 'Nessun subgroup selezionato';
    if (window.ArcsAPI) window.ArcsAPI.refreshSubgroupBadge();
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
    // Direct (spat algorithm) and Diretto (paradigm) are inseparable — one
    // implies the other, in both directions (mirrors switchModule's own
    // guard above; same reasoning, so it doesn't loop back and forth).
    // Picking Direct forces the paradigm to Diretto; picking anything else
    // while Diretto is still active falls back to Perimetro, since Diretto
    // without the Direct algorithm doesn't make sense either.
    if (key === 'direct') {
      if (state.currentModule !== 'diretto') switchModule('diretto');
    } else if (state.currentModule === 'diretto') {
      switchModule('perimetro');
    }
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
     PAIR-MODE SELECTOR  (source single/double-point mode, top-left of the
     circle — mockup only for now, not wired to any real audio logic. Same
     dropdown pattern as spat/subgroup/module. The button's own icon swaps
     between a single circle and a double circle to match the picked mode.)
  ════════════════════════════════════════════════════════════════════════ */
  function initPairSelect() {
    const sel  = document.getElementById('pair-select');
    const btn  = document.getElementById('pair-btn');
    const menu = document.getElementById('pair-menu');
    if (!sel || !btn || !menu) return;

    const ICO_SINGLE = '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true">' +
      '<circle cx="9" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
    const ICO_DOUBLE = '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true">' +
      '<circle cx="7" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
      '<circle cx="11" cy="9" r="4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

    function close() {
      menu.hidden = true;
      btn.classList.remove('open');
    }
    function open() {
      menu.hidden = false;
      btn.classList.add('open');
    }
    function setChoice(key) {
      const choice = menu.querySelector('.pair-choice[data-pair="' + key + '"]');
      if (!choice) return;
      menu.querySelectorAll('.pair-choice').forEach(c => c.classList.remove('active'));
      choice.classList.add('active');
      btn.innerHTML = key === 'single' ? ICO_SINGLE : ICO_DOUBLE;
      btn.title = choice.textContent.trim();
    }

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden ? open() : close();
    });
    menu.querySelectorAll('.pair-choice').forEach(choice => {
      choice.addEventListener('click', () => {
        setChoice(choice.dataset.pair);
        close();
      });
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !sel.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
    });

    setChoice('single');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     MODULE (PARADIGM) SELECTOR  (custom dropdown, same pattern as spat/
     subgroup/ease — not an OS-native <select>)
  ════════════════════════════════════════════════════════════════════════ */
  function initModuleSelect() {
    const sel  = document.getElementById('module-select');
    const btn  = document.getElementById('module-btn');
    const menu = document.getElementById('module-menu');
    if (!sel || !btn || !menu) return;

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
    menu.querySelectorAll('.module-choice[data-module]').forEach(choice => {
      choice.addEventListener('click', () => {
        switchModule(choice.dataset.module);
        close();
      });
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !sel.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !menu.hidden) close();
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

    const ABS_MIN = 0, ABS_MAX = 10000, MIN_GAP = 5;
    // Exponential taper: thumb position maps to value as t^CURVE (and back
    // as t^(1/CURVE)) instead of linearly. With CURVE > 1, the low end of
    // the range gets more screen space per unit of value (finer control
    // over small numbers) and the high end gets less (coarser control —
    // the same drag distance sweeps through a much wider span up there).
    const CURVE = 5.2;
    function valueToT(v) {
      const norm = Math.max(0, Math.min(1, (v - ABS_MIN) / (ABS_MAX - ABS_MIN)));
      return Math.pow(norm, 1 / CURVE);
    }
    function tToValue(t) {
      return ABS_MIN + (ABS_MAX - ABS_MIN) * Math.pow(Math.max(0, Math.min(1, t)), CURVE);
    }
    let min = 40, max = 120;
    let locked     = false; // true while Perimetro is the active module
    let preLockMin = min;   // remembered min, restored when unlocked
    let dragging   = null;  // 'min' | 'max' | null
    let merged      = false;      // true when double-click has collapsed min/max into one thumb
    let preMergeMin = min, preMergeMax = max; // remembered split values, restored when un-merged

    /** Below 1000 it's milliseconds as a plain integer; at/above 1000 it's
     *  seconds with two decimals — same value, just switching how it's
     *  read once it's big enough that seconds are the more natural unit.
     *  No "ms"/"s" suffix: which one it is is implicit from the format. */
    function formatSpeedVal(v) {
      const rounded = Math.round(v);
      return rounded >= 1000 ? (rounded / 1000).toFixed(2) : String(rounded);
    }

    function render() {
      const pMin = valueToT(min) * 100;
      const pMax = valueToT(max) * 100;
      thumbMin.style.left = pMin + '%';
      thumbMax.style.left = pMax + '%';
      fill.style.left  = pMin + '%';
      fill.style.width = (pMax - pMin) + '%';
      lblMin.textContent = formatSpeedVal(min);
      lblMax.textContent = formatSpeedVal(max);
      thumbMin.classList.toggle('locked', locked);
    }

    /** Double-click anywhere on the track (or either thumb, since both
     *  bubble dblclick up to it) collapses the two handles into one at
     *  their current midpoint, or restores the two independent values it
     *  remembered from just before merging. Min/max stay equal while
     *  merged — see the CSS .speed-thumb.merged-hidden rule, which just
     *  hides the redundant second thumb, not the label showing its value
     *  (both sides keep displaying it, per spec). Disabled while locked
     *  (Perimetro) — that mode already dictates the min handle on its own. */
    function toggleMerge() {
      if (locked) return;
      merged = !merged;
      if (merged) {
        preMergeMin = min;
        preMergeMax = max;
        const mid = Math.round((min + max) / 2);
        min = mid;
        max = mid;
      } else {
        min = preMergeMin;
        max = preMergeMax;
        if (max - min < MIN_GAP) max = Math.min(ABS_MAX, min + MIN_GAP);
      }
      thumbMax.classList.toggle('merged-hidden', merged);
      render();
      if (window.ArcsAPI) window.ArcsAPI.autosave();
    }

    function posFromEvent(e) {
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      return tToValue(x / rect.width);
    }

    function moveTo(val) {
      // Merged: min and max move together as one value, in either
      // direction — no MIN_GAP between them to enforce since they're
      // meant to stay equal, and no "which handle is this" to resolve
      // (the hidden max thumb never receives its own drag anyway).
      if (merged) {
        const v = Math.max(ABS_MIN, Math.min(val, ABS_MAX));
        min = v;
        max = v;
        preLockMin = v;
      } else if (dragging === 'min' && !locked) {
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
    // Bubbles up from either thumb too, since both are children of the track.
    track.addEventListener('dblclick', e => {
      toggleMerge();
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
        // A restored preset's min/max come in independently — if they landed
        // on genuinely different values while a merge was still in effect,
        // that'd leave the (still-hidden) max thumb out of sync with its
        // real value. Exit merge rather than risk that.
        if (merged && min !== max) {
          merged = false;
          thumbMax.classList.remove('merged-hidden');
        }
        render();
      },
      setLocked(next) {
        if (next === locked) return;
        locked = next;
        if (locked) {
          // Perimetro's own lock already dictates the min handle — merging
          // on top of that would leave the hidden max thumb desynced the
          // moment min snaps to ABS_MIN below.
          if (merged) {
            merged = false;
            thumbMax.classList.remove('merged-hidden');
          }
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

    // This is a plugin UI, not a web page — the browser's native right-click
    // menu (Inspect, Reload, Back...) has nothing relevant to offer here.
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Buttons don't keep keyboard focus after a click — CSS alone
    // (outline:none) only hides the ring, it doesn't stop the button from
    // staying focused, which is also why Space would otherwise "press" it
    // again later. Blurring right after the click removes both at once.
    document.addEventListener('click', e => {
      const btn = e.target.closest('button');
      if (btn) btn.blur();
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

    // Speaker-illustration toggle — shared flag read by both circle.js's
    // flat view and circle-iso.js's isometric view (see CircleState.showSpeakers).
    document.getElementById('speaker-viz-toggle')
      ?.addEventListener('click', function () {
        var cs = window.CircleState;
        if (!cs) return;
        cs.showSpeakers = !cs.showSpeakers;
        this.classList.toggle('active', cs.showSpeakers);
        if (window.CircleAPI) window.CircleAPI.draw();
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
    rebuildSubgroupMenu,
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
    initPairSelect();
    initModuleSelect();
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
