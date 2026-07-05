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
    currentSettings: 'audio',
    secondaryOpen:   false,
    instanceNumber:  1,
    slaveGroup:      2,     // 0 = standalone; N = N diagonal lines shown
    gsState: { audio: 'global', rig: 'stray', generali: 'global' },
    readheadPos:     0.,  // 0 to 1
    easeType:        'in',   // 'in' | 'out' | 'double'
    easeIntensity:   0,      // 0–100
    playing:         false,
  };

  const PLAY_CYCLE_MS = 4000; // full sweep 0 -> 1 -> 0
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
  function switchModule(name) {
    state.currentModule = name;
    document.querySelectorAll('#module-tabs .tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.module === name);
    });
    if (window.ModulesAPI) window.ModulesAPI.renderModule(name);
    if (window.CircleAPI)  window.CircleAPI.setModule(name);
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
  function renderAudio() {
    const types = ['DBAP', 'VBAP', 'Ambisonics', 'Soundscape'];
    return `
      <div class="settings-left">
        <div class="settings-section-title">Parametri</div>
        <div class="param-row">
          <span class="param-name">Gain</span>
          <input type="range" class="param-slider" id="au-gain" min="0" max="100" value="80" data-unit="">
          <span class="param-value mono" id="au-gain-val">80</span>
        </div>
        <div class="param-row">
          <span class="param-name">Distance</span>
          <input type="range" class="param-slider" id="au-dist" min="0" max="100" value="50" data-unit="">
          <span class="param-value mono" id="au-dist-val">50</span>
        </div>
        <div class="param-row">
          <span class="param-name">Blur</span>
          <input type="range" class="param-slider" id="au-blur" min="0" max="100" value="20" data-unit="">
          <span class="param-value mono" id="au-blur-val">20</span>
        </div>
        <div class="param-row">
          <span class="param-name">Doppler</span>
          <input type="range" class="param-slider" id="au-doppler" min="0" max="100" value="0" data-unit="%">
          <span class="param-value mono" id="au-doppler-val">0%</span>
        </div>
      </div>
      <div class="settings-right">
        <div class="settings-section-title">Tipologia</div>
        <ul class="spat-list">
          ${types.map((t, i) =>
            `<li class="spat-item${i === 0 ? ' active' : ''}" data-spat="${t.toLowerCase()}">${t}</li>`
          ).join('')}
        </ul>
      </div>`;
  }

  /* ── Rig tab ───────────────────────────────────────────────────────────── */
  const SPEAKERS = [
    { id: 1,  name: 'FL',  az: '0°',   el: '0°'  },
    { id: 2,  name: 'FRC', az: '45°',  el: '0°'  },
    { id: 3,  name: 'FR',  az: '90°',  el: '0°'  },
    { id: 4,  name: 'BRC', az: '135°', el: '0°'  },
    { id: 5,  name: 'BR',  az: '180°', el: '0°'  },
    { id: 6,  name: 'BLC', az: '225°', el: '0°'  },
    { id: 7,  name: 'BL',  az: '270°', el: '0°'  },
    { id: 8,  name: 'FLC', az: '315°', el: '0°'  },
    { id: 9,  name: 'HL',  az: '0°',   el: '45°' },
    { id: 10, name: 'HR',  az: '90°',  el: '45°' },
    { id: 11, name: 'HL2', az: '180°', el: '45°' },
    { id: 12, name: 'TOP', az: '0°',   el: '90°' },
  ];

  function renderRig() {
    const speakerRows = SPEAKERS.map(s => `
      <li class="speaker-item">
        <input type="checkbox" checked>
        <span class="speaker-num mono">${String(s.id).padStart(2, '0')}</span>
        <span class="speaker-name">${s.name}</span>
        <span class="speaker-pos mono">${s.az} / ${s.el}</span>
      </li>`).join('');

    return `
      <div class="settings-left">
        <div class="settings-section-title">Visualizzazione Rig</div>
        <div class="rig-viz">
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"
               style="width:100%; aspect-ratio:1; display:block;">
            ${buildRigSVG()}
          </svg>
        </div>
      </div>
      <div class="settings-right">
        <div class="settings-section-title">Altoparlanti</div>
        <ul class="speaker-list">${speakerRows}</ul>
      </div>`;
  }

  function buildRigSVG() {
    const CX = 100, CY = 100, R = 75;
    let s = '';
    // Abstract sphere ellipses
    s += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#1A1917" stroke-width="1"/>`;
    s += `<ellipse cx="${CX}" cy="${CY}" rx="${R}" ry="${R*0.3}" fill="none" stroke="#D3D1CC" stroke-width="0.5" stroke-dasharray="3 2"/>`;
    s += `<ellipse cx="${CX}" cy="${CY}" rx="${R*0.3}" ry="${R}" fill="none" stroke="#D3D1CC" stroke-width="0.5" stroke-dasharray="3 2"/>`;
    // Center
    s += `<circle cx="${CX}" cy="${CY}" r="2.5" fill="#C8C5C0"/>`;

    // Ring speakers (el = 0°)
    const ring = SPEAKERS.filter(sp => sp.el === '0°');
    ring.forEach(sp => {
      const az  = parseFloat(sp.az);
      const rad = az * Math.PI / 180;
      const x   = CX + R * Math.sin(rad);
      const y   = CY - R * Math.cos(rad);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4"
                    fill="#fff" stroke="#2B4C9B" stroke-width="1.5"/>`;
      const lx = CX + (R + 12) * Math.sin(rad);
      const ly = CY - (R + 12) * Math.cos(rad);
      s += `<text x="${lx.toFixed(1)}" y="${(ly + 3).toFixed(1)}"
                  font-size="7" fill="#56534E"
                  text-anchor="middle" font-family="Arial">${sp.name}</text>`;
    });

    // Elevated speakers (el = 45°)
    const elev = SPEAKERS.filter(sp => sp.el === '45°');
    elev.forEach(sp => {
      const az  = parseFloat(sp.az);
      const rad = az * Math.PI / 180;
      const re  = R * 0.55;
      const x   = CX + re * Math.sin(rad);
      const y   = CY - re * Math.cos(rad);
      s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"
                    fill="#E7ECF7" stroke="#2B4C9B" stroke-width="1.2" stroke-dasharray="2.5 1.5"/>`;
    });

    // Top speaker
    s += `<circle cx="${CX}" cy="${CY}" r="5"
                  fill="#E7ECF7" stroke="#2B4C9B" stroke-width="1.2"/>`;
    s += `<text x="${CX}" y="${CY + 3}" font-size="6" fill="#2B4C9B"
                text-anchor="middle" font-family="Arial">T</text>`;

    return s;
  }

  /* ── Generali tab ──────────────────────────────────────────────────────── */
  function renderGenerali() {
    const channels = ['1','2','3','4','5','6','7','8'];
    const buses    = ['A','B','C','D'];

    let matrixHTML = `<div class="matrix-grid">`;
    // Header row
    matrixHTML += `<div class="matrix-header"><span class="matrix-lbl"></span>`;
    buses.forEach(b => { matrixHTML += `<span class="matrix-lbl mono">${b}</span>`; });
    matrixHTML += `</div>`;
    // Data rows
    channels.forEach((ch, ci) => {
      matrixHTML += `<div class="matrix-row"><span class="matrix-lbl mono">${ch}</span>`;
      buses.forEach((b, bi) => {
        const active = (ci === bi) ? ' active' : '';
        matrixHTML += `<button class="matrix-cell${active}" data-ch="${ch}" data-bus="${b}"></button>`;
      });
      matrixHTML += `</div>`;
    });
    matrixHTML += `</div>`;

    return `
      <div class="settings-left">
        <div class="settings-section-title">Leggi Generali</div>
        <div class="param-row">
          <span class="param-name">Doppler</span>
          <input type="range" class="param-slider" id="g-doppler" min="0" max="100" value="0" data-unit="">
          <span class="param-value mono" id="g-doppler-val">0</span>
        </div>
        <div class="param-row">
          <span class="param-name">Room Size</span>
          <input type="range" class="param-slider" id="g-room" min="0" max="100" value="40" data-unit="">
          <span class="param-value mono" id="g-room-val">40</span>
        </div>
        <div class="param-row">
          <span class="param-name">Air Abs.</span>
          <input type="range" class="param-slider" id="g-air" min="0" max="100" value="20" data-unit="">
          <span class="param-value mono" id="g-air-val">20</span>
        </div>
        <div class="param-row">
          <span class="param-name">Near Clip</span>
          <input type="range" class="param-slider" id="g-clip" min="0" max="100" value="10" data-unit="">
          <span class="param-value mono" id="g-clip-val">10</span>
        </div>
      </div>
      <div class="settings-right">
        <div class="settings-section-title">Matrice di Uscita</div>
        ${matrixHTML}
      </div>`;
  }

  /* ── Bind settings events (sliders, spat list, matrix) ─────────────────── */
  function bindSettingsEvents(tab) {
    const body = document.getElementById('settings-body');
    if (!body) return;

    // Sliders
    body.querySelectorAll('input[type="range"]').forEach(slider => {
      const valEl = document.getElementById(slider.id + '-val');
      if (!valEl) return;
      const unit = slider.dataset.unit || '';
      slider.addEventListener('input', () => { valEl.textContent = slider.value + unit; });
    });

    // Spat list (Audio tab)
    if (tab === 'audio') {
      body.querySelectorAll('.spat-item').forEach(item => {
        item.addEventListener('click', () => {
          body.querySelectorAll('.spat-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          // Mirror to main panel dropdown
          const spatSel = document.getElementById('spat-type');
          if (spatSel) spatSel.value = item.dataset.spat;
        });
      });
    }

    // Output matrix toggle (Generali tab)
    if (tab === 'generali') {
      body.querySelectorAll('.matrix-cell').forEach(cell => {
        cell.addEventListener('click', () => cell.classList.toggle('active'));
      });
    }

    // Rig checkbox select-all hint (Rig tab)
    if (tab === 'rig') {
      body.querySelectorAll('.speaker-item input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => {
          // Could update rig SVG visibility — placeholder
        });
      });
    }
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

  /** Reposition density dots to reflect current ease type + intensity. */
  function updateDots() {
    const dotsEl = document.getElementById('rh-dots');
    if (!dotsEl) return;
    const dots = dotsEl.querySelectorAll('.rh-dot');
    const N    = dots.length;
    dots.forEach((dot, i) => {
      const rawT  = (i + 0.5) / N;
      const eased = applyEase(rawT, state.easeType, state.easeIntensity);
      dot.style.left = (eased * 100).toFixed(2) + '%';
    });
  }

  function initReadhead() {
    // Generate 15 density dots, positioned via JS
    const dotsEl = document.getElementById('rh-dots');
    if (dotsEl) {
      dotsEl.innerHTML = Array(15).fill('<span class="rh-dot"></span>').join('');
      updateDots();
    }

    const track  = document.getElementById('rh-track');
    const marker = document.getElementById('rh-marker');
    if (!track || !marker) return;

    // Place marker at initial position
    setReadheadPos(state.readheadPos);

    // Drag
    let dragging = false;
    marker.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
    track.addEventListener('mousedown', e => {
      if (e.target === track || e.target === dotsEl) {
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

    // Ease type selector
    const easeEl = document.getElementById('rh-ease');
    if (easeEl) {
      easeEl.addEventListener('change', () => {
        state.easeType = easeEl.value;
        updateDots();
        applyReadheadToCircle(state.readheadPos);
      });
    }

    // Intensity slider — updates dots + circle in real time
    const forceEl    = document.getElementById('rh-force');
    const forceValEl = document.getElementById('rh-force-val');
    if (forceEl && forceValEl) {
      forceEl.addEventListener('input', () => {
        state.easeIntensity = Number(forceEl.value);
        forceValEl.textContent = forceEl.value + '%';
        updateDots();
        applyReadheadToCircle(state.readheadPos);
      });
    }
  }

  function setReadheadPos(pos) {
    const marker = document.getElementById('rh-marker');
    if (marker) marker.style.left = (pos * 100).toFixed(1) + '%';
  }

  /** Apply ease curve to raw readhead pos, then map to positionAngle on circle. */
  function applyReadheadToCircle(pos) {
    if (!window.CircleState || !window.CircleAPI) return;
    const easedPos = applyEase(pos, state.easeType, state.easeIntensity);
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
     TRANSPORT TOGGLE  (mockup play/pause — sweeps the readhead back and forth)
  ════════════════════════════════════════════════════════════════════════ */
  function playTick(ts) {
    if (!state.playing) return;
    if (playStart === null) playStart = ts;
    const t = ((ts - playStart) % PLAY_CYCLE_MS) / PLAY_CYCLE_MS; // 0..1
    const pos = t < 0.5 ? t * 2 : 2 - t * 2; // triangle wave 0 -> 1 -> 0
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
     HEIGHT SLIDER
  ════════════════════════════════════════════════════════════════════════ */
  function initHeightSlider() {
    const slider = document.getElementById('height-slider');
    const valEl  = document.getElementById('height-val');
    if (!slider || !valEl) return;

    slider.addEventListener('input', () => {
      const val = parseInt(slider.value, 10);
      valEl.textContent = val + '°';
      // Save to the currently selected arc
      if (window.CircleState && window.CircleState.arcs) {
        window.CircleState.arcs[window.CircleState.selected].height = val;
      }
      if (window.ArcsAPI) window.ArcsAPI.autosave();
    });

    const modeToggle = document.getElementById('height-mode-toggle');
    if (modeToggle) {
      modeToggle.addEventListener('click', () => {
        const mode = modeToggle.dataset.mode === 'sphere' ? 'hemisphere' : 'sphere';
        modeToggle.dataset.mode = mode;
        modeToggle.title = mode === 'sphere'
          ? 'Sfera (clic: semisfera)'
          : 'Semisfera (clic: sfera)';
        // Save mode to the currently selected arc
        if (window.CircleState && window.CircleState.arcs) {
          window.CircleState.arcs[window.CircleState.selected].heightMode = mode;
        }
        if (mode === 'sphere') {
          slider.min = '-90';
          valEl.textContent = slider.value + '°';
        } else {
          slider.min = '0';
          if (parseInt(slider.value, 10) < 0) { slider.value = '0'; }
          valEl.textContent = slider.value + '°';
        }
        if (window.ArcsAPI) {
          window.ArcsAPI.autosave();
          window.ArcsAPI.syncHeightSlider(window.CircleState.selected);
        }
      });
    }
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

    // Spat selector mirrors selection back if changed directly
    document.getElementById('spat-type')
      ?.addEventListener('change', () => { /* extend if needed */ });

    // Transport toggle (mockup play/pause)
    document.getElementById('transport-toggle')
      ?.addEventListener('click', () => setPlaying(!state.playing));
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
  };

  /* ═══════════════════════════════════════════════════════════════════════
     INIT
  ════════════════════════════════════════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    initReadhead();
    initHeightSlider();
    initResize();
    drawSlaveIndicator();
    // Init arc buttons + pattern bar (ArcsAPI defined in arcs.js)
    if (window.ArcsAPI) window.ArcsAPI.init();
    // Align position dot with initial readhead position
    applyReadheadToCircle(state.readheadPos);
  });
})();
