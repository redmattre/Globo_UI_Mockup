/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  arcs.js
   Multi-arc management: 8 color-coded slots, non-overlapping constraint,
   pattern presets (32 slots), multi-arc readhead path (0→1 proportional).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Pattern storage ────────────────────────────────────────────────────── */
  const patterns = Array(16).fill(null);
  let currentPattern = 0;
  let patternPos = 0;  // float 0.0–15.0 — may be fractional during morph drag

  function deepCopyArcs() {
    return JSON.parse(JSON.stringify(window.CircleState.arcs));
  }

  /* ── Subgroup selection (read/write the header's group checklist) ───────── */
  function getSelectedSubgroups() {
    return Array.from(document.querySelectorAll('#subgroup-menu .subgroup-item.active'))
      .map(function (item) { return item.dataset.subgroup; });
  }

  /** Small light-grey letter badge next to the subgroup button (e.g. "A, C"). */
  function updateSubgroupLetters() {
    const badge = document.getElementById('subgroup-letters');
    if (!badge) return;
    badge.textContent = getSelectedSubgroups()
      .map(function (s) { return s.toUpperCase(); })
      .join(', ');
  }

  function applySubgroups(list) {
    const menu = document.getElementById('subgroup-menu');
    if (!menu) return;
    const set = list || [];
    menu.querySelectorAll('.subgroup-item').forEach(function (item) {
      item.classList.toggle('active', set.indexOf(item.dataset.subgroup) !== -1);
    });
    updateSubgroupLetters();
  }

  /** Full snapshot saved into a pattern slot: arcs, subgroups, which movement
   *  paradigm is active (with its own parameters), speed range and transport
   *  (loop/direction) toggle state. */
  function snapshotState() {
    return {
      arcs:         deepCopyArcs(),
      subgroups:    getSelectedSubgroups(),
      module:       window.AppBridge   ? window.AppBridge.getCurrentModule()      : undefined,
      moduleParams: window.ModulesAPI  ? window.ModulesAPI.snapshotModuleParams() : {},
      speed:        window.SpeedRangeAPI ? window.SpeedRangeAPI.getValues()       : null,
      loop:      !!document.getElementById('loop-toggle')?.classList.contains('active'),
      direction: !!document.getElementById('direction-toggle')?.classList.contains('active'),
    };
  }

  /** Applies the module/params/speed/transport part of a snapshot (arcs and
   *  subgroups are handled separately by the caller). */
  function applyFullState(s) {
    if (s.module && window.AppBridge && window.AppBridge.switchModule) {
      window.AppBridge.switchModule(s.module, { skipAutosave: true });
    }
    if (window.ModulesAPI) window.ModulesAPI.applyModuleParams(s.moduleParams);
    if (s.speed && window.SpeedRangeAPI) window.SpeedRangeAPI.setValues(s.speed);

    const loopBtn = document.getElementById('loop-toggle');
    if (loopBtn) loopBtn.classList.toggle('active', !!s.loop);
    const dirBtn = document.getElementById('direction-toggle');
    if (dirBtn) dirBtn.classList.toggle('active', !!s.direction);
  }

  function autosave() {
    if (!window.CircleState) return;
    // Snap to nearest integer slot before saving
    const slot = Math.round(patternPos);
    patternPos = slot;
    currentPattern = slot;
    patterns[slot] = snapshotState();
    updatePatternSlider();
  }

  /* ── Arc button bar ─────────────────────────────────────────────────────── */
  function initArcButtons() {
    const bar = document.getElementById('arc-btn-bar');
    if (!bar) return;
    bar.innerHTML = '';

    (window.ARC_COLORS || []).forEach((color, i) => {
      const btn = document.createElement('button');
      btn.className = 'arc-btn';
      btn.dataset.arc = i;
      btn.style.setProperty('--arc-color', color);
      btn.textContent = i + 1;
      // Single click = toggle active state (only once the zone has been created)
      btn.addEventListener('click', () => toggleArc(i));
      bar.appendChild(btn);
    });

    updateArcButtons();
  }

  function updateArcButtons() {
    const cs = window.CircleState;
    if (!cs) return;
    document.querySelectorAll('.arc-btn').forEach(function (btn) {
      const i = parseInt(btn.dataset.arc, 10);
      const arc = cs.arcs[i];
      const created = !!(arc && arc.created);
      btn.classList.toggle('active',   !!(arc && arc.active));
      // Ring only tracks live hover on the circle — no fallback to last-selected
      btn.classList.toggle('selected', cs.hovered >= 0 && i === cs.hovered);
      btn.classList.toggle('locked',   !created);
      btn.title = 'Arco ' + (i + 1) + ' — ' + (created
        ? 'click: accendi / spegni'
        : 'crea questa zona cliccando sul cerchio');
    });
  }

  function toggleArc(idx) {
    if (!window.CircleState) return;
    var arc = window.CircleState.arcs[idx];
    if (!arc || !arc.created) return;
    arc.active = !arc.active;
    updateArcButtons();
    autosave();
    if (window.CircleAPI) window.CircleAPI.draw();
    var rpos = (window.AppBridge && window.AppBridge.getReadheadPos) ? window.AppBridge.getReadheadPos() : 0.4;
    applyReadhead(rpos);
  }

  /* ── Height slider sync ─────────────────────────────────────────────────── */
  function syncHeightSlider(idx) {
    if (!window.CircleState || !window.ARC_COLORS) return;
    var arc   = window.CircleState.arcs[idx];
    var color = window.ARC_COLORS[idx];
    if (!arc) return;

    var slider = document.getElementById('height-slider');
    var valEl  = document.getElementById('height-val');
    var lblTop = document.querySelector('.height-lbl.top');
    var lblBot = document.querySelector('.height-lbl.bot');

    if (slider) {
      slider.value = arc.height;
      slider.style.setProperty('--thumb-color', color);
      slider.min = arc.heightMode === 'sphere' ? '-90' : '0';
    }
    if (valEl)  { valEl.textContent = arc.height + '°'; valEl.style.color = color; }
    if (lblTop) { lblTop.textContent = '90°'; }
    if (lblBot) { lblBot.textContent = arc.heightMode === 'sphere' ? '−90°' : '0°'; }

    document.querySelectorAll('.mode-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.mode === arc.heightMode);
    });
    var modeToggle = document.getElementById('height-mode-toggle');
    if (modeToggle) {
      modeToggle.dataset.mode = arc.heightMode;
      modeToggle.title = arc.heightMode === 'sphere'
        ? 'Sfera (clic: semisfera)'
        : 'Semisfera (clic: sfera)';
    }
  }

  /* ── Pattern slider (16 slots, drag to morph) ──────────────────────────── */

  /** Shortest-path angle interpolation (handles 0↔360 wrap) */
  function lerpAngle(a, b, t) {
    var diff = ((b - a) % 360 + 360) % 360;
    if (diff > 180) diff -= 360;
    return ((a + diff * t) % 360 + 360) % 360;
  }

  /**
   * Compute morphed state (arcs + subgroups) for a fractional pattern position.
   * Finds the nearest filled slots below and above pos, then interpolates.
   */
  function computeStateAtPos(pos) {
    // Search downward for a filled slot
    var srcLo = null, loIdx = Math.floor(pos);
    for (var i = Math.floor(pos); i >= 0; i--) {
      if (patterns[i]) { srcLo = patterns[i]; loIdx = i; break; }
    }
    // Search upward
    var srcHi = null, hiIdx = Math.ceil(pos);
    for (var j = Math.ceil(pos); j < 16; j++) {
      if (patterns[j]) { srcHi = patterns[j]; hiIdx = j; break; }
    }

    if (!srcLo && !srcHi) return snapshotState();
    if (!srcLo) return JSON.parse(JSON.stringify(srcHi));
    if (!srcHi) return JSON.parse(JSON.stringify(srcLo));
    if (loIdx === hiIdx)  return JSON.parse(JSON.stringify(srcLo));

    // Normalised t: 0 at loIdx, 1 at hiIdx
    var t = (pos - loIdx) / (hiIdx - loIdx);

    var arcs = srcLo.arcs.map(function (arcA, idx) {
      var arcB = srcHi.arcs[idx];
      return {
        active:     t < 0.5 ? arcA.active     : arcB.active,
        created:    t < 0.5 ? arcA.created    : arcB.created,
        left:       lerpAngle(arcA.left,  arcB.left,  t),
        right:      lerpAngle(arcA.right, arcB.right, t),
        height:     arcA.height + (arcB.height - arcA.height) * t,
        heightMode: t < 0.5 ? arcA.heightMode : arcB.heightMode,
      };
    });
    var subgroups = (t < 0.5 ? srcLo.subgroups : srcHi.subgroups).slice();
    var module    = t < 0.5 ? srcLo.module : srcHi.module;
    var moduleParams = JSON.parse(JSON.stringify(t < 0.5 ? srcLo.moduleParams : srcHi.moduleParams));

    // Speed is a plain min/max pair regardless of module — safe to lerp smoothly.
    var speed = null;
    if (srcLo.speed && srcHi.speed) {
      speed = {
        min: srcLo.speed.min + (srcHi.speed.min - srcLo.speed.min) * t,
        max: srcLo.speed.max + (srcHi.speed.max - srcLo.speed.max) * t,
      };
    } else {
      speed = t < 0.5 ? srcLo.speed : srcHi.speed;
    }

    var loop      = t < 0.5 ? srcLo.loop      : srcHi.loop;
    var direction = t < 0.5 ? srcLo.direction : srcHi.direction;

    return {
      arcs: arcs, subgroups: subgroups, module: module, moduleParams: moduleParams,
      speed: speed, loop: loop, direction: direction,
    };
  }

  function updatePatternSlider() {
    var thumb = document.getElementById('pattern-thumb');
    if (thumb) {
      // Center of slot i is at (i + 0.5) / 16 of track width
      thumb.style.left = ((patternPos + 0.5) / 16 * 100).toFixed(3) + '%';
    }
    var count = filledCount();
    document.querySelectorAll('.pslot').forEach(function (el) {
      var i = parseInt(el.dataset.slot, 10);
      var onActive  = (Math.round(patternPos) === i);
      var isMorphLo = (!onActive && Math.floor(patternPos) === i && patternPos !== Math.floor(patternPos));
      var isMorphHi = (!onActive && Math.ceil(patternPos)  === i && patternPos !== Math.ceil(patternPos));
      var filled = patterns[i] !== null;
      el.classList.toggle('filled',   filled);
      el.classList.toggle('active',   onActive);
      el.classList.toggle('morphing', !onActive && (isMorphLo || isMorphHi));
      el.title = filled
        ? 'Preset ' + (i + 1) + ' — clic: richiama · shift+clic: elimina'
        : (patternMode === 'buttons' && i === count ? 'Preset ' + (i + 1) + ' — clic: salva qui' : '');
    });
  }

  function setPatternPos(pos) {
    // No holes allowed: filled slots are always a contiguous run from 0,
    // so the reachable range simply stops at the last filled one.
    var maxPos = Math.max(0, filledCount() - 1);
    patternPos = Math.max(0, Math.min(maxPos, pos));
    var morphed = computeStateAtPos(patternPos);
    window.CircleState.arcs = morphed.arcs;
    applySubgroups(morphed.subgroups);
    applyFullState(morphed);
    currentPattern = Math.round(patternPos);
    updatePatternSlider();
    updateArcButtons();
    syncHeightSlider(window.CircleState.selected);
    if (window.CircleAPI) window.CircleAPI.draw();
    var rpos = (window.AppBridge && window.AppBridge.getReadheadPos) ? window.AppBridge.getReadheadPos() : 0.4;
    applyReadhead(rpos);
  }

  /* ── Preset memory: contiguous, no holes ─────────────────────────────────
     Filled slots always occupy indices [0, filledCount()-1]. Creating always
     appends at the end; deleting always compacts what follows. */
  function filledCount() {
    var n = 0;
    while (n < 16 && patterns[n] !== null) n++;
    return n;
  }

  /** Load an existing preset by index (clamped to the filled range). */
  function loadPreset(idx) {
    var count = filledCount();
    if (count === 0) return;
    setPatternPos(Math.max(0, Math.min(idx, count - 1)));
  }

  /** Save the current live state as a brand-new preset — always at the next
   *  free slot, regardless of which empty slot was clicked. */
  function createPreset() {
    var count = filledCount();
    if (count >= 16) return; // memory full
    patterns[count] = snapshotState();
    setPatternPos(count);
  }

  /** Remove a preset and shift everything after it down, so no gap is left.
   *  Refuses to delete the last remaining preset — there must always be one. */
  function deletePreset(idx) {
    var count = filledCount();
    if (idx >= count || count <= 1) return;
    patterns.splice(idx, 1);
    patterns.push(null);
    // Round first: if we were mid-drag (fractional patternPos), we still want
    // to land exactly on a real preset, not an interpolated position.
    loadPreset(Math.min(Math.round(patternPos), count - 2));
  }

  var patternMode = 'buttons'; // 'buttons' | 'slider'

  function setPatternMode(mode) {
    patternMode = mode;
    var bar    = document.getElementById('pattern-bar');
    var toggle = document.getElementById('pattern-mode-toggle');
    if (bar) {
      bar.dataset.mode = mode;
      bar.style.cursor = mode === 'slider' ? 'ew-resize' : 'pointer';
    }
    if (toggle) {
      toggle.dataset.mode = mode;
      toggle.title = mode === 'buttons'
        ? 'Modalità a bottoni (clic: passa a slider)'
        : 'Modalità slider (clic: passa a bottoni)';
    }
    updatePatternSlider();
  }

  function initPatterns() {
    var bar = document.getElementById('pattern-bar');
    if (!bar) return;
    bar.innerHTML = '';

    // Create 16 slot markers
    for (var i = 0; i < 16; i++) {
      var slot = document.createElement('div');
      slot.className = 'pslot' + (i === 0 ? ' active filled' : '');
      slot.dataset.slot = i;
      slot.textContent = i + 1;
      bar.appendChild(slot);
    }

    // Draggable thumb (slider mode position indicator)
    var thumb = document.createElement('div');
    thumb.className = 'pthumb';
    thumb.id = 'pattern-thumb';
    bar.appendChild(thumb);

    // Seed slot 0
    patterns[0] = snapshotState();
    updatePatternSlider();

    /* ── Buttons mode: click a slot to load it, click empty space to create
       a new one at the frontier, shift-click a filled slot to delete it ── */
    bar.addEventListener('click', function (e) {
      if (patternMode !== 'buttons') return;
      var slotEl = e.target.closest('.pslot');
      if (!slotEl) return;
      var idx   = parseInt(slotEl.dataset.slot, 10);
      var count = filledCount();
      if (e.shiftKey) {
        if (idx < count) deletePreset(idx);
        return;
      }
      if (idx < count) loadPreset(idx);
      else createPreset();
    });

    /* ── Slider mode: drag to morph between existing presets only; the
       range stops at the last filled slot. Shift-click still deletes. ── */
    var isDragging = false;

    function posFromEvent(e) {
      var rect = bar.getBoundingClientRect();
      var x = (e.clientX - rect.left) / rect.width;
      // Each slot occupies 1/16; slot i centre at (i+0.5)/16
      return Math.max(0, Math.min(15, x * 16 - 0.5));
    }

    bar.addEventListener('mousedown', function (e) {
      if (patternMode !== 'slider') return;
      if (e.shiftKey) {
        var slotEl = e.target.closest('.pslot');
        if (slotEl) {
          var idx = parseInt(slotEl.dataset.slot, 10);
          if (idx < filledCount()) deletePreset(idx);
        }
        return;
      }
      isDragging = true;
      setPatternPos(posFromEvent(e));
      e.preventDefault();
    });

    window.addEventListener('mousemove', function (e) {
      if (!isDragging) return;
      setPatternPos(posFromEvent(e));
    });

    window.addEventListener('mouseup', function () {
      isDragging = false;
    });

    // Mode toggle
    var modeToggle = document.getElementById('pattern-mode-toggle');
    if (modeToggle) {
      modeToggle.addEventListener('click', function () {
        setPatternMode(patternMode === 'buttons' ? 'slider' : 'buttons');
      });
    }
    setPatternMode('buttons');
  }

  /* ── Multi-arc readhead path ────────────────────────────────────────────── */
  // Active arcs sorted clockwise by left angle (ascending 0°→359°).
  // The 0→1 range covers ONLY active arcs proportionally.
  // Gaps are NOT part of the 0→1 space — the position dot jumps across them.
  function computePositionAngle(pos) {
    var cs = window.CircleState;
    if (!cs) return 0;

    var active = cs.arcs
      .filter(function (a) { return a.active; })
      .map(function (a) { return { left: a.left, right: a.right }; })
      .sort(function (a, b) { return a.left - b.left; });

    if (active.length === 0) return 0;

    var spans = active.map(function (a) {
      var s = ((a.right - a.left) + 360) % 360;
      return s < 0.01 ? 359.5 : s;
    });
    var total = spans.reduce(function (sum, v) { return sum + v; }, 0);
    if (total === 0) return active[0].left;

    var cum = 0;
    for (var i = 0; i < active.length; i++) {
      var share = spans[i] / total;
      if (pos <= cum + share || i === active.length - 1) {
        var local = Math.min(1, (pos - cum) / Math.max(share, 1e-6));
        return ((active[i].left + local * spans[i]) + 360) % 360;
      }
      cum += share;
    }
    return active[active.length - 1].right;
  }

  function applyReadhead(pos) {
    if (!window.CircleState || !window.CircleAPI) return;
    window.CircleState.positionAngle = computePositionAngle(pos);
    window.CircleAPI.draw();
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  window.ArcsAPI = {
    init: function () {
      initArcButtons();
      initPatterns();
      syncHeightSlider(window.CircleState ? window.CircleState.selected : 0);
      updateSubgroupLetters();
    },
    toggleArc:            toggleArc,
    updateArcButtons:     updateArcButtons,
    syncHeightSlider:     syncHeightSlider,
    computePositionAngle: computePositionAngle,
    autosave:             autosave,
    applyReadhead:        applyReadhead,
    refreshSubgroupBadge: updateSubgroupLetters,
  };
})();
