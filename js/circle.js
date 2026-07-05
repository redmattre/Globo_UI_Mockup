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
    '#4F6AB8',  // 1  blue     (pastello sobrio)
    '#5FA07C',  // 2  green
    '#CE9A54',  // 3  ochre / amber
    '#9A72B4',  // 4  violet
    '#4FA0A6',  // 5  teal
    '#C0A94F',  // 6  mustard
    '#C8737F',  // 7  rose / red
    '#7E93AA',  // 8  slate blue
  ];

  /* ── State ──────────────────────────────────────────────────────────────── */
  window.CircleState = {
    arcs: [
      { active: true,  created: true,  left: 330, right:  60, height: 0, heightMode: 'hemisphere' },
      { active: false, created: false, left:  60, right: 105, height: 0, heightMode: 'hemisphere' },
      { active: false, created: false, left: 105, right: 150, height: 0, heightMode: 'hemisphere' },
      { active: false, created: false, left: 150, right: 195, height: 0, heightMode: 'hemisphere' },
      { active: false, created: false, left: 195, right: 240, height: 0, heightMode: 'hemisphere' },
      { active: false, created: false, left: 240, right: 285, height: 0, heightMode: 'hemisphere' },
      { active: false, created: false, left: 285, right: 315, height: 0, heightMode: 'hemisphere' },
      { active: false, created: false, left: 315, right: 330, height: 0, heightMode: 'hemisphere' },
    ],
    selected:  0,    // last interacted arc (height slider / patterns)
    hovered:  -1,    // arc index the mouse is over right now (-1 = none)
    positionAngle: 15,
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

  function wouldOverlap(arcIdx, newLeft, newRight) {
    var arcs = window.CircleState.arcs;
    for (var i = 0; i < arcs.length; i++) {
      if (i === arcIdx || !arcs[i].active) continue;
      if (arcsOverlap(newLeft, newRight, arcs[i].left, arcs[i].right)) return true;
    }
    return false;
  }

  /* ── Zone creation (click on an empty slot) ─────────────────────────────── */
  function firstUncreatedArcIndex() {
    var arcs = window.CircleState.arcs;
    for (var i = 0; i < arcs.length; i++) {
      if (!arcs[i].created) return i;
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
      if (refArc && refArc.active) {
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
      if (!arc.active) return;   // inactive arcs are completely hidden

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
        opacity: isHov ? '1' : '0.7',
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

    /* 5 ── Position dot (pointer-events:none — mouse passes through to arc below) */
    var posPt = pt(cs.positionAngle);
    svg.appendChild(el('circle', {
      cx: posPt.x.toFixed(2), cy: posPt.y.toFixed(2), r: '5',
      fill: '#0F0E0D', stroke: '#fff', 'stroke-width': '1.5',
      class: 'position-dot', 'pointer-events': 'none',
    }));
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
    // as a slot is still available to be created (geometry decided on click).
    var sp        = toSVG(svg, e);
    var dist      = Math.hypot(sp.x - CX, sp.y - CY);
    var prevGhost = ghostArcIdx;
    ghostArcIdx = -1;
    ghostPoint  = null;
    if (newHov === -1 && dist <= R) {
      var idx = firstUncreatedArcIndex();
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
      draw();
    } else if (ghostArcIdx >= 0 || prevGhost >= 0) {
      draw();
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
    if (needDraw) draw();
  }

  /* ── Click on empty space: create + activate a new zone under the cursor ── */
  function onSVGClick() {
    if (dragging !== null || ghostArcIdx < 0 || !ghostPoint) return;
    var cs  = window.CircleState;
    var arc = cs.arcs[ghostArcIdx];
    if (!arc || arc.created) return;

    var idx    = ghostArcIdx;
    var center = angleOf(ghostPoint.x, ghostPoint.y);
    var half   = fitHalfSpanAt(center, NEW_ARC_HALF_SPAN, MIN_HALF_SPAN, idx);
    if (half === null) return; // nessuno spazio disponibile qui

    arc.left       = norm(center - half);
    arc.right      = norm(center + half);
    arc.height     = 0;
    arc.heightMode = 'hemisphere';
    arc.active     = true;
    arc.created    = true;

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
      left:  arc.left,
      right: arc.right,
      span:  arcSpan(arc.left, arc.right),
      cent:  centroidAngle(arc.left, arc.right),
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
      var centRad = toRad(snap.cent);
      var dx = sp.x - CX, dy = sp.y - CY;
      var proj    = dx * Math.sin(centRad) + dy * (-Math.cos(centRad));
      /* Inverse of sqrt mapping: t² * 359.5 recovers span */
      var t       = Math.max(0.005, proj / (R * 0.92));
      var newSpan = Math.max(1, Math.min(359.5, t * t * 359.5));
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
    draw();
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
  function openHandleEditor(handleType, arcIdx, screenX, screenY) {
    var existing = document.getElementById('circle-handle-editor');
    if (existing) existing.remove();

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

    var wrap = document.createElement('div');
    wrap.id = 'circle-handle-editor';
    wrap.innerHTML =
      '<span class="che-label">' + label + '</span>' +
      '<input class="che-input mono" type="number" min="' + minVal +
      '" max="' + maxVal + '" value="' + currentVal + '" autocomplete="off">';

    document.body.appendChild(wrap);
    var pw = wrap.offsetWidth, ph = wrap.offsetHeight;
    var vw = window.innerWidth,  vh = window.innerHeight;
    var x  = Math.min(screenX + 10, vw - pw - 10);
    var y  = screenY - ph - 10;
    if (y < 8) y = screenY + 14;
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
      if (isNaN(raw)) { dismiss(); return; }

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
      dismiss();
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  { applyValue(); e.preventDefault(); }
      if (e.key === 'Escape') { dismiss();    e.preventDefault(); }
    });
    input.addEventListener('blur', function () {
      setTimeout(applyValue, 60); // allow Enter keydown to fire first
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
    draw: draw,
    setModule: function (mod) { window.CircleState.module = mod; draw(); },
    getState:  function () { return window.CircleState; },
  };

  document.addEventListener('DOMContentLoaded', init);
})();
