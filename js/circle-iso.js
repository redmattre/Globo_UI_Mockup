/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  circle-iso.js
   Toggleable isometric ("3/4 view") rendering of the SAME arcs as circle.js's
   flat 2D circle, plus two new draggable handles per arc for elevation
   (heightMin/heightMax) — so height gets the same direct-manipulation power
   as azimuth, without a real 3D engine. Fully separate module: does not
   touch circle.js's own rendering/drag code, only reads/writes the shared
   `window.CircleState` and calls the same `window.ArcsAPI` methods every
   other interaction already uses.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Scene constants ───────────────────────────────────────────────────── */
  var CX = 100, CY = 110, SCALE = 70;
  var FLOOR_R = 1; // logical world radius of the azimuth ring (NOT circle.js's R=80px)
  var DIRETTO_SHELL_R = FLOOR_R * 1.1; // "ghost" outer sphere for the Diretto static-spread indicator

  var COS30 = Math.cos(Math.PI / 6), SIN30 = Math.sin(Math.PI / 6);

  var viewRotationDeg = 100; // continuous camera yaw (any degree); 315 puts azimuth 0 at the front-facing vertex
  var isoActive = false;
  var dragState = null;         // azimuth: {type,arcIdx,span,cent} | height: {type,arcIdx,startY,startVal} | null
  var rotateDragState = null;   // {startX, startRotation} while dragging the background to orbit | null
  var ROTATE_SENSITIVITY = 0.6; // degrees of rotation per screen px of horizontal drag

  /* ── Geometry helpers (own copies — each file here is a self-contained
     module, same convention as rig.js duplicating its own math) ──────────── */
  function norm(a)  { return ((a % 360) + 360) % 360; }
  function toRad(d) { return d * Math.PI / 180; }
  function arcSpan(left, right) { return norm(right - left); }

  function angleInArc(angle, left, right) {
    var span = arcSpan(left, right);
    if (span < 0.5) return false;
    var d = norm(angle - left);
    return d > 0.5 && d < span - 0.5;
  }
  function arcsOverlap(l1, r1, l2, r2) {
    return angleInArc(norm(l1 + 0.5), l2, r2) || angleInArc(norm(r1 - 0.5), l2, r2) ||
           angleInArc(norm(l2 + 0.5), l1, r1) || angleInArc(norm(r2 - 0.5), l1, r1);
  }
  function wouldOverlapIso(arcIdx, newLeft, newRight) {
    var arcs = window.CircleState.arcs;
    for (var i = 0; i < arcs.length; i++) {
      if (i === arcIdx || !arcs[i].active) continue;
      if (arcsOverlap(newLeft, newRight, arcs[i].left, arcs[i].right)) return true;
    }
    return false;
  }

  /** Azimuth (deg, 0=north/clockwise — same convention as circle.js's angleOf),
   *  elevation (deg) and radius (world units) → 3D point. Same formula as
   *  rig.js's polarToCartesian; az/el here mean exactly what they mean there. */
  function polarToCartesian(az, el, r) {
    var azRad = toRad(az), elRad = toRad(el);
    return {
      x: r * Math.cos(elRad) * Math.sin(azRad),
      y: r * Math.cos(elRad) * Math.cos(azRad),
      z: r * Math.sin(elRad),
    };
  }

  /** Classic 2:1 dimetric projection. Note the sx sign: rig.js's original
   *  formula was sx=(x-y)cos30, but that makes azimuth increase COUNTER-
   *  clockwise on screen — mirrored relative to circle.js's flat view,
   *  where angleOf/pt make it clockwise. Flipping to (y-x) matches the
   *  flat view's chirality (verified: az=0/90/180/270 trace clockwise). */
  function isoProject(x, y, z) {
    return { sx: (y - x) * COS30, sy: (x + y) * SIN30 - z };
  }

  function worldToScreen(az, el, r) {
    var c = polarToCartesian(norm(az - viewRotationDeg), el, r);
    var p = isoProject(c.x, c.y, c.z);
    return { x: CX + p.sx * SCALE, y: CY + p.sy * SCALE };
  }

  /** Exact inverse of isoProject at z=0 (the floor plane) — re-derived for
   *  the flipped sx above. The 2x2 map sx=(y-x)cos30, sy=(x+y)sin30 has
   *  det=sin60≠0, so this is never ambiguous/degenerate, unlike inverting
   *  elevation (see height handles). */
  function screenToFloorXY(screenX, screenY) {
    var sx = (screenX - CX) / SCALE;
    var sy = (screenY - CY) / SCALE;
    var x = (sy / SIN30 - sx / COS30) / 2;
    var y = (sx / COS30 + sy / SIN30) / 2;
    return { x: x, y: y };
  }
  function floorAzimuthFromXY(x, y) {
    return norm(Math.atan2(x, y) * 180 / Math.PI + viewRotationDeg);
  }

  function toLocalXY(svg, e) {
    var p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  function heightBounds(mode) {
    return mode === 'sphere' ? { min: -90, max: 90 } : { min: 0, max: 90 };
  }

  /** n azimuth samples sweeping clockwise from left to right — wrap-safe via
   *  arcSpan, so an arc like {left:0, right:359.9} samples correctly instead
   *  of breaking across the 359.9→0 seam. */
  function sampleAz(left, right, n) {
    var span = arcSpan(left, right);
    var out = [];
    for (var i = 0; i < n; i++) out.push(norm(left + span * i / (n - 1)));
    return out;
  }

  /** n elevation samples from `from` to `to` — plain linear interpolation
   *  (elevation isn't circular like azimuth, no wrap handling needed). */
  function sampleEl(from, to, n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(from + (to - from) * i / (n - 1));
    return out;
  }

  /* ── SVG string builders ──────────────────────────────────────────────── */
  function svgLine(x1, y1, x2, y2, stroke, width, dash, extra) {
    return '<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) +
           '" stroke="' + stroke + '" stroke-width="' + width + '"' +
           (dash ? ' stroke-dasharray="' + dash + '"' : '') + (extra || '') + '/>';
  }

  function handleDot(x, y, r, fill, stroke, cursor, handleType) {
    var strokeAttr = stroke ? ' stroke="' + stroke + '" stroke-width="1.5"' : '';
    return '<circle data-handle="' + handleType + '" cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) +
           '" r="' + r + '" fill="' + fill + '"' + strokeAttr + ' style="cursor:' + cursor + '"/>';
  }

  function renderLatitudeRing(el, opacity) {
    var pts = [];
    for (var a = 0; a <= 360; a += 10) {
      var p = worldToScreen(a, el, FLOOR_R);
      pts.push(p.x.toFixed(2) + ',' + p.y.toFixed(2));
    }
    return '<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--border)" stroke-width="0.6" opacity="' + opacity + '"/>';
  }

  function renderMeridian(az0, opacity) {
    var pts = [];
    for (var el = -90; el <= 90; el += 10) pts.push(worldToScreen(az0, el, FLOOR_R));
    for (var el2 = 90; el2 >= -90; el2 -= 10) pts.push(worldToScreen(norm(az0 + 180), el2, FLOOR_R));
    var d = pts.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ');
    return '<polygon points="' + d + '" fill="none" stroke="var(--border)" stroke-width="0.6" opacity="' + opacity + '"/>';
  }

  /** Wireframe-globe scaffold (a few latitude rings + two meridians, plus
   *  the equator/azimuth ring itself). Without this the scene only shows a
   *  flat ring and radiating handle guides — which reads as a cone/pyramid,
   *  not a sphere, especially before any arc has an actual height set. */
  function renderSphereScaffold() {
    var s = '';
    [-60, -30, 30, 60].forEach(function (el) { s += renderLatitudeRing(el, 0.25); });
    s += renderMeridian(0, 0.3);
    s += renderMeridian(90, 0.3);

    // Equator — stronger stroke, since arcs' footprints sit right on it
    var pts = [];
    for (var a = 0; a <= 360; a += 8) {
      var p = worldToScreen(a, 0, FLOOR_R);
      pts.push(p.x.toFixed(2) + ',' + p.y.toFixed(2));
    }
    s += '<polygon points="' + pts.join(' ') + '" fill="none" stroke="var(--border-strong)" stroke-width="1"/>';

    // Small orientation tick at world north — visibly sweeps around as the view rotates
    var tick = worldToScreen(0, 0, FLOOR_R * 1.12);
    s += '<circle cx="' + tick.x.toFixed(2) + '" cy="' + tick.y.toFixed(2) + '" r="1.6" fill="var(--text-3)"/>';

    return s;
  }

  function renderFootprint(arc, color) {
    var pts = sampleAz(arc.left, arc.right, 13).map(function (a) { return worldToScreen(a, 0, FLOOR_R); });
    var d = 'M ' + pts.map(function (p) { return p.x.toFixed(2) + ' ' + p.y.toFixed(2); }).join(' L ');
    return '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1" stroke-dasharray="3 2" opacity="0.55"/>';
  }

  /** Invisible hit-band at the floor (el=0), always present — unlike the
   *  wall patch's own hit-band (which follows the patch and can end up
   *  dragged far away/foreshortened if the arc's height is high), this one
   *  always sits at the same predictable spot, so there's always an easy,
   *  reachable place to hover to bring up the controls regardless of where
   *  the arc's actual surface currently is. */
  function renderFloorHitBand(arc) {
    var pts = sampleAz(arc.left, arc.right, 13).map(function (a) { return worldToScreen(a, 0, FLOOR_R); });
    var d = 'M ' + pts.map(function (p) { return p.x.toFixed(2) + ' ' + p.y.toFixed(2); }).join(' L ');
    return '<path d="' + d + '" fill="none" stroke="transparent" stroke-width="20"/>';
  }

  /** Invisible hit-band along the whole center→centroid radius, always
   *  present. The "origin" handle (span control) lives somewhere on this
   *  line at a radius that varies with the arc's span, and its own guide
   *  line is only 0.75px wide — nowhere near enough to keep hover alive
   *  while moving the cursor along it. This band covers the full radius
   *  (center out past the centroid handle, whatever the span currently is),
   *  so hover never drops before reaching either handle. */
  function renderCentroidRadiusHitBand(arc) {
    var cent  = norm(arc.left + arcSpan(arc.left, arc.right) / 2);
    var outer = worldToScreen(cent, 0, FLOOR_R * 1.2); // just past the centroid handle at 1.18*FLOOR_R
    return '<line x1="' + CX + '" y1="' + CY + '" x2="' + outer.x.toFixed(2) + '" y2="' + outer.y.toFixed(2) +
      '" stroke="transparent" stroke-width="18"/>';
  }

  /** Full 360° latitude-ring guides at heightMin/heightMax. On a sphere, the
   *  ring at a higher elevation is strictly smaller (radius shrinks by
   *  cos(el)) — for a narrow arc that shrinkage is only a few px across its
   *  own short span, too subtle to read as "spherical" on its own. Showing
   *  the full rings makes the size difference obvious regardless of span. */
  function renderElevationGuides(arc, color) {
    var s = '';
    [arc.heightMin, arc.heightMax].forEach(function (el) {
      if (el === 0) return; // the equator is already drawn by the scaffold
      var pts = [];
      for (var a = 0; a <= 360; a += 10) pts.push(worldToScreen(a, el, FLOOR_R));
      s += '<polygon points="' + pts.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' ') +
        '" fill="none" stroke="' + color + '" stroke-width="0.75" stroke-dasharray="2 2" opacity="0.45"/>';
    });
    return s;
  }

  /** Inner markup only (hit-band + fill polygon) — the caller wraps this,
   *  together with the handles when hovered, in a SINGLE `data-arc-hover`
   *  group. Handles must live inside that same group, or moving the mouse
   *  onto a handle would register as "left the arc" and make them vanish
   *  out from under the cursor (mirrors circle.js's flat-view structure,
   *  where handles are appended to the same hoverable `<g>` too). */
  function renderWallPatch(arc, isHov, color) {
    var NAZ = 32, NEL = 32;
    var azs = sampleAz(arc.left, arc.right, NAZ + 1);
    var els = sampleEl(arc.heightMin, arc.heightMax, NEL + 1);

    // Every grid vertex, projected. This isn't a solid — it's a zone
    // indicator, so it should read as colored from every angle, never
    // disappear or go half-missing depending on where you rotate to. The
    // grid (small quads) is still needed even so: the ORIGINAL bug was a
    // single big polygon whose projected outline could self-intersect for
    // a wide/wrapping arc, and SVG's fill-rule then leaves part of a
    // self-intersecting shape unfilled. Many small quads never self-
    // intersect individually, so the fill is always consistent — no
    // per-cell hiding needed to fix that, just the decomposition itself.
    var grid = [];
    for (var i = 0; i <= NEL; i++) {
      var row = [];
      for (var j = 0; j <= NAZ; j++) {
        var p = worldToScreen(azs[j], els[i], FLOOR_R);
        row.push(p);
      }
      grid.push(row);
    }

    var fillAlpha   = isHov ? '18' : '0D';
    var strokeWidth = isHov ? '2.2' : '1.4';

    var fillParts = [];
    for (var i2 = 0; i2 < NEL; i2++) {
      for (var j2 = 0; j2 < NAZ; j2++) {
        var a = grid[i2][j2], b = grid[i2][j2 + 1], cc = grid[i2 + 1][j2 + 1], d = grid[i2 + 1][j2];
        fillParts.push('<polygon points="' +
          a.x.toFixed(2) + ',' + a.y.toFixed(2) + ' ' + b.x.toFixed(2) + ',' + b.y.toFixed(2) + ' ' +
          cc.x.toFixed(2) + ',' + cc.y.toFixed(2) + ' ' + d.x.toFixed(2) + ',' + d.y.toFixed(2) +
          '" fill="' + color + fillAlpha + '" stroke="none"/>');
      }
    }

    // Outline: the 4 boundary curves, always drawn in full — each is its
    // own simple (non-self-intersecting) path, so there's no fill-rule
    // ambiguity here either.
    function pathFrom(points) {
      return '<path d="M ' + points.map(function (p) { return p.x.toFixed(2) + ' ' + p.y.toFixed(2); }).join(' L ') +
        '" fill="none" stroke="' + color + '" stroke-width="' + strokeWidth + '"/>';
    }
    var outline = pathFrom(grid[NEL]) + pathFrom(grid[0]) +
      pathFrom(grid.map(function (row) { return row[NAZ]; })) +
      pathFrom(grid.map(function (row) { return row[0]; }));

    // Wide invisible hit-band along the patch's vertical center — guarantees
    // clickability even when heightMin===heightMax (zero-area patch), e.g.
    // right after an arc is first created on the flat view.
    var midEl  = (arc.heightMin + arc.heightMax) / 2;
    var hitPts = sampleAz(arc.left, arc.right, 13).map(function (a) { return worldToScreen(a, midEl, FLOOR_R); });
    var hitD   = 'M ' + hitPts.map(function (p) { return p.x.toFixed(2) + ' ' + p.y.toFixed(2); }).join(' L ');

    return '<path d="' + hitD + '" fill="none" stroke="transparent" stroke-width="22"/>' + fillParts.join('') + outline;
  }

  /** Diretto mode has no readhead (sound is spread statically over the drawn
   *  arcs, mirrors the flat view's own black semi-arcs) — this draws a black,
   *  translucent "ghost" patch over the same azimuth/elevation range as the
   *  arc's own surface, but on a slightly bigger sphere (DIRETTO_SHELL_R),
   *  so it reads as a shell around the real surface rather than overlapping
   *  it. Coarser grid than renderWallPatch (this is a passive indicator, not
   *  draggable, so the extra precision isn't needed) — still decomposed into
   *  small quads rather than one big polygon, for the same self-intersection
   *  reason as renderWallPatch. pointer-events:none makes it fully inert to
   *  clicks/hover, regardless of what else it's layered above or below. */
  function renderDirettoShell(arc) {
    var NAZ = 20, NEL = 6;
    var azs = sampleAz(arc.left, arc.right, NAZ + 1);
    var els = sampleEl(arc.heightMin, arc.heightMax, NEL + 1);

    var grid = [];
    for (var i = 0; i <= NEL; i++) {
      var row = [];
      for (var j = 0; j <= NAZ; j++) row.push(worldToScreen(azs[j], els[i], DIRETTO_SHELL_R));
      grid.push(row);
    }

    var parts = [];
    for (var i2 = 0; i2 < NEL; i2++) {
      for (var j2 = 0; j2 < NAZ; j2++) {
        var a = grid[i2][j2], b = grid[i2][j2 + 1], cc = grid[i2 + 1][j2 + 1], d = grid[i2 + 1][j2];
        parts.push('<polygon points="' +
          a.x.toFixed(2) + ',' + a.y.toFixed(2) + ' ' + b.x.toFixed(2) + ',' + b.y.toFixed(2) + ' ' +
          cc.x.toFixed(2) + ',' + cc.y.toFixed(2) + ' ' + d.x.toFixed(2) + ',' + d.y.toFixed(2) +
          '" fill="#0f0e0d11" stroke="none"/>');
      }
    }
    return '<g pointer-events="none">' + parts.join('') + '</g>';
  }

  function renderAzimuthHandles(arc, color) {
    var span   = arcSpan(arc.left, arc.right);
    var cent   = norm(arc.left + span / 2);
    var originR = FLOOR_R * 0.92 * Math.sqrt(span / 359.5);

    var pL = worldToScreen(arc.left, 0, FLOOR_R);
    var pR = worldToScreen(arc.right, 0, FLOOR_R);
    // Pushed just outside the sphere (not ON it, at FLOOR_R) — otherwise this
    // sits exactly under the height-min handle whenever heightMin=0 (the
    // common default), forcing an awkward raise/rotate/lower-back workflow.
    var pC = worldToScreen(cent, 0, FLOOR_R * 1.12);
    var pO = worldToScreen(cent, 0, originR);

    var s = '';
    s += svgLine(CX, CY, pL.x, pL.y, color, 0.75, '2.5 2', ' opacity="0.3"');
    s += svgLine(CX, CY, pR.x, pR.y, color, 0.75, '2.5 2', ' opacity="0.3"');
    s += svgLine(CX, CY, pC.x, pC.y, color, 1, null, ' opacity="0.5"');

    s += handleDot(pO.x, pO.y, 5, '#fff', color, 'ns-resize', 'origin');
    s += handleDot(pL.x, pL.y, 4, '#fff', color, 'ew-resize', 'trim-left');
    s += handleDot(pR.x, pR.y, 4, '#fff', color, 'ew-resize', 'trim-right');
    s += handleDot(pC.x, pC.y, 6, color, null, 'grab', 'centroid');
    return s;
  }

  function renderHeightHandles(arc, color) {
    var cent = norm(arc.left + arcSpan(arc.left, arc.right) / 2);
    var pMax = worldToScreen(cent, arc.heightMax, FLOOR_R);
    var pMin = worldToScreen(cent, arc.heightMin, FLOOR_R);
    var s = svgLine(pMin.x, pMin.y, pMax.x, pMax.y, color, 1.2, null, ' opacity="0.5"');
    s += handleDot(pMax.x, pMax.y, 5, '#fff', color, 'ns-resize', 'height-max');
    s += handleDot(pMin.x, pMin.y, 5, '#fff', color, 'ns-resize', 'height-min');
    return s;
  }

  /* ── Draw ──────────────────────────────────────────────────────────────── */
  function draw() {
    // Render into a nested <g>, not the <svg> root directly — same pattern
    // as rig.js's #rig-viz-content, which is the proven-working approach
    // for building SVG content from HTML strings in this app.
    var g  = document.getElementById('circle-iso-content');
    var cs = window.CircleState;
    if (!g || !cs) return;

    var hovIdx = cs.hovered;
    var parts  = [renderSphereScaffold()];

    // Painter's algorithm: farther arcs drawn first, nearer ones on top
    var active = [];
    cs.arcs.forEach(function (arc, i) {
      if (!arc.active) return;
      var cent  = norm(arc.left + arcSpan(arc.left, arc.right) / 2);
      var midEl = (arc.heightMin + arc.heightMax) / 2;
      var c = polarToCartesian(norm(cent - viewRotationDeg), midEl, FLOOR_R);
      active.push({ arc: arc, idx: i, depth: c.y - c.z });
    });
    active.sort(function (a, b) { return a.depth - b.depth; });

    active.forEach(function (item) {
      var color = window.ARC_COLORS[item.idx];
      var isHov = item.idx === hovIdx;
      // The colored surface is always visible; the dashed reference lines
      // (floor footprint, elevation-ring guides) and the drag handles only
      // appear on hover — otherwise a scene with several arcs gets cluttered
      // with dashes everywhere. All of it lives INSIDE the same hoverable
      // group as the wall patch, or moving onto a handle/guide would read
      // as "left the arc" and everything would vanish under the cursor.
      var inner = renderFloorHitBand(item.arc) + renderCentroidRadiusHitBand(item.arc) + renderWallPatch(item.arc, isHov, color);
      if (isHov) {
        inner += renderFootprint(item.arc, color) + renderElevationGuides(item.arc, color) +
          renderAzimuthHandles(item.arc, color) + renderHeightHandles(item.arc, color);
      }
      parts.push('<g data-arc-hover="' + item.idx + '" style="cursor:pointer;">' + inner + '</g>');
      // Diretto: no readhead — instead, a black ghost shell on a bigger sphere
      // shows all statically-spread zones, same as the flat view's black
      // semi-arcs. Kept outside the hoverable group and inert to clicks/hover.
      if (cs.module === 'diretto') parts.push(renderDirettoShell(item.arc));
    });

    // Position dot (the moving sound object) — hidden in Diretto, which has
    // no movement/readhead to represent. Drawn on top of everything, same as
    // the flat view (this scene never hides arcs by depth either — see
    // renderWallPatch's no-culling rationale — so the dot follows suit).
    if (cs.module !== 'diretto') {
      var posP = worldToScreen(cs.positionAngle, 0, FLOOR_R);
      parts.push('<circle cx="' + posP.x.toFixed(2) + '" cy="' + posP.y.toFixed(2) +
        '" r="4.5" fill="#0F0E0D" stroke="#fff" stroke-width="1.3" pointer-events="none"/>');
    }

    g.innerHTML = parts.join('');
  }

  /* Coalesce redraws to at most once per animation frame — same rationale
     as circle.js: mousemove fires far more often than the screen repaints,
     and this view's per-arc 32×32 wall-patch grid isn't cheap to rebuild
     from scratch every time. Other controls (height slider, speed range...)
     stay untouched and keep updating at native event rate. */
  var drawScheduled = false;
  function requestDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(function () {
      drawScheduled = false;
      draw();
    });
  }

  /* ── Hover / selection (mirrors circle.js's onSVGMouseMove exactly) ─────── */
  function onIsoMouseMove(e) {
    if (dragState || rotateDragState) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    var hitEl  = target && target.closest('[data-arc-hover]');
    var newHov = hitEl ? parseInt(hitEl.getAttribute('data-arc-hover'), 10) : -1;
    var cs = window.CircleState;
    if (!cs || newHov === cs.hovered) return;

    cs.hovered = newHov;
    if (newHov >= 0) {
      cs.selected = newHov;
      if (window.ArcsAPI) {
        window.ArcsAPI.syncHeightSlider(newHov);
        window.ArcsAPI.updateArcButtons();
      }
    } else if (window.ArcsAPI) {
      window.ArcsAPI.updateArcButtons();
    }
    requestDraw();
  }

  function onIsoMouseLeave() {
    if (dragState || rotateDragState) return;
    var cs = window.CircleState;
    if (!cs || cs.hovered === -1) return;
    cs.hovered = -1;
    if (window.ArcsAPI) window.ArcsAPI.updateArcButtons();
    requestDraw();
  }

  /* ── Drag: azimuth handles (exact) + height handles (scrubber) + orbit ──── */
  function onIsoDown(e) {
    var handle = e.target.closest('[data-handle]');
    if (!handle) {
      // No handle under the cursor — drag anywhere else in the scene
      // (background, an arc's own patch) to orbit continuously around Z.
      rotateDragState = { startX: e.clientX, startRotation: viewRotationDeg };
      document.body.classList.add('circle-iso-rotating');
      e.preventDefault();
      return;
    }
    e.preventDefault();
    var cs = window.CircleState;
    if (!cs) return;
    var arcIdx = cs.hovered >= 0 ? cs.hovered : cs.selected;
    var arc = cs.arcs[arcIdx];
    if (!arc) return;
    var type = handle.dataset.handle;

    if (type === 'height-min' || type === 'height-max') {
      dragState = {
        type: type, arcIdx: arcIdx, startY: e.clientY,
        startVal: type === 'height-min' ? arc.heightMin : arc.heightMax,
      };
    } else {
      dragState = {
        type: type, arcIdx: arcIdx,
        span: arcSpan(arc.left, arc.right),
        cent: norm(arc.left + arcSpan(arc.left, arc.right) / 2),
      };
    }
  }

  function onIsoMove(e) {
    if (rotateDragState) {
      var dx = e.clientX - rotateDragState.startX;
      viewRotationDeg = norm(rotateDragState.startRotation + dx * ROTATE_SENSITIVITY);
      requestDraw();
      return;
    }
    if (!dragState) return;
    e.preventDefault();
    var cs  = window.CircleState;
    var arc = cs.arcs[dragState.arcIdx];
    if (!arc) return;

    /* Height handles: not cursor-locked (the inversion is provably ambiguous
       — sy(el) is non-monotonic for most azimuths), so they scrub instead —
       same technique/sensitivity as rig.js's makeScrubbable. */
    if (dragState.type === 'height-min' || dragState.type === 'height-max') {
      var dy = dragState.startY - e.clientY;
      var b  = heightBounds(arc.heightMode);
      var next = Math.max(b.min, Math.min(b.max, Math.round(dragState.startVal + dy)));
      if (dragState.type === 'height-min') {
        if (next <= arc.heightMax) arc.heightMin = next;
        else { arc.heightMin = arc.heightMax; arc.heightMax = next; dragState.type = 'height-max'; }
      } else {
        if (next >= arc.heightMin) arc.heightMax = next;
        else { arc.heightMax = arc.heightMin; arc.heightMin = next; dragState.type = 'height-min'; }
      }
      // Live sync on every intermediate step, not just on drop — the flat
      // slider is visible at the same time and must track in real time.
      if (window.ArcsAPI) window.ArcsAPI.syncHeightSlider(dragState.arcIdx);
      requestDraw();
      return;
    }

    /* Azimuth handles: exact inversion of the floor-plane projection —
       same math circle.js's onMove already uses, just fed local (x,y)
       recovered from the projection instead of raw SVG screen coords. */
    var svg   = document.getElementById('nav-circle-iso');
    var local = toLocalXY(svg, e);
    var xy    = screenToFloorXY(local.x, local.y);

    if (dragState.type === 'centroid') {
      var newCent = floorAzimuthFromXY(xy.x, xy.y);
      var half = dragState.span / 2;
      var newL = norm(newCent - half), newR = norm(newCent + half);
      if (!wouldOverlapIso(dragState.arcIdx, newL, newR)) { arc.left = newL; arc.right = newR; }

    } else if (dragState.type === 'origin') {
      var centRad = toRad(dragState.cent);
      var proj = xy.x * Math.sin(centRad) + xy.y * Math.cos(centRad);
      var t = Math.max(0.005, proj / (FLOOR_R * 0.92));
      var newSpan = Math.max(1, Math.min(359.5, t * t * 359.5));
      var nL = norm(dragState.cent - newSpan / 2), nR = norm(dragState.cent + newSpan / 2);
      if (!wouldOverlapIso(dragState.arcIdx, nL, nR)) { arc.left = nL; arc.right = nR; }

    } else if (dragState.type === 'trim-left') {
      var newA = floorAzimuthFromXY(xy.x, xy.y);
      var newSp = arcSpan(newA, arc.right);
      if (newSp > 1 && newSp <= 359.5 && !wouldOverlapIso(dragState.arcIdx, newA, arc.right)) arc.left = newA;

    } else if (dragState.type === 'trim-right') {
      var newA2 = floorAzimuthFromXY(xy.x, xy.y);
      var newSp2 = arcSpan(arc.left, newA2);
      if (newSp2 > 1 && newSp2 <= 359.5 && !wouldOverlapIso(dragState.arcIdx, arc.left, newA2)) arc.right = newA2;
    }

    if (window.ArcsAPI && window.AppBridge) {
      cs.positionAngle = window.ArcsAPI.computePositionAngle(window.AppBridge.getReadheadPos());
    }
    requestDraw();
  }

  function onIsoUp() {
    if (dragState !== null && window.ArcsAPI) window.ArcsAPI.autosave();
    dragState = null;
    rotateDragState = null;
    document.body.classList.remove('circle-iso-rotating');
  }

  /** Double-click a handle to punch in a precise value — same popup as the
   *  flat view (window.ValueEditorAPI, defined in circle.js), just fed the
   *  6 handle types this view has (the flat view's 4 azimuth ones, plus the
   *  2 new height ones). */
  function onIsoDblClick(e) {
    var handle = e.target.closest('[data-handle]');
    if (!handle) return;
    e.preventDefault();
    if (!window.ValueEditorAPI) return;
    var cs = window.CircleState;
    if (!cs) return;
    var arcIdx = cs.hovered >= 0 ? cs.hovered : cs.selected;
    var arc = cs.arcs[arcIdx];
    if (!arc) return;
    var type = handle.dataset.handle;
    var span = arcSpan(arc.left, arc.right);
    var cent = norm(arc.left + span / 2);

    /* ±180° display convention, same as the flat view's editor */
    function toDisplay(internal) { var d = norm(internal); return d > 180 ? d - 360 : d; }
    function toInternal(display) { return norm(Math.round(display)); }

    var label, value, min, max;
    if (type === 'height-min' || type === 'height-max') {
      var b = heightBounds(arc.heightMode);
      label = type === 'height-min' ? 'Elevazione min (°)' : 'Elevazione max (°)';
      value = Math.round(type === 'height-min' ? arc.heightMin : arc.heightMax);
      min = b.min; max = b.max;
    } else if (type === 'trim-left')  { label = 'Angolo sinistro (°)'; value = toDisplay(arc.left);  min = -180; max = 180; }
    else if (type === 'trim-right')   { label = 'Angolo destro (°)';   value = toDisplay(arc.right); min = -180; max = 180; }
    else if (type === 'centroid')     { label = 'Centroide (°)';       value = toDisplay(cent);      min = -180; max = 180; }
    else if (type === 'origin')       { label = 'Apertura (°)';        value = Math.round(span);     min = 1;    max = 359; }
    else return;

    window.ValueEditorAPI.open({
      label: label, value: value, min: min, max: max,
      screenX: e.clientX, screenY: e.clientY,
      onApply: function (raw) {
        if (type === 'height-min' || type === 'height-max') {
          var b2 = heightBounds(arc.heightMode);
          var v = Math.max(b2.min, Math.min(b2.max, raw));
          if (type === 'height-min') {
            if (v <= arc.heightMax) arc.heightMin = v; else { arc.heightMin = arc.heightMax; arc.heightMax = v; }
          } else {
            if (v >= arc.heightMin) arc.heightMax = v; else { arc.heightMax = arc.heightMin; arc.heightMin = v; }
          }
          if (window.ArcsAPI) window.ArcsAPI.syncHeightSlider(arcIdx);
        } else if (type === 'origin') {
          var newSpan = Math.max(1, Math.min(359, Math.round(raw)));
          var nL = norm(cent - newSpan / 2), nR = norm(cent + newSpan / 2);
          if (!wouldOverlapIso(arcIdx, nL, nR)) { arc.left = nL; arc.right = nR; }
        } else {
          var deg = toInternal(raw);
          if (type === 'trim-left') {
            if (arcSpan(deg, arc.right) > 1 && !wouldOverlapIso(arcIdx, deg, arc.right)) arc.left = deg;
          } else if (type === 'trim-right') {
            if (arcSpan(arc.left, deg) > 1 && !wouldOverlapIso(arcIdx, arc.left, deg)) arc.right = deg;
          } else if (type === 'centroid') {
            var half = span / 2;
            var cL = norm(deg - half), cR = norm(deg + half);
            if (!wouldOverlapIso(arcIdx, cL, cR)) { arc.left = cL; arc.right = cR; }
          }
        }
        if (window.ArcsAPI) window.ArcsAPI.autosave();
        if (window.ArcsAPI && window.AppBridge) {
          cs.positionAngle = window.ArcsAPI.computePositionAngle(window.AppBridge.getReadheadPos());
        }
        draw();
      },
    });
  }

  /* ── Toggle ───────────────────────────────────────────────────────────── */
  function show() {
    isoActive = true;
    draw(); // fresh frame before revealing — nothing may have redrawn it while hidden
    var flat = document.getElementById('nav-circle');
    var iso  = document.getElementById('nav-circle-iso');
    // Inline style, not just the `hidden` attribute — wins over any external
    // stylesheet regardless of caching, so this can never be silently
    // defeated by a stale/cached CSS file.
    if (flat) { flat.hidden = true;  flat.style.display = 'none'; }
    if (iso)  {
      iso.hidden = false; iso.style.display = 'block';
      void iso.offsetHeight; // force a reflow before anything else can read/paint stale layout
    }
    var toggleBtn = document.getElementById('circle-iso-toggle');
    if (toggleBtn) toggleBtn.classList.add('active');
  }

  function hide() {
    isoActive = false;
    var flat = document.getElementById('nav-circle');
    var iso  = document.getElementById('nav-circle-iso');
    if (flat) { flat.hidden = false; flat.style.display = 'block'; }
    if (iso)  { iso.hidden  = true;  iso.style.display  = 'none'; }
    var toggleBtn = document.getElementById('circle-iso-toggle');
    if (toggleBtn) toggleBtn.classList.remove('active');
    // Flat view wasn't being redrawn while hidden — refresh it now via the
    // dispatcher (isActive() is already false, so this only runs the flat draw).
    if (window.CircleAPI) window.CircleAPI.draw();
  }

  function toggleView() {
    if (isoActive) hide(); else show();
  }

  /* ── Init ─────────────────────────────────────────────────────────────── */
  function init() {
    var svg       = document.getElementById('nav-circle-iso');
    var toggleBtn = document.getElementById('circle-iso-toggle');
    if (!svg) return;

    svg.addEventListener('mousemove',  onIsoMouseMove);
    svg.addEventListener('mouseleave', onIsoMouseLeave);
    svg.addEventListener('mousedown',  onIsoDown);
    svg.addEventListener('dblclick',   onIsoDblClick);
    window.addEventListener('mousemove', onIsoMove);
    window.addEventListener('mouseup',   onIsoUp);

    if (toggleBtn) toggleBtn.addEventListener('click', toggleView);
  }

  document.addEventListener('DOMContentLoaded', init);

  /* ── Public API ───────────────────────────────────────────────────────── */
  window.CircleIsoAPI = {
    draw: requestDraw,
    isActive: function () { return isoActive; },
    show: show,
    hide: hide,
  };
})();
