import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AirfoilSpec } from '../utils/calculations';
import { aileronOutline, isHighWing, type Layout } from '../utils/geometry';
import { getAirfoil, airfoilSegment } from '../utils/airfoils';
import { COMPONENT_COLORS, ASSEMBLY_COLORS, type BalanceResult } from '../utils/components';

interface CanvasViewProps {
  layout: Layout;
  isDarkMode: boolean;
  airfoil: AirfoilSpec;
  balance?: BalanceResult | null;
}

type Pt = [number, number];

export default function CanvasView({ layout: L, isDarkMode, airfoil, balance }: CanvasViewProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const C = {
      grid: isDarkMode ? '#374151' : '#e5e7eb',
      fuseFill: isDarkMode ? '#4b5563' : '#f3f4f6',
      fuseStroke: isDarkMode ? '#9ca3af' : '#6b7280',
      wingFill: isDarkMode ? '#0369a1' : '#e0f2fe',
      wingStroke: isDarkMode ? '#38bdf8' : '#0284c7',
      hFill: isDarkMode ? '#be185d' : '#fce7f3',
      hStroke: isDarkMode ? '#f472b6' : '#db2777',
      vFill: isDarkMode ? '#a16207' : '#fef08a',
      vStroke: isDarkMode ? '#fde047' : '#ca8a04',
      csFill: isDarkMode ? 'rgba(249,115,22,0.55)' : 'rgba(249,115,22,0.4)',
      csStroke: isDarkMode ? '#fb923c' : '#ea580c',
      propFill: isDarkMode ? 'rgba(250,204,21,0.25)' : 'rgba(161,98,7,0.15)',
      propStroke: isDarkMode ? '#fbbf24' : '#92400e',
      motor: isDarkMode ? '#9ca3af' : '#4b5563',
      text: isDarkMode ? '#d1d5db' : '#374151',
      dim: isDarkMode ? '#9ca3af' : '#6b7280',
    };

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const b = L.bounds;
      const sLen = b.sMax - b.sMin;
      const span = b.xMax * 2;
      const yLen = Math.max(b.yMax - b.yMin, span * 0.05);

      const PAD = 36, GAP = 48, LABEL = 22;
      const availW = cw - PAD * 2;
      const availH = ch - PAD * 2;

      // Arrangement A: three views stacked. Arrangement B: top view left, side/front right.
      const scaleA = Math.min(availW / Math.max(span, sLen), (availH - 2 * GAP - 3 * LABEL) / (sLen + 2 * yLen));
      const scaleB = Math.min(
        (availW - GAP) / (span + Math.max(sLen, span)),
        Math.min((availH - LABEL) / sLen, (availH - GAP - 2 * LABEL) / (2 * yLen)),
      );
      const useB = scaleB > scaleA * 1.15;
      const k = Math.max(useB ? scaleB : scaleA, 0.0001);

      // View origins (screen position of each view's reference point)
      let topO: Pt, sideO: Pt, frontO: Pt;
      if (!useB) {
        const cx = cw / 2;
        topO = [cx, PAD + LABEL - b.sMin * k];
        const sideTop = PAD + LABEL + sLen * k + GAP + LABEL;
        sideO = [cx - (sLen * k) / 2 - b.sMin * k, sideTop + b.yMax * k];
        const frontTop = sideTop + yLen * k + GAP + LABEL;
        frontO = [cx, frontTop + b.yMax * k];
      } else {
        const leftW = span * k;
        topO = [PAD + leftW / 2, PAD + LABEL - b.sMin * k];
        const rightX = PAD + leftW + GAP;
        const rightW = cw - PAD - rightX;
        sideO = [rightX + (rightW - sLen * k) / 2 - b.sMin * k, PAD + LABEL + b.yMax * k];
        frontO = [rightX + rightW / 2, PAD + LABEL + yLen * k + GAP + LABEL + b.yMax * k];
      }

      // Projections
      const top = (x: number, s: number): Pt => [topO[0] + x * k, topO[1] + s * k];
      const side = (s: number, y: number): Pt => [sideO[0] + s * k, sideO[1] - y * k];
      const front = (x: number, y: number): Pt => [frontO[0] + x * k, frontO[1] - y * k];

      const poly = (pts: Pt[], fill?: string, stroke?: string, lw = 1.5, dash?: number[]) => {
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) {
          ctx.strokeStyle = stroke; ctx.lineWidth = lw;
          ctx.setLineDash(dash ?? []); ctx.stroke(); ctx.setLineDash([]);
        }
      };
      const mirror = (pts: [number, number][]): [number, number][] => pts.map(([x, s]) => [-x, s]);

      const w = L.wing;
      const wingAf = getAirfoil(airfoil);
      const tailAf = getAirfoil('sym_tail');

      // ─────────────── TOP VIEW ───────────────
      // Centre line
      ctx.beginPath();
      const [clx, cly0] = top(0, b.sMin);
      const [, cly1] = top(0, b.sMax);
      ctx.moveTo(clx, cly0); ctx.lineTo(clx, cly1);
      ctx.strokeStyle = C.grid; ctx.setLineDash([5, 5]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);

      // Wing (drawn first; fuselage on top of it for a high wing looks wrong, so wing last for trainer)
      const wingHalf: [number, number][] = [[0, w.leAt(0)], [w.halfSpan, w.leAt(1)], [w.halfSpan, w.teAt(1)]];
      if (L.teCut) {
        const fc = L.teCut.halfWidth / w.halfSpan;
        wingHalf.push([L.teCut.halfWidth, w.teAt(fc)], [L.teCut.halfWidth, L.teCut.sCut], [0, L.teCut.sCut]);
      } else {
        wingHalf.push([0, w.teAt(0)]);
      }
      const drawWingTop = () => {
        poly([...wingHalf, ...mirror(wingHalf).reverse()].map(([x, s]) => top(x, s)), C.wingFill, C.wingStroke, 2);
        const ail = aileronOutline(L);
        poly(ail.map(([x, s]) => top(x, s)), C.csFill, C.csStroke, 1.2);
        poly(mirror(ail).map(([x, s]) => top(x, s)), C.csFill, C.csStroke, 1.2);
      };

      const drawFuselageTop = () => {
        if (!L.fuselage) return;
        const fz = L.fuselage;
        const n = 40;
        const right: Pt[] = [];
        const left: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const s = (i / n) * fz.length;
          const sec = fz.section(s);
          right.push(top(sec.w / 2, s));
          left.unshift(top(-sec.w / 2, s));
        }
        poly([...right, ...left], C.fuseFill, C.fuseStroke, 2);
      };

      const drawTailTop = () => {
        if (L.hStab) {
          const h = L.hStab;
          // V-tail: seen from above only the projected span shows
          const hs = (h.span / 2) * Math.cos(h.rollRad ?? 0);
          poly([top(-hs, h.leS), top(hs, h.leS), top(hs, h.leS + h.rootChord), top(-hs, h.leS + h.rootChord)], C.hFill, C.hStroke, 2);
          if (h.hingeFrac > 0) {
            const hy = h.leS + h.rootChord * (1 - h.hingeFrac);
            poly([top(-hs, hy), top(hs, hy), top(hs, h.leS + h.rootChord), top(-hs, h.leS + h.rootChord)], C.csFill, C.csStroke, 1.2);
          }
        }
        if (L.fin) {
          const f = L.fin;
          const tw = Math.max(f.rootChord * 0.08, 0.3 * (1 / L.toCm)) / 2;
          poly([top(-tw, f.leS), top(tw, f.leS), top(tw, f.leS + f.rootChord), top(-tw, f.leS + f.rootChord)], C.vFill, C.vStroke, 1.2);
        }
        if (L.winglet && L.winglet.span > 0) {
          const g = L.winglet;
          const tw = Math.max(g.rootChord * 0.08, 0.2 * (1 / L.toCm)) / 2;
          [1, -1].forEach(sgn => {
            const x = sgn * w.halfSpan;
            poly([top(x - tw, g.leS), top(x + tw, g.leS), top(x + tw, g.leS + g.rootChord), top(x - tw, g.leS + g.rootChord)], C.vFill, C.vStroke, 1.2);
          });
        }
      };

      const drawPowerTop = () => {
        const m = L.motor, p = L.prop;
        const s0 = m.mountS, s1 = m.mountS + m.dir * m.length;
        poly([top(-m.diameter / 2, s0), top(m.diameter / 2, s0), top(m.diameter / 2, s1), top(-m.diameter / 2, s1)], C.motor, C.motor, 1);
        // The propeller disc is perpendicular to the flight path: seen edge-on from above
        const half = p.diameter / 2;
        const th = Math.max(p.diameter * 0.03, 2 / k);
        poly([top(-half, p.s - th / 2), top(half, p.s - th / 2), top(half, p.s + th / 2), top(-half, p.s + th / 2)], C.propFill, C.propStroke, 1.2);
        ctx.font = '10px sans-serif'; ctx.fillStyle = C.propStroke;
        const [lx, ly] = top(half, p.s);
        ctx.fillText(`${p.label}″ (${t(m.pusher ? 'el_pusher' : 'el_puller')})`, lx + 6, ly + 3);
      };

      if (L.fuselage && isHighWing(L.fuselage.style)) {
        drawFuselageTop(); drawTailTop(); drawWingTop();
      } else {
        drawWingTop(); drawTailTop(); drawFuselageTop();
      }
      drawPowerTop();

      // Onboard components (x-ray): boxes + pushrods
      const mmU = L.toCm * 10; // mm per layout unit
      const drawComponents = (proj: 'top' | 'side') => {
        if (!balance) return;
        balance.items.forEach(it => {
          const col = COMPONENT_COLORS[it.kind];
          if (!col) return;
          if (it.kind === 'ballast') {
            const [px, py] = proj === 'top' ? top(it.x / mmU, it.s / mmU) : side(it.s / mmU, it.y / mmU);
            ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
            return;
          }
          if (!it.size) return;
          const [sx, sy, ss] = it.size.map(v => v / mmU);
          const x = it.x / mmU, y = it.y / mmU, st = it.s / mmU;
          const pts: Pt[] = proj === 'top'
            ? [top(x - sx / 2, st - ss / 2), top(x + sx / 2, st - ss / 2), top(x + sx / 2, st + ss / 2), top(x - sx / 2, st + ss / 2)]
            : [side(st - ss / 2, y - sy / 2), side(st + ss / 2, y - sy / 2), side(st + ss / 2, y + sy / 2), side(st - ss / 2, y + sy / 2)];
          poly(pts, col + 'b0', col, 1);
        });
        // Carbon spars (dashed) and printed servo mounts
        ctx.save();
        ctx.setLineDash([6, 3]);
        ctx.strokeStyle = isDarkMode ? '#94a3b8' : '#1e293b';
        balance.sparLines.forEach(sp => {
          ctx.lineWidth = Math.max(1, (sp.d / mmU) * k);
          (sp.mirror ? [1, -1] : [1]).forEach(sg => {
            const a = proj === 'top' ? top(sg * sp.a[0] / mmU, sp.a[2] / mmU) : side(sp.a[2] / mmU, sp.a[1] / mmU);
            const b2 = proj === 'top' ? top(sg * sp.b[0] / mmU, sp.b[2] / mmU) : side(sp.b[2] / mmU, sp.b[1] / mmU);
            ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
          });
        });
        ctx.restore();
        balance.mounts.forEach(m => {
          const us = m.outline.map(p => p[0]), vs = m.outline.map(p => p[1]);
          const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
          const [ox, oy, os] = m.origin.map(v => v / mmU);
          const T = m.t / mmU;
          let pts: Pt[];
          if (m.normal === 'span') {
            pts = proj === 'top'
              ? [top(ox - T / 2, os + u0 / mmU), top(ox + T / 2, os + u0 / mmU), top(ox + T / 2, os + u1 / mmU), top(ox - T / 2, os + u1 / mmU)]
              : [side(os + u0 / mmU, oy + v0 / mmU), side(os + u1 / mmU, oy + v0 / mmU), side(os + u1 / mmU, oy + v1 / mmU), side(os + u0 / mmU, oy + v1 / mmU)];
          } else {
            pts = proj === 'top'
              ? [top(ox + u0 / mmU, os + v0 / mmU), top(ox + u1 / mmU, os + v0 / mmU), top(ox + u1 / mmU, os + v1 / mmU), top(ox + u0 / mmU, os + v1 / mmU)]
              : [side(os + v0 / mmU, oy - T / 2), side(os + v1 / mmU, oy - T / 2), side(os + v1 / mmU, oy + T / 2), side(os + v0 / mmU, oy + T / 2)];
          }
          poly(pts, isDarkMode ? '#cbd5e1aa' : '#cbd5e1cc', isDarkMode ? '#e2e8f0' : '#64748b', 1);
        });
        // ── Joints: wing joiner (dashed outline), dowels and rubber bands ──
        const asm = balance.assembly;
        {
          const j = asm.joiner;
          const X = j.halfLen / mmU, sa = j.sa / mmU, sb = j.sb / mmU;
          if (proj === 'top') {
            poly([top(-X, sa), top(X, sa), top(X, sb), top(-X, sb)], ASSEMBLY_COLORS.joiner + '55', ASSEMBLY_COLORS.joiner, 1.5, [4, 2]);
          } else {
            const yl = w.mountY + wingAf.lower(((sa + sb) / 2 - w.leS) / w.rootChord) * w.rootChord;
            poly([side(sa, yl), side(sb, yl), side(sb, yl + j.t / mmU), side(sa, yl + j.t / mmU)], ASSEMBLY_COLORS.joiner, ASSEMBLY_COLORS.joiner, 1.5);
          }
        }
        if (asm.bands) {
          ctx.save();
          ctx.strokeStyle = ASSEMBLY_COLORS.band; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.9;
          asm.bands.paths.forEach(p => {
            const pts = p.pts.map(([x, y, s]) => (proj === 'top' ? top(x / mmU, s / mmU) : side(s / mmU, y / mmU)));
            ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
            pts.slice(1).forEach(([px, py]) => ctx.lineTo(px, py));
            ctx.stroke();
          });
          ctx.restore();
        }
        asm.dowels.forEach(d => {
          if (proj === 'top') {
            const r = d.d / 2 / mmU, hl = d.len / 2 / mmU, st = d.s / mmU;
            poly([top(-hl, st - r), top(hl, st - r), top(hl, st + r), top(-hl, st + r)], ASSEMBLY_COLORS.dowel, ASSEMBLY_COLORS.dowel, 1);
          } else {
            const [px, py] = side(d.s / mmU, d.y / mmU);
            ctx.beginPath(); ctx.arc(px, py, Math.max(2.5, (d.d / 2 / mmU) * k), 0, Math.PI * 2);
            ctx.fillStyle = ASSEMBLY_COLORS.dowel; ctx.fill();
          }
        });
        // Tail pushrods: guide tube and the holes to drill
        balance.linkExits.forEach(ex2 => {
          const pts = [ex2.through, ex2.skin].filter((p): p is [number, number, number] => !!p)
            .map(p => (proj === 'top' ? top(p[0] / mmU, p[2] / mmU) : side(p[2] / mmU, p[1] / mmU)));
          if (pts.length === 2) {
            ctx.save(); ctx.strokeStyle = ASSEMBLY_COLORS.guide; ctx.lineWidth = 3.5; ctx.globalAlpha = 0.6;
            ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); ctx.lineTo(pts[1][0], pts[1][1]); ctx.stroke(); ctx.restore();
          }
          pts.forEach(([px, py]) => {
            ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2);
            ctx.strokeStyle = ASSEMBLY_COLORS.drill; ctx.lineWidth = 1.8; ctx.stroke();
          });
        });
        ctx.strokeStyle = isDarkMode ? '#e5e7eb' : '#111827';
        ctx.lineWidth = 1;
        balance.linkages.forEach(l => {
          const a = proj === 'top' ? top(l.from[0] / mmU, l.from[2] / mmU) : side(l.from[2] / mmU, l.from[1] / mmU);
          const b2 = proj === 'top' ? top(l.to[0] / mmU, l.to[2] / mmU) : side(l.to[2] / mmU, l.to[1] / mmU);
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
          ctx.beginPath(); ctx.arc(b2[0], b2[1], 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        });
      };
      drawComponents('top');

      // CG / NP
      const [cgx, cgy] = top(0, L.cgS);
      drawCG(ctx, cgx, cgy, 6, isDarkMode);
      const [npx, npy] = top(0, L.npS);
      drawNP(ctx, npx, npy, 6, isDarkMode);

      // Wingspan dimension line
      {
        const yDim = top(0, b.sMin)[1] - 10;
        const [x0] = top(-w.halfSpan, 0);
        const [x1] = top(w.halfSpan, 0);
        ctx.strokeStyle = C.dim; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x0, yDim); ctx.lineTo(x1, yDim);
        ctx.moveTo(x0, yDim - 4); ctx.lineTo(x0, yDim + 4); ctx.moveTo(x1, yDim - 4); ctx.lineTo(x1, yDim + 4);
        ctx.stroke();
        const unitLbl = L.unit;
        ctx.font = '10px sans-serif'; ctx.fillStyle = C.dim; ctx.textAlign = 'center';
        ctx.fillText(`${(w.halfSpan * 2).toFixed(L.unit === 'mm' ? 0 : 1)} ${unitLbl}`, (x0 + x1) / 2, yDim - 4);
        ctx.textAlign = 'left';
      }

      // ─────────────── SIDE VIEW ───────────────
      if (L.fuselage) {
        const fz = L.fuselage;
        const n = 40;
        const topLine: Pt[] = [];
        const bottom: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const s = (i / n) * fz.length;
          const sec = fz.section(s);
          topLine.push(side(s, sec.yc + sec.h / 2));
          bottom.unshift(side(s, sec.yc - sec.h / 2));
        }
        poly([...topLine, ...bottom], C.fuseFill, C.fuseStroke, 2);
      }

      // Wing root airfoil (to scale)
      const rootSec = airfoilSegment(wingAf, 0, 1, 40).map(([cx, ty]) => side(w.leAt(0) + cx * w.rootChord, w.mountY + ty * w.rootChord));
      poly(rootSec, C.wingFill, C.wingStroke, 1.5);
      // Tip airfoil outline (dashed) shows sweep + dihedral
      const tipSec = airfoilSegment(wingAf, 0, 1, 40).map(([cx, ty]) => side(w.leAt(1) + cx * w.tipChord, w.yAt(1) + ty * w.tipChord));
      poly(tipSec, undefined, C.wingStroke, 1, [3, 3]);

      if (L.hStab) {
        const h = L.hStab;
        const sec = airfoilSegment(tailAf, 0, 1, 30).map(([cx, ty]) => side(h.leS + cx * h.rootChord, h.y + ty * h.rootChord));
        poly(sec, C.hFill, C.hStroke, 1.5);
        if (h.hingeFrac > 0) {
          const e = airfoilSegment(tailAf, 1 - h.hingeFrac, 1, 12).map(([cx, ty]) => side(h.leS + cx * h.rootChord, h.y + ty * h.rootChord));
          poly(e, C.csFill, C.csStroke, 1);
        }
      }
      if (L.fin) {
        const f = L.fin;
        // Cruciform: ventral fin below the fuselage
        if (f.ventral && f.ventral > 0.001) {
          poly([side(f.leS, f.y - f.ventral), side(f.leS + f.rootChord, f.y - f.ventral), side(f.leS + f.rootChord, f.y), side(f.leS, f.y)], C.vFill, C.vStroke, 2);
        }
        const pts: Pt[] = [side(f.leS, f.y), side(f.leS + f.sweep, f.y + f.span), side(f.leS + f.sweep + f.tipChord, f.y + f.span), side(f.leS + f.rootChord, f.y)];
        poly(pts, C.vFill, C.vStroke, 2);
        if (f.hingeFrac > 0) {
          const hs = f.leS + f.rootChord * (1 - f.hingeFrac);
          poly([side(hs, f.y), side(hs, f.y + f.span), side(f.leS + f.rootChord, f.y + f.span), side(f.leS + f.rootChord, f.y)], C.csFill, C.csStroke, 1.2);
        }
      }
      if (L.winglet && L.winglet.span > 0) {
        const g = L.winglet;
        poly([side(g.leS, g.y), side(g.leS + g.sweep, g.y + g.span), side(g.leS + g.sweep + g.tipChord, g.y + g.span), side(g.leS + g.rootChord, g.y)], C.vFill, C.vStroke, 2);
      }
      {
        const m = L.motor, p = L.prop;
        const s0 = m.mountS, s1 = m.mountS + m.dir * m.length;
        poly([side(s0, p.y - m.diameter / 2), side(s1, p.y - m.diameter / 2), side(s1, p.y + m.diameter / 2), side(s0, p.y + m.diameter / 2)], C.motor, C.motor, 1);
        const th = Math.max(p.diameter * 0.03, 2 / k);
        poly([side(p.s - th / 2, p.y - p.diameter / 2), side(p.s + th / 2, p.y - p.diameter / 2), side(p.s + th / 2, p.y + p.diameter / 2), side(p.s - th / 2, p.y + p.diameter / 2)], C.propFill, C.propStroke, 1.2);
      }
      drawComponents('side');
      {
        const [x, y] = side(L.cgS, w.mountY);
        drawCG(ctx, x, y, 6, isDarkMode);
      }

      // ─────────────── FRONT VIEW ───────────────
      // Propeller disc (seen face-on)
      {
        const p = L.prop;
        const [px, py] = front(0, p.y);
        ctx.beginPath(); ctx.arc(px, py, (p.diameter / 2) * k, 0, Math.PI * 2);
        ctx.fillStyle = C.propFill; ctx.fill();
        ctx.strokeStyle = C.propStroke; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      }
      if (L.fuselage) {
        const fz = L.fuselage;
        // Largest section (under the wing)
        const sec = fz.section(w.leS + w.rootChord * 0.5);
        const expo = fz.expo;
        const pts: Pt[] = [];
        for (let i = 0; i < 48; i++) {
          const th = (2 * Math.PI * i) / 48;
          const c = Math.cos(th), s = Math.sin(th);
          pts.push(front((sec.w / 2) * Math.sign(c) * Math.abs(c) ** (2 / expo), sec.yc + (sec.h / 2) * Math.sign(s) * Math.abs(s) ** (2 / expo)));
        }
        poly(pts, C.fuseFill, C.fuseStroke, 2);
      }
      if (L.fin) {
        const f = L.fin;
        const tw = Math.max(f.rootChord * 0.08, 0.3 / L.toCm) / 2;
        if (f.ventral && f.ventral > 0.001) {
          poly([front(-tw, f.y - f.ventral), front(tw, f.y - f.ventral), front(tw, f.y), front(-tw, f.y)], C.vFill, C.vStroke, 1.2);
        }
        poly([front(-tw, f.y), front(tw, f.y), front(tw, f.y + f.span), front(-tw, f.y + f.span)], C.vFill, C.vStroke, 1.2);
      }
      if (L.hStab) {
        const h = L.hStab;
        const tw = Math.max(h.rootChord * 0.08, 0.3 / L.toCm) / 2;
        const roll = h.rollRad ?? 0;
        if (Math.abs(roll) > 1e-4) {
          // V-tail / inverted V: two slanted panels seen from the front
          const hx = (h.span / 2) * Math.cos(roll);
          const hy = (h.span / 2) * Math.sin(roll);
          [1, -1].forEach(sg => {
            poly(
              [front(0, h.y - tw), front(sg * hx, h.y + hy - tw), front(sg * hx, h.y + hy + tw), front(0, h.y + tw)],
              C.hFill, C.hStroke, 1.2,
            );
          });
        } else {
          poly([front(-h.span / 2, h.y - tw), front(h.span / 2, h.y - tw), front(h.span / 2, h.y + tw), front(-h.span / 2, h.y + tw)], C.hFill, C.hStroke, 1.2);
        }
      }
      {
        // Wing thickness envelope following the dihedral
        const upMax = Math.max(...[0.2, 0.3, 0.4].map(x => wingAf.upper(x)));
        const loMin = Math.min(...[0.2, 0.3, 0.4].map(x => wingAf.lower(x)));
        const rightW: Pt[] = [
          front(0, w.yAt(0) + upMax * w.chordAt(0)), front(w.halfSpan, w.yAt(1) + upMax * w.chordAt(1)),
          front(w.halfSpan, w.yAt(1) + loMin * w.chordAt(1)), front(0, w.yAt(0) + loMin * w.chordAt(0)),
        ];
        const leftW: Pt[] = rightW.map(([x, y]) => [2 * frontO[0] - x, y] as Pt);
        poly(rightW, C.wingFill, C.wingStroke, 1.5);
        poly(leftW, C.wingFill, C.wingStroke, 1.5);
      }
      if (L.winglet && L.winglet.span > 0) {
        const g = L.winglet;
        const tw = Math.max(g.rootChord * 0.08, 0.2 / L.toCm) / 2;
        [1, -1].forEach(sgn => {
          const x = sgn * w.halfSpan;
          poly([front(x - tw, g.y), front(x + tw, g.y), front(x + tw, g.y + g.span), front(x - tw, g.y + g.span)], C.vFill, C.vStroke, 1.2);
        });
      }
      {
        const m = L.motor;
        const [mx, my] = front(0, L.prop.y);
        ctx.beginPath(); ctx.arc(mx, my, (m.diameter / 2) * k, 0, Math.PI * 2);
        ctx.fillStyle = C.motor; ctx.fill();
      }

      // ─────────────── Labels & legend ───────────────
      ctx.font = '13px sans-serif';
      ctx.fillStyle = C.text;
      const label = (txt: string, x: number, y: number) => ctx.fillText(txt, x, y);
      if (!useB) {
        label(t('top_view'), PAD, PAD + 12);
        label(t('side_view'), PAD, sideO[1] - b.yMax * k - 10);
        label(t('front_view'), PAD, frontO[1] - b.yMax * k - 10);
      } else {
        label(t('top_view'), PAD, PAD + 12);
        const rightX = PAD + span * k + GAP;
        label(t('side_view'), rightX, PAD + 12);
        label(t('front_view'), rightX, frontO[1] - b.yMax * k - 10);
      }

      if (cw < 560) return; // compact screens: the legend would cover the drawing
      const hasBands = !!balance?.assembly.bands;
      const lx = 10, ly = ch - (balance ? 96 : 64);
      ctx.font = '11px sans-serif'; ctx.fillStyle = C.text;
      ctx.fillText(t('legend'), lx, ly);
      drawCG(ctx, lx + 6, ly + 14, 6, isDarkMode);
      ctx.fillStyle = C.text; ctx.font = '10px sans-serif';
      ctx.fillText('CG', lx + 16, ly + 18);
      drawNP(ctx, lx + 6, ly + 32, 6, isDarkMode);
      ctx.fillStyle = C.text;
      ctx.fillText('NP', lx + 16, ly + 36);
      ctx.fillStyle = C.csFill; ctx.fillRect(lx, ly + 44, 12, 10);
      ctx.strokeStyle = C.csStroke; ctx.strokeRect(lx, ly + 44, 12, 10);
      ctx.fillStyle = C.text;
      ctx.fillText(t(L.isFW ? 'elevons' : 'control_surfaces_short'), lx + 16, ly + 53);
      if (balance) {
        const chips: [string, string][] = [[COMPONENT_COLORS.servo!, t('mb_servos')], [COMPONENT_COLORS.battery!, t('mb_battery')], [COMPONENT_COLORS.esc!, 'ESC'], [COMPONENT_COLORS.rx!, 'RX']];
        let cx2 = lx;
        chips.forEach(([col, lbl]) => {
          ctx.fillStyle = col; ctx.fillRect(cx2, ly + 60, 10, 10);
          ctx.fillStyle = C.text; ctx.fillText(lbl, cx2 + 13, ly + 69);
          cx2 += 22 + ctx.measureText(lbl).width;
        });
        const chips2: [string, string][] = [[ASSEMBLY_COLORS.joiner, t('asm_joiner_short')]];
        if (hasBands) chips2.push([ASSEMBLY_COLORS.dowel, t('asm_dowels_short')], [ASSEMBLY_COLORS.band, t('asm_bands_short')]);
        if (balance.linkExits.length) chips2.push([ASSEMBLY_COLORS.drill, t('link_exit_short')]);
        cx2 = lx;
        chips2.forEach(([col, lbl]) => {
          ctx.fillStyle = col; ctx.fillRect(cx2, ly + 76, 10, 10);
          ctx.fillStyle = C.text; ctx.fillText(lbl, cx2 + 13, ly + 85);
          cx2 += 22 + ctx.measureText(lbl).width;
        });
      }
    };

    const ro = new ResizeObserver(() => draw());
    ro.observe(container);
    draw();
    return () => ro.disconnect();
  }, [L, t, isDarkMode, airfoil, balance]);

  return (
    <div ref={containerRef} className="w-full h-full absolute inset-0">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}

function drawCG(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, dark: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.strokeStyle = dark ? 'white' : 'black';
  ctx.lineWidth = 1;
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  const quad = (a0: number, a1: number, fill: string) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r, a0, a1); ctx.fill();
  };
  const fg = dark ? 'white' : 'black', bg = dark ? 'black' : 'white';
  quad(0, Math.PI / 2, fg); quad(Math.PI, Math.PI * 1.5, fg);
  quad(Math.PI / 2, Math.PI, bg); quad(Math.PI * 1.5, Math.PI * 2, bg);
  ctx.restore();
}

function drawNP(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dark: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.fillStyle = '#f97316';
  ctx.moveTo(0, size); ctx.lineTo(-size, -size); ctx.lineTo(size, -size); ctx.closePath(); ctx.fill();
  ctx.font = '10px sans-serif';
  ctx.fillStyle = dark ? '#d1d5db' : '#374151';
  ctx.fillText('NP', size + 4, size / 2);
  ctx.restore();
}
