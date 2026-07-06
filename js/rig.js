/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  rig.js
   Rig settings tab: speaker roster (inline position editor, polar <->
   cartesian, drag-to-scrub numboxes), isometric placement preview, and
   speaker subsets (groups).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Coordinate conversion ─────────────────────────────────────────────── */
  // "Distance" is unitless, 0-2, where 1 = the rig's base/reference distance.
  var BASE_DISTANCE_M = 1.5;

  function polarToCartesian(az, el, dist) {
    var r = dist * BASE_DISTANCE_M;
    var azRad = az * Math.PI / 180;
    var elRad = el * Math.PI / 180;
    return {
      x: r * Math.cos(elRad) * Math.sin(azRad),
      y: r * Math.cos(elRad) * Math.cos(azRad),
      z: r * Math.sin(elRad),
    };
  }

  function cartesianToPolar(x, y, z) {
    var r = Math.sqrt(x * x + y * y + z * z);
    var az = r === 0 ? 0 : Math.atan2(x, y) * 180 / Math.PI;
    var el = r === 0 ? 0 : Math.asin(z / r) * 180 / Math.PI;
    return {
      az:   (az + 360) % 360,
      el:   el,
      dist: r / BASE_DISTANCE_M,
    };
  }

  /* ── State ─────────────────────────────────────────────────────────────── */
  var speakers = [
    { id: 1,  name: 'FL',   az: 0,   el: 0  },
    { id: 2,  name: 'FRC',  az: 45,  el: 0  },
    { id: 3,  name: 'FR',   az: 90,  el: 0  },
    { id: 4,  name: 'BRC',  az: 135, el: 0  },
    { id: 5,  name: 'BR',   az: 180, el: 0  },
    { id: 6,  name: 'BLC',  az: 225, el: 0  },
    { id: 7,  name: 'BL',   az: 270, el: 0  },
    { id: 8,  name: 'FLC',  az: 315, el: 0  },
    { id: 9,  name: 'HL',   az: 0,   el: 45 },
    { id: 10, name: 'HR',   az: 90,  el: 45 },
    { id: 11, name: 'HL2',  az: 180, el: 45 },
    { id: 12, name: 'TOP',  az: 0,   el: 90 },
  ].map(function (s) { s.dist = 1; s.subsets = { a: true }; return s; });

  var nextSpeakerId     = 13;
  var selectedSpeakerId = speakers[0].id;

  var subsets = [{ id: 'a', name: 'Subset A' }];
  var nextSubsetCharCode = 66; // 'B'
  var selectedSubsetId   = 'a';

  var leftView = 'viz'; // 'viz' | 'subsets'

  function findSpeaker(id) {
    for (var i = 0; i < speakers.length; i++) if (speakers[i].id === id) return speakers[i];
    return null;
  }
  function subsetName(id) {
    var su = subsets.filter(function (s) { return s.id === id; })[0];
    return su ? su.name : '';
  }

  /* ── Isometric placement preview (3/4 view from above) ───────────────────
     Classic 2:1 dimetric projection: camera looking down at ~35° — the
     same projection used by top-down strategy-game sprites. */
  function isoProject(x, y, z) {
    var cos30 = Math.cos(Math.PI / 6), sin30 = Math.sin(Math.PI / 6);
    return { sx: (x - y) * cos30, sy: (x + y) * sin30 - z };
  }

  function axisColors() {
    var p = window.ARC_COLORS || [];
    return { x: p[0] || '#E03A3E', y: p[4] || '#61BB46', z: p[2] || '#009DDC' };
  }

  function seg(CX, CY, SCALE, p1, p2, stroke, width, dash) {
    return '<line x1="' + (CX + p1.sx * SCALE).toFixed(1) + '" y1="' + (CY + p1.sy * SCALE).toFixed(1) +
           '" x2="' + (CX + p2.sx * SCALE).toFixed(1) + '" y2="' + (CY + p2.sy * SCALE).toFixed(1) +
           '" stroke="' + stroke + '" stroke-width="' + width + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>';
  }

  /** Floor grid + outer boundary, clipped to the max usable radius (dist=2). */
  function renderFloorGrid(CX, CY, SCALE) {
    var s = '';
    var MAXR = 2 * BASE_DISTANCE_M;
    var STEP = BASE_DISTANCE_M;
    var lines = [-MAXR, -STEP, 0, STEP, MAXR];

    lines.forEach(function (g) {
      var half = Math.sqrt(Math.max(0, MAXR * MAXR - g * g));
      if (half > 0.01) {
        s += seg(CX, CY, SCALE, isoProject(-half, g, 0), isoProject(half, g, 0), 'var(--border)', 0.75);
        s += seg(CX, CY, SCALE, isoProject(g, -half, 0), isoProject(g, half, 0), 'var(--border)', 0.75);
      }
    });

    var pts = [];
    for (var a = 0; a <= 360; a += 12) {
      var rad = a * Math.PI / 180;
      var p = isoProject(MAXR * Math.sin(rad), MAXR * Math.cos(rad), 0);
      pts.push((CX + p.sx * SCALE).toFixed(1) + ',' + (CY + p.sy * SCALE).toFixed(1));
    }
    s += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--border-strong)" stroke-width="1"/>';

    // Height reference guide (dashed, up to the max elevation)
    var top = isoProject(0, 0, MAXR);
    s += seg(CX, CY, SCALE, { sx: 0, sy: 0 }, top, 'var(--border-strong)', 1, '2 2');

    return s;
  }

  /** Small colored X/Y/Z gizmo at the world origin, for orientation. */
  function renderGizmo(CX, CY, SCALE) {
    var GIZMO_LEN = 0.6;
    var colors = axisColors();
    var axes = [
      { end: [GIZMO_LEN, 0, 0], color: colors.x, label: 'X' },
      { end: [0, GIZMO_LEN, 0], color: colors.y, label: 'Y' },
      { end: [0, 0, GIZMO_LEN], color: colors.z, label: 'Z' },
    ];
    var s = '';
    axes.forEach(function (ax) {
      var p  = isoProject(ax.end[0], ax.end[1], ax.end[2]);
      var x2 = (CX + p.sx * SCALE).toFixed(1), y2 = (CY + p.sy * SCALE).toFixed(1);
      s += '<line x1="' + CX + '" y1="' + CY + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + ax.color + '" stroke-width="1.6"/>';
      s += '<text x="' + x2 + '" y="' + (parseFloat(y2) - 3).toFixed(1) + '" font-size="7" font-weight="600" fill="' + ax.color +
           '" text-anchor="middle" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">' + ax.label + '</text>';
    });
    s += '<circle cx="' + CX + '" cy="' + CY + '" r="1.5" fill="var(--border-strong)"/>';
    return s;
  }

  function renderVizContent() {
    var CX = 100, CY = 128, SCALE = 34;
    var s = '';
    s += renderFloorGrid(CX, CY, SCALE);
    s += renderGizmo(CX, CY, SCALE);

    var withProj = speakers.map(function (sp) {
      var c = polarToCartesian(sp.az, sp.el, sp.dist);
      var p = isoProject(c.x, c.y, c.z);
      return { sp: sp, depth: c.y - c.z, sx: p.sx, sy: p.sy };
    });
    withProj.sort(function (a, b) { return a.depth - b.depth; }); // painter's algorithm

    withProj.forEach(function (item) {
      var px = (CX + item.sx * SCALE).toFixed(1);
      var py = (CY + item.sy * SCALE).toFixed(1);
      if (item.sp.id === selectedSpeakerId) {
        s += '<circle class="rig-dot-ring" cx="' + px + '" cy="' + py + '" r="6" fill="none" stroke="var(--ink)" stroke-width="1.3"/>';
      }
      s += '<circle class="rig-dot" data-speaker="' + item.sp.id + '" cx="' + px + '" cy="' + py + '" r="3.5" fill="var(--ink)"/>';
      s += '<text class="rig-dot-label" data-speaker="' + item.sp.id + '" x="' + px + '" y="' + (parseFloat(py) - 7).toFixed(1) +
           '" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">' + item.sp.id + '</text>';
    });

    return s;
  }

  function renderViz() {
    return (
      '<div class="rig-viz">' +
        '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="width:100%; aspect-ratio:1; display:block;">' +
          '<g id="rig-viz-content">' + renderVizContent() + '</g>' +
        '</svg>' +
      '</div>'
    );
  }

  function refreshVizOnly() {
    var g = document.getElementById('rig-viz-content');
    if (g) g.innerHTML = renderVizContent();
  }

  /* ── Subsets (groups) list ─────────────────────────────────────────────── */
  function renderSubsets() {
    var rows = subsets.map(function (su) {
      return (
        '<li class="rig-subset-item' + (su.id === selectedSubsetId ? ' active' : '') + '" data-subset="' + su.id + '">' +
          '<span class="rig-subset-name">' + su.name + '</span>' +
        '</li>'
      );
    }).join('');

    return (
      '<ul class="rig-subset-list" id="rig-subset-list">' + rows + '</ul>' +
      '<div class="rig-toolbar">' +
        '<button class="rig-tool-btn" id="rig-add-subset" title="Aggiungi subset">' + icoPlus() + '</button>' +
        '<button class="rig-tool-btn" id="rig-del-subset" title="Elimina subset"' + (subsets.length <= 1 ? ' disabled' : '') + '>' + icoTrash() + '</button>' +
      '</div>'
    );
  }

  /* ── Left column: view toggle + active view ───────────────────────────── */
  function icoPlus() {
    return '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"><line x1="9" y1="3.5" x2="9" y2="14.5" stroke="currentColor" stroke-width="1.4"/><line x1="3.5" y1="9" x2="14.5" y2="9" stroke="currentColor" stroke-width="1.4"/></svg>';
  }
  function icoTrash() {
    return '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"><line x1="3.5" y1="5.5" x2="14.5" y2="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 5.5 V4 a1 1 0 0 1 1 -1 h3 a1 1 0 0 1 1 1 v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.8 5.5 L6.4 14 a1 1 0 0 0 1 0.9 h3.6 a1 1 0 0 0 1 -0.9 L12.2 5.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  }

  function renderLeft() {
    return (
      '<div class="rig-view-toggle" id="rig-view-toggle">' +
        '<button class="rig-view-btn' + (leftView === 'viz' ? ' active' : '') + '" data-view="viz" title="Visualizzazione">' +
          '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2 L15.5 5.5 V12.5 L9 16 L2.5 12.5 V5.5 Z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9 2 V9 M9 9 L15.5 5.5 M9 9 L2.5 5.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>' +
        '</button>' +
        '<button class="rig-view-btn' + (leftView === 'subsets' ? ' active' : '') + '" data-view="subsets" title="Sottogruppi">' +
          '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"><circle cx="5" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="13" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="5" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>' +
        '</button>' +
      '</div>' +
      '<div id="rig-left-body">' + (leftView === 'viz' ? renderViz() : renderSubsets()) + '</div>'
    );
  }

  /* ── Right column: speaker roster, inline position controls ─────────────── */
  var VAL_FIELDS = [
    { key: 'az',   label: 'Az',   step: 1,    decimals: 0 },
    { key: 'el',   label: 'El',   step: 1,    decimals: 0 },
    { key: 'dist', label: 'Dist', step: 0.01, decimals: 2 },
    { key: 'x',    label: 'X',    step: 0.02, decimals: 2 },
    { key: 'y',    label: 'Y',    step: 0.02, decimals: 2 },
    { key: 'z',    label: 'Z',    step: 0.02, decimals: 2 },
  ];

  function fieldValue(sp, key) {
    if (key === 'az' || key === 'el' || key === 'dist') return sp[key];
    var c = polarToCartesian(sp.az, sp.el, sp.dist);
    return c[key];
  }

  function renderHead() {
    return (
      '<div class="rig-list-head">' +
        '<span class="rig-check-spacer"></span>' +
        '<span class="speaker-num"></span>' +
        '<span class="speaker-name"></span>' +
        VAL_FIELDS.map(function (f) { return '<span class="rig-col-lbl">' + f.label + '</span>'; }).join('') +
      '</div>'
    );
  }

  function renderRow(sp) {
    var checked = !!sp.subsets[selectedSubsetId];
    var fields = VAL_FIELDS.map(function (f) {
      var v = fieldValue(sp, f.key);
      return '<input type="number" class="rig-input rig-scrub mono" data-speaker="' + sp.id + '" data-field="' + f.key +
             '" step="' + f.step + '" value="' + v.toFixed(f.decimals) + '">';
    }).join('');

    return (
      '<li class="speaker-item' + (sp.id === selectedSpeakerId ? ' selected' : '') + '" data-speaker="' + sp.id + '">' +
        '<button class="rig-check' + (checked ? ' checked' : '') + '" data-speaker-check="' + sp.id + '" title="Appartiene al ' + subsetName(selectedSubsetId) + '"></button>' +
        '<span class="speaker-num mono">' + String(sp.id).padStart(2, '0') + '</span>' +
        '<span class="speaker-name">' + sp.name + '</span>' +
        fields +
      '</li>'
    );
  }

  function renderRight() {
    return (
      renderHead() +
      '<ul class="speaker-list" id="rig-speaker-list">' + speakers.map(renderRow).join('') + '</ul>' +
      '<div class="rig-toolbar">' +
        '<button class="rig-tool-btn" id="rig-add-speaker" title="Aggiungi altoparlante">' + icoPlus() + '</button>' +
        '<button class="rig-tool-btn" id="rig-del-speaker" title="Elimina altoparlante selezionato"' + (selectedSpeakerId == null ? ' disabled' : '') + '>' + icoTrash() + '</button>' +
      '</div>'
    );
  }

  /* ── Top-level render ──────────────────────────────────────────────────── */
  function render() {
    return (
      '<div class="settings-left rig-left">' + renderLeft() + '</div>' +
      '<div class="settings-right rig-right">' + renderRight() + '</div>'
    );
  }

  /* ── Targeted refreshes (avoid nuking focus / in-progress edits) ────────── */
  function refreshRight() {
    var right = document.querySelector('.rig-right');
    if (!right) return;
    right.innerHTML = renderRight();
    bindRight();
    if (leftView === 'viz') refreshVizOnly();
  }

  function setLeftView(view) {
    leftView = view;
    document.querySelectorAll('.rig-view-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    var bodyEl = document.getElementById('rig-left-body');
    if (bodyEl) {
      bodyEl.innerHTML = view === 'viz' ? renderViz() : renderSubsets();
      bindLeftBody();
    }
  }

  function selectSpeaker(id) {
    selectedSpeakerId = id;
    document.querySelectorAll('.speaker-item.selected').forEach(function (el) { el.classList.remove('selected'); });
    var row = document.querySelector('.speaker-item[data-speaker="' + id + '"]');
    if (row) row.classList.add('selected');
    var del = document.getElementById('rig-del-speaker');
    if (del) del.removeAttribute('disabled');
    if (leftView === 'viz') refreshVizOnly();
  }

  function selectSubset(id) {
    selectedSubsetId = id;
    document.querySelectorAll('.rig-subset-item.active').forEach(function (el) { el.classList.remove('active'); });
    var item = document.querySelector('.rig-subset-item[data-subset="' + id + '"]');
    if (item) item.classList.add('active');
    speakers.forEach(function (sp) {
      var btn = document.querySelector('.rig-check[data-speaker-check="' + sp.id + '"]');
      if (btn) {
        btn.classList.toggle('checked', !!sp.subsets[id]);
        btn.title = 'Appartiene al ' + subsetName(id);
      }
    });
  }

  function toggleMembership(speakerId) {
    var sp = findSpeaker(speakerId);
    if (!sp) return;
    sp.subsets[selectedSubsetId] = !sp.subsets[selectedSubsetId];
    var btn = document.querySelector('.rig-check[data-speaker-check="' + speakerId + '"]');
    if (btn) btn.classList.toggle('checked', !!sp.subsets[selectedSubsetId]);
  }

  function addSpeaker() {
    var id = nextSpeakerId++;
    var subsetFlags = {};
    subsetFlags[subsets[0].id] = true; // new speakers join the first subset by default
    speakers.push({ id: id, name: 'SPK' + String(id).padStart(2, '0'), az: 0, el: 0, dist: 1, subsets: subsetFlags });
    selectedSpeakerId = id;
    refreshRight();
  }

  function deleteSelectedSpeaker() {
    var idx = speakers.findIndex(function (s) { return s.id === selectedSpeakerId; });
    if (idx === -1) return;
    speakers.splice(idx, 1);
    selectedSpeakerId = speakers.length ? speakers[Math.min(idx, speakers.length - 1)].id : null;
    refreshRight();
  }

  function addSubset() {
    var letter = String.fromCharCode(nextSubsetCharCode++);
    var id = 'subset-' + letter.toLowerCase();
    subsets.push({ id: id, name: 'Subset ' + letter });
    selectedSubsetId = id;
    setLeftView('subsets');
  }

  function deleteSubset(id) {
    if (subsets.length <= 1) return;
    var idx = subsets.findIndex(function (s) { return s.id === id; });
    if (idx === -1) return;
    subsets.splice(idx, 1);
    speakers.forEach(function (sp) { delete sp.subsets[id]; });
    if (selectedSubsetId === id) selectedSubsetId = subsets[Math.max(0, idx - 1)].id;
    setLeftView('subsets');
  }

  /* ── Inline field editing: polar <-> cartesian, never touches the field
     currently being typed into (or its own group), only the other trio ─── */
  function fieldEl(id, field) {
    return document.querySelector('.rig-scrub[data-speaker="' + id + '"][data-field="' + field + '"]');
  }
  function setRowField(id, field, val) {
    var el = fieldEl(id, field);
    if (el) el.value = val;
  }
  function getRowFieldNum(id, field) {
    var el = fieldEl(id, field);
    return el ? parseFloat(el.value) || 0 : 0;
  }

  function onFieldInput(e) {
    var input = e.target.closest('.rig-scrub');
    if (!input) return;
    var id    = Number(input.dataset.speaker);
    var field = input.dataset.field;
    var sp    = findSpeaker(id);
    if (!sp) return;
    var val = parseFloat(input.value);
    if (isNaN(val)) return;

    if (field === 'az' || field === 'el' || field === 'dist') {
      if (field === 'az')      sp.az   = ((val % 360) + 360) % 360;
      else if (field === 'el') sp.el   = Math.max(-90, Math.min(90, val));
      else                     sp.dist = Math.max(0, Math.min(2, val));
      var c = polarToCartesian(sp.az, sp.el, sp.dist);
      setRowField(id, 'x', c.x.toFixed(2));
      setRowField(id, 'y', c.y.toFixed(2));
      setRowField(id, 'z', c.z.toFixed(2));
    } else {
      var x = field === 'x' ? val : getRowFieldNum(id, 'x');
      var y = field === 'y' ? val : getRowFieldNum(id, 'y');
      var z = field === 'z' ? val : getRowFieldNum(id, 'z');
      var polar = cartesianToPolar(x, y, z);
      sp.az   = polar.az;
      sp.el   = Math.max(-90, Math.min(90, polar.el));
      sp.dist = Math.max(0, Math.min(2, polar.dist));
      setRowField(id, 'az',   sp.az.toFixed(0));
      setRowField(id, 'el',   sp.el.toFixed(0));
      setRowField(id, 'dist', sp.dist.toFixed(2));
    }

    if (leftView === 'viz') refreshVizOnly();
  }

  /* ── Drag-to-scrub: click focuses + selects text (punch in values),
     dragging vertically past a small threshold scrubs the value ─────────── */
  var FIELD_RANGE = { az: null, el: [-90, 90], dist: [0, 2] }; // az wraps instead of clamping

  function makeScrubbable(input) {
    input.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var field  = input.dataset.field;
      var meta   = VAL_FIELDS.filter(function (f) { return f.key === field; })[0] || { step: 0.02, decimals: 2 };
      var startY = e.clientY;
      var startVal = parseFloat(input.value) || 0;
      var moved  = false;

      function onMove(e2) {
        var dy = startY - e2.clientY;
        if (!moved && Math.abs(dy) < 3) return;
        moved = true;
        document.body.classList.add('rig-scrubbing');
        var next = startVal + dy * meta.step;
        if (field === 'az') next = ((next % 360) + 360) % 360;
        else if (FIELD_RANGE[field]) next = Math.max(FIELD_RANGE[field][0], Math.min(FIELD_RANGE[field][1], next));
        input.value = next.toFixed(meta.decimals);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      function onUp() {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.classList.remove('rig-scrubbing');
        if (!moved) { input.focus(); input.select(); }
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  /* ── Bind events ───────────────────────────────────────────────────────── */
  function bindLeftBody() {
    if (leftView === 'viz') {
      var viz = document.getElementById('rig-viz-content');
      if (viz) {
        viz.addEventListener('click', function (e) {
          var dot = e.target.closest('[data-speaker]');
          if (dot) selectSpeaker(Number(dot.dataset.speaker));
        });
      }
    } else {
      var subsetList = document.getElementById('rig-subset-list');
      if (subsetList) {
        subsetList.addEventListener('click', function (e) {
          var item = e.target.closest('.rig-subset-item');
          if (item) selectSubset(item.dataset.subset);
        });
      }
      document.getElementById('rig-add-subset')?.addEventListener('click', addSubset);
      document.getElementById('rig-del-subset')?.addEventListener('click', function () { deleteSubset(selectedSubsetId); });
    }
  }

  function bindLeft() {
    document.getElementById('rig-view-toggle')?.addEventListener('click', function (e) {
      var btn = e.target.closest('.rig-view-btn');
      if (btn) setLeftView(btn.dataset.view);
    });
    bindLeftBody();
  }

  function bindRight() {
    var list = document.getElementById('rig-speaker-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var checkBtn = e.target.closest('[data-speaker-check]');
        if (checkBtn) { toggleMembership(Number(checkBtn.dataset.speakerCheck)); return; }
        var row = e.target.closest('.speaker-item');
        if (row) selectSpeaker(Number(row.dataset.speaker));
      });
      list.addEventListener('input', onFieldInput);
      list.querySelectorAll('.rig-scrub').forEach(makeScrubbable);
    }
    document.getElementById('rig-add-speaker')?.addEventListener('click', addSpeaker);
    document.getElementById('rig-del-speaker')?.addEventListener('click', deleteSelectedSpeaker);
  }

  function bind() {
    bindLeft();
    bindRight();
  }

  /* ── Public API ────────────────────────────────────────────────────────── */
  function getSpeakers() {
    return speakers.map(function (sp) { return { id: sp.id, name: sp.name }; });
  }

  window.RigAPI = { render: render, bind: bind, getSpeakers: getSpeakers };
})();
