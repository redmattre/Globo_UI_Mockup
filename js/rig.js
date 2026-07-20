/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  rig.js
   Rig settings tab: speaker roster (inline position editor, polar <->
   cartesian, drag-to-scrub numboxes, drag-to-reorder, rename/renumber,
   single-tag subset assignment), isometric placement preview.
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

  /** ±180° display convention (0=front, positive clockwise/right, negative
   *  counter-clockwise/left) — same as the main panning circle's own handle
   *  editor (circle.js's toDisplay/toInternal). Azimuth is still STORED
   *  0-359 internally (all the polar/cartesian math above expects that);
   *  only the roster's displayed/typed number uses ±180. */
  function normAz360(d) { return ((d % 360) + 360) % 360; }
  function azToDisplay(d) { var n = normAz360(d); return n > 180 ? n - 360 : n; }

  /* ── Subset tags — a fixed set of 16 (A-P), always all present. There's no
     add/remove/rename: every speaker is always tagged with exactly one of
     them (default 'a'), and a tag with nobody in it just doesn't do
     anything — simpler and more predictable than the earlier dynamic
     add/delete-subset design. */
  var SUBSET_COUNT = 16;
  var subsets = [];
  (function seedSubsets() {
    for (var i = 0; i < SUBSET_COUNT; i++) {
      var letter = String.fromCharCode(65 + i); // 'A'..'P'
      subsets.push({ id: letter.toLowerCase(), name: 'Subset ' + letter });
    }
  })();

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
  ].map(function (s) { s.dist = 1; s.subsetTag = 'a'; return s; });

  var nextSpeakerId     = 13;
  var selectedSpeakerId = speakers[0].id;

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
     same projection used by top-down strategy-game sprites. Grab-drag to
     orbit around Z, same interaction as the main panning page's isometric
     view (see circle-iso.js) — vizRotationDeg rotates every world point
     (grid, gizmo, speakers) before projecting, so the whole scene turns
     together rather than the speakers sliding across a static-looking grid. */
  var vizRotationDeg = 0;

  function rotateXY(x, y) {
    var rad = vizRotationDeg * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  }

  function isoProject(x, y, z) {
    var r = rotateXY(x, y);
    var cos30 = Math.cos(Math.PI / 6), sin30 = Math.sin(Math.PI / 6);
    return { sx: (r.x - r.y) * cos30, sy: (r.x + r.y) * sin30 - z };
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
    // Invisible full-canvas background — an SVG <g>/<svg> has no paint of
    // its own, so without this, clicking anywhere that isn't directly on a
    // grid line or a dot never reaches onVizRotateDown at all (no element
    // is actually "hit" there). fill="transparent" (not "none") is what
    // makes empty space count as painted for hit-testing purposes, same
    // trick used for the sector hit-areas on the main panning circle.
    s += '<rect x="0" y="0" width="200" height="200" fill="transparent"/>';
    s += renderFloorGrid(CX, CY, SCALE);
    s += renderGizmo(CX, CY, SCALE);

    var withProj = speakers.map(function (sp) {
      var c = polarToCartesian(sp.az, sp.el, sp.dist);
      var p = isoProject(c.x, c.y, c.z);
      var r = rotateXY(c.x, c.y); // depth must follow the current orbit, not the unrotated world
      return { sp: sp, c: c, depth: r.y - c.z, sx: p.sx, sy: p.sy };
    });
    withProj.sort(function (a, b) { return a.depth - b.depth; }); // painter's algorithm

    // Depth cue #1: nearer speakers draw slightly bigger — cheap (just a
    // radius lerp over depth already computed above), but on its own the
    // isometric shift alone reads as "same size dot moved a bit", not depth.
    var depths  = withProj.map(function (it) { return it.depth; });
    var minD    = Math.min.apply(null, depths);
    var maxD    = Math.max.apply(null, depths);
    var spanD   = (maxD - minD) || 1;

    withProj.forEach(function (item) {
      var sp = item.sp;
      var px = (CX + item.sx * SCALE).toFixed(1);
      var py = (CY + item.sy * SCALE).toFixed(1);
      var t  = (item.depth - minD) / spanD; // 0 = farthest, 1 = nearest
      var r  = 2.6 + t * 1.6;

      // Depth cue #2: a dashed "pole" down to the speaker's floor projection
      // plus a small hollow ring there — without this, elevation only shows
      // up as a subtle isometric offset, easily misread as azimuth/distance.
      if (Math.abs(sp.el) > 0.5) {
        var floorP = isoProject(item.c.x, item.c.y, 0);
        var fx = (CX + floorP.sx * SCALE).toFixed(1);
        var fy = (CY + floorP.sy * SCALE).toFixed(1);
        s += '<line x1="' + fx + '" y1="' + fy + '" x2="' + px + '" y2="' + py +
             '" stroke="var(--text-3)" stroke-width="0.75" stroke-dasharray="1.5 1.5"/>';
        s += '<circle cx="' + fx + '" cy="' + fy + '" r="1.8" fill="none" stroke="var(--text-3)" stroke-width="0.9"/>';
      }

      if (sp.id === selectedSpeakerId) {
        s += '<circle class="rig-dot-ring" cx="' + px + '" cy="' + py + '" r="' + (r + 2.5).toFixed(2) + '" fill="none" stroke="var(--ink)" stroke-width="1.3"/>';
      }
      s += '<circle class="rig-dot" data-speaker="' + sp.id + '" cx="' + px + '" cy="' + py + '" r="' + r.toFixed(2) + '" fill="var(--ink)"/>';
      s += '<text class="rig-dot-label" data-speaker="' + sp.id + '" x="' + px + '" y="' + (parseFloat(py) - r - 3.5).toFixed(1) +
           '" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">' + sp.id + '</text>';
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

  /** Grab-drag anywhere in the viz that isn't a speaker dot to orbit the
   *  scene, same gesture as the main panning page's isometric view. Window
   *  listeners are added/removed within this single call (not bound once at
   *  module load), matching makeScrubbable's pattern below — .rig-left is
   *  torn down and rebuilt every time the Rig tab is reopened, so anything
   *  bound persistently to `window` instead of to that throwaway DOM would
   *  quietly stack up one extra listener per visit. */
  var VIZ_ROTATE_SENSITIVITY = 0.6;
  function onVizRotateDown(e) {
    if (e.target.closest('[data-speaker]')) return;
    e.preventDefault();
    var startX = e.clientX;
    var startRotation = vizRotationDeg;
    document.body.classList.add('rig-viz-rotating');

    function onMove(e2) {
      var dx = e2.clientX - startX;
      vizRotationDeg = ((startRotation + dx * VIZ_ROTATE_SENSITIVITY) % 360 + 360) % 360;
      refreshVizOnly();
    }
    function onUp() {
      document.body.classList.remove('rig-viz-rotating');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /* ── Icons ───────────────────────────────────────────────────────────── */
  function icoPlus() {
    return '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"><line x1="9" y1="3.5" x2="9" y2="14.5" stroke="currentColor" stroke-width="1.4"/><line x1="3.5" y1="9" x2="14.5" y2="9" stroke="currentColor" stroke-width="1.4"/></svg>';
  }
  function icoTrash() {
    return '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true"><line x1="3.5" y1="5.5" x2="14.5" y2="5.5" stroke="currentColor" stroke-width="1.4"/><path d="M6.5 5.5 V4 a1 1 0 0 1 1 -1 h3 a1 1 0 0 1 1 1 v1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.8 5.5 L6.4 14 a1 1 0 0 0 1 0.9 h3.6 a1 1 0 0 0 1 -0.9 L12.2 5.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
  }
  function icoGrip() {
    return '<svg class="ico" viewBox="0 0 18 18" aria-hidden="true">' +
      '<circle cx="6" cy="4.5" r="1.2" fill="currentColor"/><circle cx="6" cy="9" r="1.2" fill="currentColor"/><circle cx="6" cy="13.5" r="1.2" fill="currentColor"/>' +
      '<circle cx="12" cy="4.5" r="1.2" fill="currentColor"/><circle cx="12" cy="9" r="1.2" fill="currentColor"/><circle cx="12" cy="13.5" r="1.2" fill="currentColor"/>' +
      '</svg>';
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
    if (key === 'az') return azToDisplay(sp.az);
    if (key === 'el' || key === 'dist') return sp[key];
    var c = polarToCartesian(sp.az, sp.el, sp.dist);
    return c[key];
  }

  function renderHead() {
    return (
      '<div class="rig-list-head">' +
        '<span class="rig-drag-spacer"></span>' +
        '<span class="rig-tag-lbl">Tag</span>' +
        '<span class="speaker-num"></span>' +
        '<span class="speaker-name"></span>' +
        VAL_FIELDS.map(function (f) { return '<span class="rig-col-lbl">' + f.label + '</span>'; }).join('') +
      '</div>'
    );
  }

  function renderRow(sp) {
    var fields = VAL_FIELDS.map(function (f) {
      var v = fieldValue(sp, f.key);
      return '<input type="number" class="rig-input rig-scrub mono" data-speaker="' + sp.id + '" data-field="' + f.key +
             '" step="' + f.step + '" value="' + v.toFixed(f.decimals) + '">';
    }).join('');

    return (
      '<li class="speaker-item' + (sp.id === selectedSpeakerId ? ' selected' : '') +
        (sp.id === speakerDragId ? ' dragging' : '') + '" data-speaker="' + sp.id + '">' +
        '<button class="rig-drag-handle" data-drag-handle="' + sp.id + '" title="Trascina per riordinare">' + icoGrip() + '</button>' +
        '<button class="rig-tag mono" data-tag-btn="' + sp.id + '" title="' + subsetName(sp.subsetTag) + ' — clic per cambiare">' + sp.subsetTag.toUpperCase() + '</button>' +
        '<span class="speaker-num mono" data-speaker-num="' + sp.id + '" title="Doppio click per cambiare numero">' + String(sp.id).padStart(2, '0') + '</span>' +
        '<span class="speaker-name" data-speaker-name="' + sp.id + '" title="Doppio click per rinominare">' + sp.name + '</span>' +
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
  var rigLeftWidth = 260; // px — persists across tab switches (the settings
                          // panel's DOM is torn down and rebuilt each time
                          // the tab reopens, so this can't just live as an
                          // inline style on an element that no longer exists).

  function render() {
    return (
      '<div class="settings-left rig-left" style="flex: 0 0 ' + rigLeftWidth + 'px">' + renderViz() + '</div>' +
      '<div class="panel-resize-handle" id="rig-resize" title="Trascina per ridimensionare"></div>' +
      '<div class="settings-right rig-right">' + renderRight() + '</div>'
    );
  }

  /** Drag the divider to resize the viz column — same reusable
   *  .panel-resize-handle look as the main panel's own circle/params
   *  divider. Self-contained (listeners added/removed within this single
   *  mousedown), not bound once at module load — the whole settings panel
   *  is torn down and rebuilt every time this tab reopens, so anything
   *  bound persistently to `window` would quietly stack up one extra
   *  listener per visit (see onVizRotateDown's own note on this). */
  function bindResize() {
    var handle = document.getElementById('rig-resize');
    var left   = document.querySelector('.rig-left');
    var body   = document.querySelector('.settings-body');
    if (!handle || !left || !body) return;

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var startX = e.clientX;
      var startW = left.getBoundingClientRect().width;
      handle.classList.add('dragging');

      function onMove(e2) {
        var bodyW = body.getBoundingClientRect().width;
        rigLeftWidth = Math.max(160, Math.min(bodyW - 200, startW + (e2.clientX - startX)));
        left.style.flex = '0 0 ' + rigLeftWidth + 'px';
      }
      function onUp() {
        handle.classList.remove('dragging');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  }

  /* ── Targeted refreshes (avoid nuking focus / in-progress edits) ────────── */
  function refreshRight() {
    var right = document.querySelector('.rig-right');
    if (!right) return;
    right.innerHTML = renderRight();
    bindRight();
    refreshVizOnly();
  }

  function selectSpeaker(id) {
    selectedSpeakerId = id;
    document.querySelectorAll('.speaker-item.selected').forEach(function (el) { el.classList.remove('selected'); });
    var row = document.querySelector('.speaker-item[data-speaker="' + id + '"]');
    if (row) row.classList.add('selected');
    var del = document.getElementById('rig-del-speaker');
    if (del) del.removeAttribute('disabled');
    refreshVizOnly();
  }

  /** The panning page's subgroup dropdown only lists tags that at least one
   *  speaker actually uses (see getUsedSubsets) — call this after anything
   *  that could change which tags are in use, so that list stays live. */
  function notifySubgroupUsageChanged() {
    if (window.AppBridge && window.AppBridge.rebuildSubgroupMenu) window.AppBridge.rebuildSubgroupMenu();
  }

  function addSpeaker() {
    var id = nextSpeakerId++;
    speakers.push({ id: id, name: 'SPK' + String(id).padStart(2, '0'), az: 0, el: 0, dist: 1, subsetTag: 'a' });
    selectedSpeakerId = id;
    refreshRight();
    notifySubgroupUsageChanged();
  }

  function deleteSelectedSpeaker() {
    var idx = speakers.findIndex(function (s) { return s.id === selectedSpeakerId; });
    if (idx === -1) return;
    speakers.splice(idx, 1);
    selectedSpeakerId = speakers.length ? speakers[Math.min(idx, speakers.length - 1)].id : null;
    refreshRight();
    notifySubgroupUsageChanged();
  }

  /** Renumbers a speaker (its displayed/identifying number) — refuses
   *  silently if another speaker already has that number, same "just don't
   *  apply it" convention as every other constrained edit in this app
   *  (e.g. azimuth arcs refusing to overlap). */
  function renumberSpeaker(oldId, newId) {
    if (newId === oldId) return;
    if (speakers.some(function (s) { return s.id === newId; })) return;
    var sp = findSpeaker(oldId);
    if (!sp) return;
    sp.id = newId;
    if (selectedSpeakerId === oldId) selectedSpeakerId = newId;
    nextSpeakerId = Math.max(nextSpeakerId, newId + 1);
    refreshRight();
  }

  function renameSpeaker(id, name) {
    var sp = findSpeaker(id);
    if (!sp) return;
    var trimmed = (name || '').trim();
    if (trimmed) sp.name = trimmed;
    refreshRight();
  }

  function retagSpeaker(id, tagId) {
    var sp = findSpeaker(id);
    if (!sp || !subsets.some(function (s) { return s.id === tagId; })) return;
    sp.subsetTag = tagId;
    refreshRight();
    notifySubgroupUsageChanged();
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
      if (field === 'az') {
        sp.az = normAz360(val); // val is a ±180-style display value; normAz360 folds it back to 0-359 either way
        setRowField(id, 'az', azToDisplay(sp.az).toFixed(0)); // reformat (e.g. a typed 200 snaps to -160)
      }
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
      setRowField(id, 'az',   azToDisplay(sp.az).toFixed(0));
      setRowField(id, 'el',   sp.el.toFixed(0));
      setRowField(id, 'dist', sp.dist.toFixed(2));
    }

    refreshVizOnly();
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
        if (field === 'az') next = azToDisplay(next); // wraps through the ±180 seam, not the 0/360 one
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

  /* ── Drag-to-reorder the roster (grab handle at the start of each row) ──
     Plain grab-and-drag, no modifier key — reorders speakers.length once
     per row boundary crossed, not per pixel, so it doesn't re-render on
     every mousemove. */
  var speakerDragId = null;

  function targetIndexForDrag(draggedId, clientY) {
    var others = speakers.filter(function (s) { return s.id !== draggedId; });
    var idx = 0;
    for (var i = 0; i < others.length; i++) {
      var row = document.querySelector('.speaker-item[data-speaker="' + others[i].id + '"]');
      if (!row) continue;
      var rect = row.getBoundingClientRect();
      if (clientY > rect.top + rect.height / 2) idx = i + 1;
    }
    return idx;
  }

  function onSpeakerDragMove(e) {
    if (speakerDragId == null) return;
    var fromIdx = speakers.findIndex(function (s) { return s.id === speakerDragId; });
    if (fromIdx === -1) return;
    var targetIdx = targetIndexForDrag(speakerDragId, e.clientY);
    if (targetIdx === fromIdx) return;
    var moved = speakers.splice(fromIdx, 1)[0];
    speakers.splice(targetIdx, 0, moved);
    refreshRight();
  }
  function onSpeakerDragEnd() {
    speakerDragId = null;
    document.body.classList.remove('rig-reordering');
    window.removeEventListener('mousemove', onSpeakerDragMove);
    window.removeEventListener('mouseup', onSpeakerDragEnd);
    refreshRight(); // clears the .dragging (greyed-out) row — renderRow only
                     // sets that class while speakerDragId still points here
  }
  function startSpeakerDrag(id) {
    speakerDragId = id;
    document.body.classList.add('rig-reordering');
    window.addEventListener('mousemove', onSpeakerDragMove);
    window.addEventListener('mouseup', onSpeakerDragEnd);
  }

  /* ── Inline rename (dblclick name) / renumber (dblclick number) / retag
     (click tag) ───────────────────────────────────────────────────────── */
  function startRenameSpeaker(id) {
    var sp = findSpeaker(id);
    var nameEl = document.querySelector('.speaker-name[data-speaker-name="' + id + '"]');
    if (!sp || !nameEl) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'speaker-name-input mono';
    input.value = sp.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    var cancelled = false;
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') { cancelled = true; input.blur(); }
    });
    input.addEventListener('blur', function () {
      if (!cancelled) renameSpeaker(id, input.value);
      else refreshRight();
    });
  }

  function startRenumberSpeaker(id, e) {
    var sp = findSpeaker(id);
    if (!sp || !window.ValueEditorAPI) return;
    window.ValueEditorAPI.open({
      label: 'Numero altoparlante', value: sp.id, min: 1, max: 999,
      screenX: e.clientX, screenY: e.clientY,
      onApply: function (raw) { renumberSpeaker(id, Math.round(raw)); },
    });
  }

  /** Small "pick one from a short list" popup — every speaker always has
   *  exactly one of the 16 fixed tags, so this is a plain single-choice
   *  picker (no "none" option), shown as a compact letter grid rather than
   *  a tall vertical list like the app's other dropdowns (spat/ease/
   *  subgroup), since 16 items would make those unreasonably tall.
   *  Self-contained open/close (own listeners added on open, removed on
   *  close) rather than one bound persistently at module load — .rig-right
   *  is torn down and rebuilt every time the Rig tab reopens, so anything
   *  bound permanently to `window`/`document` instead would quietly stack
   *  up one extra listener per visit (see onVizRotateDown's own note). */
  function openTagPicker(currentTag, x, y, onPick) {
    closeTagPicker();
    var wrap = document.createElement('div');
    wrap.id = 'rig-tag-picker';
    wrap.innerHTML = subsets.map(function (su) {
      return '<button class="rig-tag-choice mono' + (su.id === currentTag ? ' active' : '') + '" data-tag="' + su.id + '">' + su.id.toUpperCase() + '</button>';
    }).join('');
    document.body.appendChild(wrap);

    var pw = wrap.offsetWidth, ph = wrap.offsetHeight;
    var vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.max(8, Math.min(x, vw - pw - 8));
    var top  = Math.max(8, Math.min(y, vh - ph - 8));
    wrap.style.left = left + 'px';
    wrap.style.top  = top + 'px';

    function onChoiceClick(e) {
      var btn = e.target.closest('[data-tag]');
      if (!btn) return;
      onPick(btn.dataset.tag);
      closeTagPicker();
    }
    function onOutsideClick(e) {
      if (!wrap.contains(e.target)) closeTagPicker();
    }
    function onKeydown(e) {
      if (e.key === 'Escape') closeTagPicker();
    }
    wrap.addEventListener('click', onChoiceClick);
    // Deferred: the same click that opened this popup is still bubbling
    // when this runs, so attaching the outside-click listener immediately
    // would catch that very click and close the popup right after opening it.
    setTimeout(function () {
      document.addEventListener('click', onOutsideClick);
      document.addEventListener('keydown', onKeydown);
    }, 0);

    wrap._cleanup = function () {
      document.removeEventListener('click', onOutsideClick);
      document.removeEventListener('keydown', onKeydown);
    };
  }
  function closeTagPicker() {
    var el = document.getElementById('rig-tag-picker');
    if (el) { if (el._cleanup) el._cleanup(); el.remove(); }
  }
  function startRetagSpeaker(id, e) {
    var sp = findSpeaker(id);
    if (!sp) return;
    openTagPicker(sp.subsetTag, e.clientX, e.clientY, function (tagId) {
      retagSpeaker(id, tagId);
    });
  }

  /* ── Bind events ───────────────────────────────────────────────────────── */
  function bindViz() {
    var viz = document.getElementById('rig-viz-content');
    if (viz) {
      viz.addEventListener('click', function (e) {
        var dot = e.target.closest('[data-speaker]');
        if (dot) selectSpeaker(Number(dot.dataset.speaker));
      });
      viz.addEventListener('mousedown', onVizRotateDown);
    }
  }

  function bindRight() {
    var list = document.getElementById('rig-speaker-list');
    if (list) {
      list.addEventListener('click', function (e) {
        var tagBtn = e.target.closest('[data-tag-btn]');
        if (tagBtn) { startRetagSpeaker(Number(tagBtn.dataset.tagBtn), e); return; }
        var row = e.target.closest('.speaker-item');
        if (row) selectSpeaker(Number(row.dataset.speaker));
      });
      list.addEventListener('mousedown', function (e) {
        var handle = e.target.closest('[data-drag-handle]');
        if (handle) { e.preventDefault(); startSpeakerDrag(Number(handle.dataset.dragHandle)); }
      });
      list.addEventListener('dblclick', function (e) {
        var nameEl = e.target.closest('[data-speaker-name]');
        if (nameEl) { startRenameSpeaker(Number(nameEl.dataset.speakerName)); return; }
        var numEl = e.target.closest('[data-speaker-num]');
        if (numEl) { startRenumberSpeaker(Number(numEl.dataset.speakerNum), e); return; }
      });
      list.addEventListener('input', onFieldInput);
      list.querySelectorAll('.rig-scrub').forEach(makeScrubbable);
    }
    document.getElementById('rig-add-speaker')?.addEventListener('click', addSpeaker);
    document.getElementById('rig-del-speaker')?.addEventListener('click', deleteSelectedSpeaker);
  }

  function bind() {
    bindViz();
    bindRight();
    bindResize();
  }

  /* ── Public API ────────────────────────────────────────────────────────── */
  function getSpeakers() {
    return speakers.map(function (sp) { return { id: sp.id, name: sp.name }; });
  }
  /** Only the tags at least one speaker is actually using — the panning
   *  page's subgroup dropdown lists these, not all 16, so it doesn't show
   *  a wall of letters nobody's assigned to anything. */
  function getUsedSubsets() {
    return subsets
      .filter(function (su) { return speakers.some(function (sp) { return sp.subsetTag === su.id; }); })
      .map(function (s) { return { id: s.id, name: s.name }; });
  }

  window.RigAPI = { render: render, bind: bind, getSpeakers: getSpeakers, getUsedSubsets: getUsedSubsets };
})();
