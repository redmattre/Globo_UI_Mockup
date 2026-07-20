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
      { left: 0, right: 359.9, heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
      { left: 0, right: 0,     heightMin: 0, heightMax: 0, heightMode: 'hemisphere' },
    ],
    selected:  0,    // last interacted arc (height slider / patterns)
    hovered:  -1,    // arc index the mouse is over right now (-1 = none)
    positionAngle: 15,
    heightReadPos: 0,  // 0–1: H readhead's position within whichever arc's height range the sound object is azimuthally inside right now
    module:        'perimetro',
    ghostOpposition: 'origine',
  };

  /* ── SVG constants ──────────────────────────────────────────────────────── */
  var CX = 100, CY = 100, R = 80;

  /* ── Math helpers ───────────────────────────────────────────────────────── */
  function norm(a)  { return ((a % 360) + 360) % 360; }
  function toRad(d) { return d * Math.PI / 180; }

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

  /** Turns a slot on: places it at `center` (an explicit angle, e.g. from a
   *  circle click) or, if omitted, in the best free gap (button click, see
   *  bestGapPlacement) — always at the default span/height, exactly like a
   *  fresh zone. Returns false (no-op) if there's no room at all. */
  function activateArc(idx, center) {
    var arc = window.CircleState.arcs[idx];
    if (!arc) return false;
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
    arc.left       = norm(c - half);
    arc.right      = norm(c + half);
    arc.heightMin  = 0;
    arc.heightMax  = 0;
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

      /* Arc stroke */
      g.appendChild(el('path', {
        d: arcPath(arc.left, arc.right), fill: 'none',
        stroke: col, 'stroke-width': isHov ? '2.8' : '2',
      }));

      /* Handles — only when hovered */
      if (isHov) {
        var cent    = centroidAngle(arc.left, arc.right);
        var span    = arcSpan(arc.left, arc.right);
        /* Square-root mapping: 90° arc → ~50% R, 360° → 92% R (full travel) */
        var originR = R * 0.92 * Math.sqrt(span / 359.5);
        var centPt  = pt(cent);

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
      var posPt = pt(cs.positionAngle);
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
      var newL    = norm(newCent - half);
      var newR    = norm(newCent + half);
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
      var newSpan  = Math.max(1, Math.min(359.5, Math.round(snap.span + dyOrigin * ORIGIN_DRAG_SENSITIVITY)));
      var nL      = norm(snap.cent - newSpan / 2);
      var nR      = norm(snap.cent + newSpan / 2);
      if (!wouldOverlap(dragArcIdx, nL, nR)) {
        arc.left  = nL;
        arc.right = nR;
      }

    } else if (dragging === 'trim-left') {
      var newA  = angleOf(sp.x, sp.y);
      var newSp = arcSpan(newA, arc.right);
      if (newSp > 1 && newSp <= 359.5 && !wouldOverlap(dragArcIdx, newA, arc.right)) {
        arc.left = newA;
      }

    } else if (dragging === 'trim-right') {
      var newA2  = angleOf(sp.x, sp.y);
      var newSp2 = arcSpan(arc.left, newA2);
      if (newSp2 > 1 && newSp2 <= 359.5 && !wouldOverlap(dragArcIdx, arc.left, newA2)) {
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
    if (dragging !== null && window.ArcsAPI) window.ArcsAPI.autosave();
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
      '<input class="che-input mono" type="number" min="' + opts.min +
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
      return ((Math.round(display) % 360) + 360) % 360;
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
        label = 'Apertura (°)';         currentVal = Math.round(span);     minVal = 1;    maxVal = 359; break;
      default: return;
    }

    openValueEditor({
      label: label, value: currentVal, min: minVal, max: maxVal,
      screenX: screenX, screenY: screenY,
      onApply: function (raw) {
        if (handleType === 'origin') {
          var newSpan = Math.max(1, Math.min(359, Math.round(raw)));
          var nL = norm(cent - newSpan / 2);
          var nR = norm(cent + newSpan / 2);
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
            var cL = norm(deg - half);
            var cR = norm(deg + half);
            if (!wouldOverlap(arcIdx, cL, cR)) { arc.left = cL; arc.right = cR; }
          }
        }

        if (window.ArcsAPI) window.ArcsAPI.autosave();
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
