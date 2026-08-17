/* ═══════════════════════════════════════════════════════════════════════════
   IN-GLOBO  —  circle.js  (multi-arc, hover-to-select)
   Each arc's visual + handles live inside a <g data-arc-hover="i"> group.
   This means closest('[data-arc-hover]') works even when hovering a handle,
   while closest('[data-handle]') still works for drag detection.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ── Arc colours ────────────────────────────────────────────────────────── */
  window.ARC_COLORS = [
    '#E03A3E',  // 1  red
    '#963D97',  // 2  purple
    '#009DDC',  // 3  blue
    '#00A99D',  // 4  teal
    '#61BB46',  // 5  green
    '#A5CD39',  // 6  yellow-green
    '#FDB827',  // 7  yellow
    '#F5821F',  // 8  orange
  ];

  /* ── State ──────────────────────────────────────────────────────────────── */
  // There is no separate "created" flag: every slot always exists, and is
  // simply on or off. Off IS zero span (left === right) — there's no other
  // state to track, so nothing can ever get out of sync. Turning a slot on
  // (via the circle's "+" cursor or its own button, see activateArc below)
  // always places it fresh; turning it off (deactivateArc) always collapses
  // it back to zero width. See isArcOn().
  window.CircleState = {
    arcs: [
      { left: 0, right: 359.9, heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 90, heightMode: 'hemisphere' },
    ],
    selected:  0,    // last interacted arc (height slider / patterns)
    hovered:  -1,    // arc index the mouse is over right now (-1 = none)
    positionAngle: 15,
    heightReadPos: 0,  // 0–1: H readhead's position within whichever arc's height range the sound object is azimuthally inside right now
    module:        'perimetro',
    ghostOpposition: 'origine',
    showSpeakers: false, // toggled by #speaker-viz-toggle — shared by both the flat and isometric views, off by default
  };

  /* ── SVG constants ──────────────────────────────────────────────────────── */
  var CX = 100, CY = 100, R = 80;

  /* ── Math helpers ───────────────────────────────────────────────────────── */
  function norm(a)  { return ((a % 360) + 360) % 360; }
  function toRad(d) { return d * Math.PI / 180; }

  /** Snaps to the nearest 0.5° — every drag/typed angle in the app lands on
   *  this grid, no finer movement is possible. Plain rounding only; azimuth
   *  values (which wrap) need roundAzimuth below instead, since rounding
   *  something like 359.8° can land exactly on 360, which is off the grid
   *  this app actually uses ([0,360)) — norm() folds it back to 0. */
  function roundToHalf(deg) { return Math.round(deg * 2) / 2; }
  function roundAzimuth(deg) { return norm(roundToHalf(norm(deg))); }

  /** Traversa mirrors every zone onto the opposite azimuth (see the "Ghost
   *  arc" section in draw() and circle-iso.js's renderTraversaGhost) — a
   *  zone wider than half the circle would necessarily overlap its own
   *  180°-rotated ghost, so its span is capped there instead of the usual
   *  ~full circle. */
  function maxSpanAllowed() {
    return (window.CircleState && window.CircleState.module === 'traversa') ? 180 : 359.5;
  }

  function pt(a, r) {
    r = (r === undefined) ? R : r;
    var rad = toRad(a);
    return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
  }

  function angleOf(x, y) {
    return norm(Math.atan2(x - CX, -(y - CY)) * 180 / Math.PI);
  }

  function centroidAngle(left, right) {
    return norm(left + arcSpan(left, right) / 2);
  }

  function arcSpan(left, right) { return norm(right - left); }

  /* ── Overlap detection ──────────────────────────────────────────────────── */
  function angleInArc(angle, left, right) {
    var span = arcSpan(left, right);
    if (span < 0.5) return false;
    var d = norm(angle - left);
    return d > 0.5 && d < span - 0.5;
  }

  function arcsOverlap(l1, r1, l2, r2) {
    return angleInArc(norm(l1 + 0.5), l2, r2) ||
           angleInArc(norm(r1 - 0.5), l2, r2) ||
           angleInArc(norm(l2 + 0.5), l1, r1) ||
           angleInArc(norm(r2 - 0.5), l1, r1);
  }

  /** Inclusive containment (unlike angleInArc above, which deliberately
   *  excludes the endpoints for overlap detection) — finds which active arc
   *  the sound object currently sits in azimuthally, so the H readhead knows
   *  whose heightMin/heightMax range to read its 0–1 position against. Same
   *  logic as circle-iso.js's own copy (each view keeps its own — see that
   *  file's architecture note). */
  function arcIndexForAngle(angle) {
    var arcs = window.CircleState.arcs;
    for (var i = 0; i < arcs.length; i++) {
      var a = arcs[i];
      if (!isArcOn(a)) continue;
      var span = arcSpan(a.left, a.right);
      var d = norm(angle - a.left);
      if (d <= span + 0.01) return i;
    }
    return -1;
  }

  /** An arc is "on" purely by having nonzero span — see the State comment
   *  above. Same 0.5° tolerance as angleInArc's own zero-span guard. */
  function isArcOn(arc) {
    return !!arc && arcSpan(arc.left, arc.right) > 0.5;
  }

  function wouldOverlap(arcIdx, newLeft, newRight) {
    var arcs = window.CircleState.arcs;
    for (var i = 0; i < arcs.length; i++) {
      if (i === arcIdx || !isArcOn(arcs[i])) continue;
      if (arcsOverlap(newLeft, newRight, arcs[i].left, arcs[i].right)) return true;
    }
    return false;
  }

  /* ── Zone activation (click on an empty slot, or the arc's own button) ──── */
  function firstOffArcIndex() {
    var arcs = window.CircleState.arcs;
    for (var i = 0; i < arcs.length; i++) {
      if (!isArcOn(arcs[i])) return i;
    }
    return -1;
  }

  var NEW_ARC_HALF_SPAN = 22.5;  // 45° di default
  var MIN_HALF_SPAN     = 1;     // ~2° minimo, stessa tolleranza usata altrove nel file

  /** Largest symmetric half-span around `center` (<= maxHalf, >= minHalf) that
   *  doesn't overlap any other active arc, or null if even minHalf doesn't fit. */
  function fitHalfSpanAt(center, maxHalf, minHalf, excludeIdx) {
    function fits(half) {
      var l = norm(center - half), r = norm(center + half);
      return !wouldOverlap(excludeIdx, l, r);
    }
    if (fits(maxHalf)) return maxHalf;
    if (!fits(minHalf)) return null;
    var lo = minHalf, hi = maxHalf;
    for (var iter = 0; iter < 24; iter++) {
      var mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Best currently-free gap between ON arcs (wrap-aware), for auto-placing
   *  a zone activated from its own button — unlike a circle click, there's
   *  no cursor position to place it at. Whole circle free → dead center.
   *
   *  Each candidate gap (the space between two angularly-consecutive ON
   *  arcs) is validated with the SAME fitHalfSpanAt used everywhere else,
   *  rather than trusted from raw angle subtraction — two neighbors can end
   *  up very slightly overlapping (e.g. a preset morph interpolates left/
   *  right independently and doesn't itself enforce non-overlap), and a
   *  naive `next.left - cur.right` then wraps around into a bogus ~360°
   *  "gap" that actually sits inside a different, already-occupied arc.
   *  Validating every candidate for real, and only ever returning one that
   *  fitHalfSpanAt actually confirmed, means a phantom gap like that simply
   *  fails its own check and gets skipped — instead of winning by looking
   *  huge and silently blocking every genuine (small) gap from ever being
   *  picked, which is what let clicking an available slot's button do
   *  nothing even though real free space existed elsewhere on the circle.
   *
   *  Among the validated candidates, prefer the SMALLEST gap that fits a
   *  full-size default zone without shrinking — the single largest gap is
   *  very often one big leftover swath far from where the other zones
   *  actually are, so always jumping there reads as "nothing happened" to
   *  someone watching the space between their existing zones. Only if none
   *  fit the full default do we fall back to whichever gives the biggest
   *  achievable span, so the new zone shrinks as little as possible. */
  function bestGapPlacement(excludeIdx) {
    var arcs = window.CircleState.arcs;
    var on = [];
    arcs.forEach(function (a, i) {
      if (i !== excludeIdx && isArcOn(a)) on.push({ left: a.left, right: a.right });
    });
    if (on.length === 0) return { center: 0, half: NEW_ARC_HALF_SPAN };
    on.sort(function (a, b) { return a.left - b.left; });

    var candidates = [];
    for (var i = 0; i < on.length; i++) {
      var cur     = on[i];
      var next    = on[(i + 1) % on.length];
      var gapSize = norm(next.left - cur.right);
      var center  = norm(cur.right + gapSize / 2);
      var half    = fitHalfSpanAt(center, NEW_ARC_HALF_SPAN, MIN_HALF_SPAN, excludeIdx);
      if (half !== null) candidates.push({ center: center, half: half, gapSize: gapSize });
    }
    if (candidates.length === 0) return null; // no room anywhere, verified

    var full = candidates.filter(function (c) { return c.half >= NEW_ARC_HALF_SPAN - 0.01; });
    if (full.length > 0) {
      full.sort(function (a, b) { return a.gapSize - b.gapSize; });
      return full[0];
    }
    candidates.sort(function (a, b) { return b.half - a.half; });
    return candidates[0];
  }

  /** Traversa mirrors every active zone with a ghost opposite it (see the
   *  "Ghost arc" section in draw() and circle-iso.js's renderTraversaGhost)
   *  — each one effectively counts as two on screen, so the usual 8-slot
   *  cap is halved here to keep the total from looking like a cluttered 8
   *  real + 8 ghost mess. */
  var MAX_ACTIVE_TRAVERSA = 4;

  /** Turns a slot on: places it at `center` (an explicit angle, e.g. from a
   *  circle click) or, if omitted, in the best free gap (button click, see
   *  bestGapPlacement) — always at the default span/height, exactly like a
   *  fresh zone. Returns false (no-op) if there's no room at all, or if
   *  Traversa's own lower active-zone cap (see MAX_ACTIVE_TRAVERSA) is
   *  already reached. */
  function activateArc(idx, center) {
    var arc = window.CircleState.arcs[idx];
    if (!arc) return false;
    if (window.CircleState.module === 'traversa') {
      var activeCount = window.CircleState.arcs.filter(isArcOn).length;
      if (activeCount >= MAX_ACTIVE_TRAVERSA) return false;
    }
    var c, half;
    if (center === undefined || center === null) {
      var placement = bestGapPlacement(idx);
      if (!placement) return false;
      c = placement.center;
      half = placement.half;
    } else {
      c = norm(center);
      half = fitHalfSpanAt(c, NEW_ARC_HALF_SPAN, MIN_HALF_SPAN, idx);
      if (half === null) return false;
    }
    arc.left       = roundAzimuth(c - half);
    arc.right      = roundAzimuth(c + half);
    arc.heightMin  = 0;
    arc.heightMax  = 90;
    arc.heightMode = 'hemisphere';
    return true;
  }

  /** Turns a slot off: collapses it to zero span in place — see isArcOn(). */
  function deactivateArc(idx) {
    var arc = window.CircleState.arcs[idx];
    if (!arc) return;
    arc.right = arc.left;
  }

  /* ── SVG element factory ────────────────────────────────────────────────── */
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }

  /* ── Path builders ──────────────────────────────────────────────────────── */
  function fullCirclePath(r) {
    var top = pt(0, r), bot = pt(180, r);
    return 'M ' + top.x.toFixed(2) + ' ' + top.y.toFixed(2) +
           ' A ' + r + ' ' + r + ' 0 1 1 ' + bot.x.toFixed(2) + ' ' + bot.y.toFixed(2) +
           ' A ' + r + ' ' + r + ' 0 1 1 ' + top.x.toFixed(2) + ' ' + top.y.toFixed(2) + ' Z';
  }

  function arcPath(startA, endA, r) {
    r = r || R;
    var span = arcSpan(startA, endA);
    if (span >= 359.5) return fullCirclePath(r);
    var s = pt(startA, r), e = pt(endA, r);
    var large = span > 180 ? 1 : 0;
    return 'M ' + s.x.toFixed(2) + ' ' + s.y.toFixed(2) +
           ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e.x.toFixed(2) + ' ' + e.y.toFixed(2);
  }

  function sectorPath(startA, endA, r) {
    r = r || R;
    var span = arcSpan(startA, endA);
    if (span >= 359.5) return fullCirclePath(r);
    var s = pt(startA, r), e = pt(endA, r);
    var large = span > 180 ? 1 : 0;
    return 'M ' + CX + ' ' + CY +
           ' L ' + s.x.toFixed(2) + ' ' + s.y.toFixed(2) +
           ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + e.x.toFixed(2) + ' ' + e.y.toFixed(2) + ' Z';
  }

  /** Full-circle special case for ringSectorPath below — same reasoning as
   *  fullCirclePath: right at a ~360° span, the endpoints of the generic
   *  formula nearly coincide, which is exactly the kind of near-degenerate
   *  input SVG's arc-flag disambiguation can render wrong. Two concentric
   *  circles of opposite winding (evenodd) sidestep that entirely. */
  function fullRingPath(rOuter, rInner) {
    var topO = pt(0, rOuter), botO = pt(180, rOuter);
    var topI = pt(0, rInner), botI = pt(180, rInner);
    return 'M ' + topO.x.toFixed(2) + ' ' + topO.y.toFixed(2) +
           ' A ' + rOuter + ' ' + rOuter + ' 0 1 1 ' + botO.x.toFixed(2) + ' ' + botO.y.toFixed(2) +
           ' A ' + rOuter + ' ' + rOuter + ' 0 1 1 ' + topO.x.toFixed(2) + ' ' + topO.y.toFixed(2) +
           ' M ' + topI.x.toFixed(2) + ' ' + topI.y.toFixed(2) +
           ' A ' + rInner + ' ' + rInner + ' 0 1 0 ' + botI.x.toFixed(2) + ' ' + botI.y.toFixed(2) +
           ' A ' + rInner + ' ' + rInner + ' 0 1 0 ' + topI.x.toFixed(2) + ' ' + topI.y.toFixed(2) + ' Z';
  }

  /** Ring-shaped wedge between two radii (rOuter > rInner), spanning the
   *  same azimuth range as sectorPath — used by the height indicator below,
   *  which needs a band that doesn't reach the centroid. */
  function ringSectorPath(startA, endA, rOuter, rInner) {
    var span = arcSpan(startA, endA);
    if (span >= 359.5) return fullRingPath(rOuter, rInner);
    var large = span > 180 ? 1 : 0;
    var so = pt(startA, rOuter), eo = pt(endA, rOuter);
    var ei = pt(endA, rInner),   si = pt(startA, rInner);
    return 'M ' + so.x.toFixed(2) + ' ' + so.y.toFixed(2) +
           ' A ' + rOuter + ' ' + rOuter + ' 0 ' + large + ' 1 ' + eo.x.toFixed(2) + ' ' + eo.y.toFixed(2) +
           ' L ' + ei.x.toFixed(2) + ' ' + ei.y.toFixed(2) +
           ' A ' + rInner + ' ' + rInner + ' 0 ' + large + ' 0 ' + si.x.toFixed(2) + ' ' + si.y.toFixed(2) +
           ' Z';
  }

  /** Darkens a "#RRGGBB" colour by `amount` (0–1) — used to shade the height
   *  indicator a bit darker than the zone's own colour, per spec. */
  function darkenColor(hex, amount) {
    var num = parseInt(hex.slice(1), 16);
    var r = Math.round(((num >> 16) & 0xFF) * (1 - amount));
    var g = Math.round(((num >> 8)  & 0xFF) * (1 - amount));
    var b = Math.round(( num        & 0xFF) * (1 - amount));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /** Elevation → horizontal radius, same orthographic convention already
   *  used by the isometric view (rig.js/circle-iso.js): r = R * cos(el).
   *  0° (horizon) stays at the outer edge, ±90° (zenith/nadir) collapses to
   *  the centre — so raising the height slider visibly shrinks this ring
   *  toward the middle of the flat 2D circle, which otherwise shows no
   *  trace at all of the (otherwise invisible-here) elevation control. */
  function heightRadius(deg) { return R * Math.cos(toRad(deg)); }

  /** Where the moving sound object (position dot) actually sits, factoring
   *  in the H readhead: its elevation is a 0–1 position (cs.heightReadPos)
   *  through the heightMin/heightMax range of whichever arc it's currently
   *  inside azimuthally — same convention circle-iso.js already uses for its
   *  own (3D) position dot. Falls back to the floor (elevation 0) when the
   *  dot isn't azimuthally inside any active arc. */
  function positionDotPoint() {
    var cs = window.CircleState;
    var curArc = cs.arcs[arcIndexForAngle(cs.positionAngle)];
    var hPct   = cs.heightReadPos || 0;
    var posEl  = curArc ? (curArc.heightMin + hPct * (curArc.heightMax - curArc.heightMin)) : 0;
    return pt(cs.positionAngle, heightRadius(posEl));
  }

  /* ── Trim-handle arrow ──────────────────────────────────────────────────── */
  function makeTrimHandle(parent, angle, side, color) {
    var p    = pt(angle);
    var rad  = toRad(angle);
    var sign = (side === 'left') ? 1 : -1;
    var tx = sign * Math.cos(rad);
    var ty = sign * Math.sin(rad);

    var shaftLen = 8, headHW = 3.5, headLen = 5;
    var tipX = p.x + tx * shaftLen;
    var tipY = p.y + ty * shaftLen;
    var px = -ty, py = tx;
    var b1x = tipX + px * headHW, b1y = tipY + py * headHW;
    var b2x = tipX - px * headHW, b2y = tipY - py * headHW;
    var hx  = tipX + tx * headLen, hy = tipY + ty * headLen;

    var g = el('g', {
      'data-handle': side === 'left' ? 'trim-left' : 'trim-right',
      class: 'trim-handle svg-handle',
      style: 'cursor: ew-resize;',
    });

    g.appendChild(el('circle', {
      cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: '11', fill: 'transparent',
    }));
    g.appendChild(el('circle', {
      cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: '3.5',
      fill: '#fff', stroke: color, 'stroke-width': '1.5',
      class: 'trim-dot-el',
    }));
    g.appendChild(el('line', {
      x1: p.x.toFixed(2), y1: p.y.toFixed(2),
      x2: tipX.toFixed(2), y2: tipY.toFixed(2),
      stroke: color, 'stroke-width': '1.5',
    }));
    g.appendChild(el('polygon', {
      points: b1x.toFixed(2) + ',' + b1y.toFixed(2) + ' ' +
              b2x.toFixed(2) + ',' + b2y.toFixed(2) + ' ' +
              hx.toFixed(2)  + ',' + hy.toFixed(2),
      fill: color,
    }));

    parent.appendChild(g);
  }

  /* ── Speaker illustrations (perimeter rig, read-only decoration) ─────────
     Small trapezoid "cabinet" markers around the outside of the circle, at
     each speaker's real azimuth — wide edge facing the circle (the cabinet's
     front baffle, facing the listening position), narrow edge pointing out.
     Only speakers near the horizon (elevation 0–5°) are shown here — the
     flat view has no way to show height, so drawing the overhead/floor
     speakers here too would just misrepresent them as being at ear level.
     Those still show up in the isometric view (see circle-iso.js), which
     can actually place them at their real height.
     Distance also pushes the icon further from (or closer to) the circle —
     dist=1 (the rig's reference distance) sits at the original offset, a
     farther/closer speaker's icon moves out/in proportionally. */
  var SPK_HW_NEAR = 3.25, SPK_HW_FAR = 1.6, SPK_BASE_OFFSET = 6, SPK_HALF_SPAN = 3;
  function speakerIconPoints(azimuthDeg, dist) {
    var rad  = toRad(azimuthDeg);
    var sinA = Math.sin(rad), cosA = Math.cos(rad);
    function at(u, r) {
      return { x: CX + r * sinA + u * cosA, y: CY - r * cosA + u * sinA };
    }
    var center = SPK_BASE_OFFSET * dist;
    return [
      at(-SPK_HW_NEAR, R + center - SPK_HALF_SPAN),
      at( SPK_HW_NEAR, R + center - SPK_HALF_SPAN),
      at( SPK_HW_FAR,  R + center + SPK_HALF_SPAN),
      at(-SPK_HW_FAR,  R + center + SPK_HALF_SPAN),
    ];
  }

  function drawSpeakerIcons(svg) {
    if (!window.CircleState.showSpeakers) return;
    if (!window.RigAPI || !window.RigAPI.getSpeakerPositions) return;
    var speakers = window.RigAPI.getSpeakerPositions();
    // Only the speaker(s) belonging to the currently selected subgroup(s) —
    // the illustration should reflect who's actually being driven, same
    // idea as the header's own subgroup badge/menu.
    var selected = (window.ArcsAPI && window.ArcsAPI.getSelectedSubgroups)
      ? window.ArcsAPI.getSelectedSubgroups() : null;
    speakers.forEach(function (sp) {
      if (sp.el < 0 || sp.el > 5) return; // perimeter only — see comment above
      if (selected && selected.indexOf(sp.subsetTag) === -1) return;
      var pts = speakerIconPoints(sp.az, sp.dist);
      svg.appendChild(el('polygon', {
        points: pts.map(function (p) { return p.x.toFixed(2) + ',' + p.y.toFixed(2); }).join(' '),
        fill: '#000', 'fill-opacity': '0.3', 'pointer-events': 'none',
      }));
    });
  }

  /* ── Main draw function ─────────────────────────────────────────────────── */
  function draw() {
    var svg = document.getElementById('nav-circle');
    if (!svg) return;
    svg.innerHTML = '';

    var cs     = window.CircleState;
    var hovIdx = cs.hovered;

    /* 1 ── Cross guides (pointer-events:none — mouse passes through to arcs) */
    svg.appendChild(el('line', { x1: CX, y1: CY - R - 10, x2: CX, y2: CY + R + 10, stroke: '#D3D1CC', 'stroke-width': '0.5', 'pointer-events': 'none' }));
    svg.appendChild(el('line', { x1: CX - R - 10, y1: CY, x2: CX + R + 10, y2: CY, stroke: '#D3D1CC', 'stroke-width': '0.5', 'pointer-events': 'none' }));

    /* 2 ── Main circle outline (pointer-events:none) */
    svg.appendChild(el('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: '#1A1917', 'stroke-width': '1', 'pointer-events': 'none' }));

    /* 2b ── Speaker illustrations (perimeter rig) */
    drawSpeakerIcons(svg);

    /* 3 ── Ghost arc (Traversa mode — only while an arc is actively hovered) */
    if (cs.module === 'traversa' && hovIdx >= 0) {
      var refArc = cs.arcs[hovIdx];
      if (refArc && isArcOn(refArc)) {
        var refIdx = hovIdx;
        var refCol = window.ARC_COLORS[refIdx];
        var gL, gR;
        if (cs.ghostOpposition === 'origine') {
          gL = norm(refArc.left  + 180);
          gR = norm(refArc.right + 180);
        } else {
          var gCent = centroidAngle(refArc.left, refArc.right);
          gL = norm(gCent + 180 - (gCent - refArc.left));
          gR = norm(gCent + 180 + (refArc.right - gCent));
        }
        svg.appendChild(el('path', { d: sectorPath(gL, gR), fill: refCol + '18' }));
        svg.appendChild(el('path', {
          d: arcPath(gL, gR), fill: 'none',
          stroke: refCol, 'stroke-width': '1.5', 'stroke-dasharray': '4 3', opacity: '0.35',
        }));
        var ga = pt(norm(gR + 4), R + 10);
        var gb = pt(norm(gL - 4), R + 10);
        var t1 = el('text', { 'text-anchor': 'middle', 'font-size': '7', fill: refCol,
                              opacity: '0.45', 'font-family': 'Arial',
                              x: ga.x.toFixed(1), y: ga.y.toFixed(1) });
        t1.textContent = '2';
        var t2 = el('text', { 'text-anchor': 'middle', 'font-size': '7', fill: refCol,
                              opacity: '0.45', 'font-family': 'Arial',
                              x: gb.x.toFixed(1), y: gb.y.toFixed(1) });
        t2.textContent = '1';
        svg.appendChild(t1);
        svg.appendChild(t2);
      }
    }

    /* 3b ── Hover ghost badge: small grey "+" as an apex to the cursor, over an
             available (inactive) slot — click there activates that slot's arc. */
    if (ghostArcIdx >= 0 && ghostPoint) {
      var gx = ghostPoint.x + 5, gy = ghostPoint.y - 5;
      var gs = 2.6;
      svg.appendChild(el('line', {
        x1: (gx - gs).toFixed(2), y1: gy.toFixed(2), x2: (gx + gs).toFixed(2), y2: gy.toFixed(2),
        stroke: '#8B857A', 'stroke-width': '1.1', 'stroke-linecap': 'round', 'pointer-events': 'none',
      }));
      svg.appendChild(el('line', {
        x1: gx.toFixed(2), y1: (gy - gs).toFixed(2), x2: gx.toFixed(2), y2: (gy + gs).toFixed(2),
        stroke: '#8B857A', 'stroke-width': '1.1', 'stroke-linecap': 'round', 'pointer-events': 'none',
      }));
    }

    /* 4 ── One group per active arc: hit area + visuals + (if hovered) handles
            All elements share the same <g data-arc-hover="i"> so that:
            - closest('[data-arc-hover]') works for hover detection from any child
            - closest('[data-handle]')   works for drag from any handle child      */
    cs.arcs.forEach(function (arc, i) {
      if (!isArcOn(arc)) return;   // zero-span arcs ("off") are completely hidden

      var col   = window.ARC_COLORS[i];
      var isHov = (i === hovIdx);

      var g = el('g', { 'data-arc-hover': i, style: 'cursor: pointer;' });

      /* Wide invisible hit band along the arc (makes hovering easy) */
      g.appendChild(el('path', {
        d: arcPath(arc.left, arc.right),
        fill: 'none', stroke: 'transparent', 'stroke-width': '24',
      }));
      /* Invisible sector hit area (covers centroid region) */
      g.appendChild(el('path', {
        d: sectorPath(arc.left, arc.right),
        fill: 'transparent', stroke: 'none',
      }));

      /* Sector fill */
      g.appendChild(el('path', {
        d: sectorPath(arc.left, arc.right),
        fill: col + (isHov ? '18' : '0D'),
      }));

      /* Height indicator (selected zone only): a band that shrinks toward
         the centre as elevation rises — see heightRadius above. At the
         default heightMin=heightMax=0 it collapses to zero width, so a
         freshly-created zone shows nothing extra, exactly matching the
         "no height set yet" case. */
      if (i === cs.selected) {
        var rA = heightRadius(arc.heightMin);
        var rB = heightRadius(arc.heightMax);
        var outerR = Math.max(rA, rB);
        var innerR = Math.min(rA, rB);
        if (outerR - innerR > 0.5) {
          g.appendChild(el('path', {
            d: ringSectorPath(arc.left, arc.right, outerR, innerR),
            fill: darkenColor(col, 0.0005) + '10',
            'pointer-events': 'none',
          }));
        }
      }

      /* Arc stroke */
      g.appendChild(el('path', {
        d: arcPath(arc.left, arc.right), fill: 'none',
        stroke: col, 'stroke-width': isHov ? '2.8' : '2',
      }));

      /* Handles — only when hovered */
      if (isHov) {
        var cent    = centroidAngle(arc.left, arc.right);
        var span    = arcSpan(arc.left, arc.right);
        /* Square-root mapping: quarter of the current max → ~50% R, full
           current max → 92% R (full travel) — normalized against whatever
           the max span currently is, so the handle still uses its whole
           travel range even when Traversa caps it to 180°. */
        var originR = R * 0.92 * Math.sqrt(span / maxSpanAllowed());
        var centPt  = pt(cent);

        /* Wide invisible hit-band along the whole centre→centroid radius —
           the origin handle (span control) lives somewhere on this line at
           a radius that shrinks with the span, and for a very small arc it
           ends up just a few px from the centre, inside what would
           otherwise be a hair-thin hoverable sliver (the sector hit area
           narrows to the same vanishing point there). This band stays a
           constant, generous width the whole way in, so the handle stays
           reachable regardless of how small the arc is. Gated to isHov,
           same as the other handle-only elements — only the arc actually
           being interacted with gets a widened region near the shared
           centre point, so it can't "steal" clicks meant for some other
           active arc's own (much thinner) approach to the centre. Same fix
           the isometric view already uses (see renderCentroidRadiusHitBand
           in circle-iso.js). */
        g.appendChild(el('line', {
          x1: CX, y1: CY,
          x2: pt(cent, R * 1.05).x.toFixed(2), y2: pt(cent, R * 1.05).y.toFixed(2),
          stroke: 'transparent', 'stroke-width': '18',
        }));

        /* Dashed radials to endpoints */
        [arc.left, arc.right].forEach(function (ang) {
          var ep = pt(ang);
          g.appendChild(el('line', {
            x1: CX, y1: CY, x2: ep.x.toFixed(2), y2: ep.y.toFixed(2),
            stroke: col, 'stroke-width': '0.75', opacity: '0.3', 'stroke-dasharray': '2.5 2',
          }));
        });

        /* Centroid line */
        g.appendChild(el('line', {
          x1: CX, y1: CY, x2: centPt.x.toFixed(2), y2: centPt.y.toFixed(2),
          stroke: col, 'stroke-width': '1', opacity: '0.5',
        }));

        /* Origin handle */
        var origPt = pt(cent, originR);
        g.appendChild(el('circle', {
          cx: origPt.x.toFixed(2), cy: origPt.y.toFixed(2), r: '5',
          fill: '#fff', stroke: col, 'stroke-width': '1.5',
          'data-handle': 'origin', class: 'svg-handle', style: 'cursor: ns-resize;',
        }));

        /* Trim handles */
        makeTrimHandle(g, arc.left,  'left',  col);
        makeTrimHandle(g, arc.right, 'right', col);

        /* Centroid handle */
        g.appendChild(el('circle', {
          cx: centPt.x.toFixed(2), cy: centPt.y.toFixed(2), r: '6.5',
          fill: col, stroke: 'none',
          'data-handle': 'centroid', class: 'svg-handle', style: 'cursor: grab;',
        }));
      }

      svg.appendChild(g);
    });

    /* 5 ── Position dot, OR — in Diretto mode — static black semi-arcs over
            every active arc (sound is spread there, nothing moves) */
    if (cs.module === 'diretto') {
      cs.arcs.forEach(function (arc) {
        if (!isArcOn(arc)) return;
        svg.appendChild(el('path', {
          d: arcPath(arc.left, arc.right, R + 7), fill: 'none',
          stroke: '#0F0E0D', 'stroke-width': '2',
          'pointer-events': 'none',
        }));
      });
    } else {
      var posPt = positionDotPoint();
      svg.appendChild(el('circle', {
        cx: posPt.x.toFixed(2), cy: posPt.y.toFixed(2), r: '5',
        fill: '#0F0E0D', stroke: '#fff', 'stroke-width': '1.5',
        class: 'position-dot', 'pointer-events': 'none',
      }));
    }
  }

  /* Coalesce redraws to at most once per animation frame — mousemove can
     fire far more often than the screen actually repaints, and rebuilding
     the whole SVG scene on every single event isn't free. Only this
     render is throttled; every other control's own values/DOM updates
     (height slider, speed range, readhead...) stay untouched and instant,
     since those will eventually drive real audio parameters. */
  var drawScheduled = false;
  function requestDraw() {
    if (drawScheduled) return;
    drawScheduled = true;
    requestAnimationFrame(function () {
      drawScheduled = false;
      draw();
    });
  }

  /** Cheap alternative to draw(), for the playback/readhead-drag ticks where
   *  only cs.positionAngle changes — no arc was added/removed/resized. Those
   *  ticks fire up to 60×/sec, and draw() wipes + rebuilds the *entire* SVG
   *  (including every handle) on every single call. That's harmless to look
   *  at, but it silently broke double-clicking any handle while playing:
   *  browsers reset their double-click counter whenever the second click's
   *  target is a different DOM node than the first click's — even at the
   *  exact same screen position — and a handle rebuilt between the two
   *  clicks is always a brand-new node. Moving the existing dot in place
   *  avoids touching the rest of the scene at all. */
  function updatePositionDot() {
    var svg = document.getElementById('nav-circle');
    if (!svg) return;
    var cs = window.CircleState;
    if (cs.module === 'diretto') return; // no dot in this mode — nothing to move
    var dot = svg.querySelector('.position-dot');
    if (!dot) { draw(); return; } // first paint hasn't happened yet
    var p = positionDotPoint();
    dot.setAttribute('cx', p.x.toFixed(2));
    dot.setAttribute('cy', p.y.toFixed(2));
  }

  /* ── SVG coordinate conversion ──────────────────────────────────────────── */
  function toSVG(svg, e) {
    var p  = svg.createSVGPoint();
    p.x = e.touches ? e.touches[0].clientX : e.clientX;
    p.y = e.touches ? e.touches[0].clientY : e.clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }

  /* ── Hover detection (mousemove on SVG) ─────────────────────────────────── */
  function onSVGMouseMove(e) {
    if (dragging !== null) return;  // don't change hover during drag
    var svg = document.getElementById('nav-circle');
    if (!svg) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    var hitEl  = target && target.closest('[data-arc-hover]');
    var newHov = hitEl ? parseInt(hitEl.getAttribute('data-arc-hover'), 10) : -1;
    var cs = window.CircleState;

    // Ghost "+": anywhere inside the circle that isn't an active arc, as long
    // as a slot is still off (geometry decided on click — see activateArc).
    var sp        = toSVG(svg, e);
    var dist      = Math.hypot(sp.x - CX, sp.y - CY);
    var prevGhost = ghostArcIdx;
    ghostArcIdx = -1;
    ghostPoint  = null;
    if (newHov === -1 && dist <= R) {
      var idx = firstOffArcIndex();
      if (idx >= 0) { ghostArcIdx = idx; ghostPoint = { x: sp.x, y: sp.y }; }
    }

    if (newHov !== cs.hovered) {
      cs.hovered = newHov;
      if (newHov >= 0) {
        cs.selected = newHov;
        if (window.ArcsAPI) {
          window.ArcsAPI.syncHeightSlider(newHov);
          window.ArcsAPI.updateArcButtons();
        }
      } else {
        if (window.ArcsAPI) window.ArcsAPI.updateArcButtons();
      }
      requestDraw();
    } else if (ghostArcIdx >= 0 || prevGhost >= 0) {
      requestDraw();
    }
  }

  function onSVGMouseLeave() {
    if (dragging !== null) return;
    var cs = window.CircleState;
    var needDraw = false;
    if (cs.hovered !== -1) {
      cs.hovered = -1;
      if (window.ArcsAPI) window.ArcsAPI.updateArcButtons();
      needDraw = true;
    }
    if (ghostArcIdx !== -1) { ghostArcIdx = -1; ghostPoint = null; needDraw = true; }
    if (needDraw) requestDraw();
  }

  /* ── Click on empty space: activate the next off zone under the cursor ─── */
  function onSVGClick() {
    if (dragging !== null || ghostArcIdx < 0 || !ghostPoint) return;
    var cs  = window.CircleState;
    var arc = cs.arcs[ghostArcIdx];
    if (!arc || isArcOn(arc)) return;

    var idx    = ghostArcIdx;
    var center = angleOf(ghostPoint.x, ghostPoint.y);
    if (!activateArc(idx, center)) return; // nessuno spazio disponibile qui

    cs.selected = idx;
    cs.hovered  = idx;
    ghostArcIdx = -1;
    ghostPoint  = null;

    if (window.ArcsAPI) {
      window.ArcsAPI.updateArcButtons();
      window.ArcsAPI.syncHeightSlider(idx);
      window.ArcsAPI.autosave();
      var rpos = (window.AppBridge && window.AppBridge.getReadheadPos) ? window.AppBridge.getReadheadPos() : 0.4;
      window.ArcsAPI.applyReadhead(rpos);
    }
    draw();
  }

  /* ── Ghost hover state (shadow over an available slot) ──────────────────── */
  var ghostArcIdx = -1;
  var ghostPoint  = null;

  /* ── Drag state ─────────────────────────────────────────────────────────── */
  var dragging   = null;
  var dragArcIdx = -1;
  var snap = {};
  var ORIGIN_DRAG_SENSITIVITY = 2; // degrees of span per screen px of vertical drag

  function onDown(e) {
    var handle = e.target.closest('[data-handle]');
    if (!handle || !handle.dataset.handle) return;
    e.preventDefault();
    var cs = window.CircleState;
    dragArcIdx = cs.hovered >= 0 ? cs.hovered : cs.selected;
    var arc = cs.arcs[dragArcIdx];
    if (!arc) return;
    dragging = handle.dataset.handle;
    snap = {
      left:   arc.left,
      right:  arc.right,
      span:   arcSpan(arc.left, arc.right),
      cent:   centroidAngle(arc.left, arc.right),
      startY: e.touches ? e.touches[0].clientY : e.clientY,
    };
  }

  function onMove(e) {
    if (!dragging || dragArcIdx < 0) return;
    e.preventDefault();
    var svg = document.getElementById('nav-circle');
    var sp  = toSVG(svg, e);
    var cs  = window.CircleState;
    var arc = cs.arcs[dragArcIdx];

    if (dragging === 'centroid') {
      var newCent = angleOf(sp.x, sp.y);
      var half    = snap.span / 2;
      var newL    = roundAzimuth(newCent - half);
      var newR    = roundAzimuth(newCent + half);
      if (!wouldOverlap(dragArcIdx, newL, newR)) {
        arc.left  = newL;
        arc.right = newR;
      }

    } else if (dragging === 'origin') {
      /* Vertical scrubber (drag up = wider, down = narrower), same
         technique as the height handles — not cursor-locked to the
         handle's own radial position, which used to force the drag
         direction to follow wherever the arc's centroid happened to
         point (horizontal for an east/west arc, diagonal otherwise). */
      var curY = e.touches ? e.touches[0].clientY : e.clientY;
      var dyOrigin = snap.startY - curY;
      var newSpan  = Math.max(1, Math.min(maxSpanAllowed(), roundToHalf(snap.span + dyOrigin * ORIGIN_DRAG_SENSITIVITY)));
      var nL      = roundAzimuth(snap.cent - newSpan / 2);
      var nR      = roundAzimuth(snap.cent + newSpan / 2);
      if (!wouldOverlap(dragArcIdx, nL, nR)) {
        arc.left  = nL;
        arc.right = nR;
      }

    } else if (dragging === 'trim-left') {
      var newA  = roundAzimuth(angleOf(sp.x, sp.y));
      var newSp = arcSpan(newA, arc.right);
      if (newSp > 1 && newSp <= maxSpanAllowed() && !wouldOverlap(dragArcIdx, newA, arc.right)) {
        arc.left = newA;
      }

    } else if (dragging === 'trim-right') {
      var newA2  = roundAzimuth(angleOf(sp.x, sp.y));
      var newSp2 = arcSpan(arc.left, newA2);
      if (newSp2 > 1 && newSp2 <= maxSpanAllowed() && !wouldOverlap(dragArcIdx, arc.left, newA2)) {
        arc.right = newA2;
      }
    }

    // Keep position dot in sync
    if (window.ArcsAPI && window.AppBridge) {
      cs.positionAngle = window.ArcsAPI.computePositionAngle(window.AppBridge.getReadheadPos());
    }
    requestDraw();
  }

  function onUp() {
    if (dragging !== null && window.ArcsAPI) {
      // Resizing a zone (trim/origin/centroid drag) changes its span
      // without ever going through toggleArc/onSVGClick — anything that
      // depends on the CURRENT span (e.g. Perimetro's Transfer Ease/Decay
      // gating, see updateArcButtons in arcs.js) was going stale until some
      // unrelated event (a hover change) happened to refresh it.
      window.ArcsAPI.updateArcButtons();
      window.ArcsAPI.autosave();
    }
    dragging   = null;
    dragArcIdx = -1;
  }

  /* ── Hover: grow trim dot ───────────────────────────────────────────────── */
  function onOver(e) {
    var g = e.target.closest('.trim-handle');
    if (g) { var d = g.querySelector('.trim-dot-el'); if (d) d.setAttribute('r', '5.5'); }
  }
  function onOut(e) {
    var g = e.target.closest('.trim-handle');
    if (g) { var d = g.querySelector('.trim-dot-el'); if (d) d.setAttribute('r', '3.5'); }
  }
  /* ── Double-click handle editor ────────────────────────────────────────────── */
  /** Generic "punch in a precise value" popup — positioning, keyboard
   *  wiring (Enter/Escape/blur) and the double-fire guard are all handled
   *  here; callers only supply what to show and what to do with the parsed
   *  number. Exported as window.ValueEditorAPI so circle-iso.js and the
   *  flat height-range slider (app.js) can reuse the exact same popup
   *  instead of each re-implementing it.
   *  opts: { label, value, min, max, screenX, screenY, onApply(rawNumber) } */
  function openValueEditor(opts) {
    var existing = document.getElementById('circle-handle-editor');
    if (existing) existing.remove();

    var wrap = document.createElement('div');
    wrap.id = 'circle-handle-editor';
    wrap.innerHTML =
      '<span class="che-label">' + opts.label + '</span>' +
      '<input class="che-input mono" type="number" step="0.5" min="' + opts.min +
      '" max="' + opts.max + '" value="' + opts.value + '" autocomplete="off">';

    document.body.appendChild(wrap);
    var pw = wrap.offsetWidth, ph = wrap.offsetHeight;
    var vw = window.innerWidth,  vh = window.innerHeight;
    var x  = Math.min(opts.screenX + 10, vw - pw - 10);
    var y  = opts.screenY - ph - 10;
    if (y < 8) y = opts.screenY + 14;
    wrap.style.left = x + 'px';
    wrap.style.top  = y + 'px';

    var input = wrap.querySelector('.che-input');
    input.focus();
    input.select();

    function dismiss() {
      var el = document.getElementById('circle-handle-editor');
      if (el) el.remove();
    }

    function applyValue() {
      if (!document.getElementById('circle-handle-editor')) return; // already dismissed
      var raw = parseFloat(input.value);
      dismiss();
      if (!isNaN(raw)) opts.onApply(raw);
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  { applyValue(); e.preventDefault(); }
      if (e.key === 'Escape') { dismiss();    e.preventDefault(); }
    });
    input.addEventListener('blur', function () {
      setTimeout(applyValue, 60); // allow Enter keydown to fire first
    });
  }

  window.ValueEditorAPI = { open: openValueEditor };

  function openHandleEditor(handleType, arcIdx, screenX, screenY) {
    var cs  = window.CircleState;
    var arc = cs.arcs[arcIdx];
    if (!arc) return;

    var cent = centroidAngle(arc.left, arc.right);
    var span = arcSpan(arc.left, arc.right);

    /* ±180° display convention: 0 = top, clockwise = positive, CCW = negative */
    function toDisplay(internal) {
      var d = ((internal % 360) + 360) % 360;
      return d > 180 ? d - 360 : d;   // maps 0-359 → -180..180
    }
    function toInternal(display) {
      return roundAzimuth(display);
    }

    var label, currentVal, minVal, maxVal;

    switch (handleType) {
      case 'trim-left':
        label = 'Angolo sinistro (°)';  currentVal = toDisplay(arc.left);  minVal = -180; maxVal = 180; break;
      case 'trim-right':
        label = 'Angolo destro (°)';    currentVal = toDisplay(arc.right); minVal = -180; maxVal = 180; break;
      case 'centroid':
        label = 'Centroide (°)';        currentVal = toDisplay(cent);      minVal = -180; maxVal = 180; break;
      case 'origin':
        label = 'Apertura (°)';         currentVal = roundToHalf(span);    minVal = 1;    maxVal = maxSpanAllowed(); break;
      default: return;
    }

    openValueEditor({
      label: label, value: currentVal, min: minVal, max: maxVal,
      screenX: screenX, screenY: screenY,
      onApply: function (raw) {
        if (handleType === 'origin') {
          var newSpan = Math.max(1, Math.min(maxSpanAllowed(), roundToHalf(raw)));
          var nL = roundAzimuth(cent - newSpan / 2);
          var nR = roundAzimuth(cent + newSpan / 2);
          if (!wouldOverlap(arcIdx, nL, nR)) { arc.left = nL; arc.right = nR; }

        } else {
          var deg = toInternal(raw);
          if (handleType === 'trim-left') {
            if (arcSpan(deg, arc.right) > 1 && !wouldOverlap(arcIdx, deg, arc.right))
              arc.left = deg;
          } else if (handleType === 'trim-right') {
            if (arcSpan(arc.left, deg) > 1 && !wouldOverlap(arcIdx, arc.left, deg))
              arc.right = deg;
          } else if (handleType === 'centroid') {
            var half = span / 2;
            var cL = roundAzimuth(deg - half);
            var cR = roundAzimuth(deg + half);
            if (!wouldOverlap(arcIdx, cL, cR)) { arc.left = cL; arc.right = cR; }
          }
        }

        if (window.ArcsAPI) {
          window.ArcsAPI.updateArcButtons();
          window.ArcsAPI.autosave();
        }
        if (window.ArcsAPI && window.AppBridge)
          cs.positionAngle = window.ArcsAPI.computePositionAngle(window.AppBridge.getReadheadPos());
        draw();
      },
    });
  }

  function onDblClick(e) {
    var handle = e.target.closest('[data-handle]');
    if (!handle) return;
    e.preventDefault();
    var cs = window.CircleState;
    var arcIdx = cs.hovered >= 0 ? cs.hovered : cs.selected;
    openHandleEditor(handle.dataset.handle, arcIdx, e.clientX, e.clientY);
  }
  /* ── Init ───────────────────────────────────────────────────────────────── */
  function init() {
    var svg = document.getElementById('nav-circle');
    if (!svg) return;

    svg.addEventListener('mousemove',  onSVGMouseMove);
    svg.addEventListener('mouseleave', onSVGMouseLeave);
    svg.addEventListener('click',      onSVGClick);
    svg.addEventListener('mousedown',  onDown);
    svg.addEventListener('touchstart', onDown, { passive: false });
    svg.addEventListener('mouseover',  onOver);
    svg.addEventListener('mouseout',   onOut);
    svg.addEventListener('dblclick',   onDblClick);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchend',  onUp);

    draw();
  }

  /* ── Public API ─────────────────────────────────────────────────────────── */
  window.CircleAPI = {
    // Dispatcher: the flat view always redraws (unchanged), and — only on
    // discrete events, never mid-drag — the isometric view (if active)
    // redraws too, so toggling between the two never shows a stale frame.
    draw: function () {
      requestDraw();
      if (window.CircleIsoAPI && window.CircleIsoAPI.isActive()) window.CircleIsoAPI.draw();
    },
    // Position-only update (see updatePositionDot above) — used by every
    // caller that just moves the readhead along already-unchanged arcs.
    updatePositionDot: updatePositionDot,
    setModule: function (mod) { window.CircleState.module = mod; window.CircleAPI.draw(); },
    getState:  function () { return window.CircleState; },
    // Arc lifecycle — see the State comment above: there is no "created"
    // flag, a slot is on iff it has nonzero span. arcs.js's button bar
    // drives these directly (activateArc with no center auto-picks the
    // largest free gap); this file's own click-on-circle handler uses the
    // same activateArc with an explicit center.
    isArcOn:      isArcOn,
    activateArc:  activateArc,
    deactivateArc: deactivateArc,
  };

  document.addEventListener('DOMContentLoaded', init);
})();
