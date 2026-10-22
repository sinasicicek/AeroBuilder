import { jsPDF } from 'jspdf';
import type { AircraftDimensions, AircraftMetrics, AircraftType, AirfoilType, AirfoilSpec, ControlSurfaces, ValidationCheck } from './calculations';
import { aileronOutline, type Layout } from './geometry';
import { getAirfoil, airfoilSegment, airfoilNaturalPct, splitAirfoilSpec } from './airfoils';
import type { BalanceResult } from './components';

type Pt = [number, number];

interface Shape {
  pts: Pt[];
  closed: boolean;
  dash?: boolean;
  color?: [number, number, number];
  width?: number;
}
interface Label { text: string; x: number; y: number; size?: number; color?: [number, number, number] }
interface Part { title: string; shapes: Shape[]; labels: Label[]; w: number; h: number }

/**
 * Builds a part drawing normalised so its bounding box starts at (0,0).
 * Coordinates are in millimetres.
 */
function makePart(title: string, shapes: Shape[], labels: Label[]): Part {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  shapes.forEach(s => s.pts.forEach(([x, y]) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }));
  const shift = ([x, y]: Pt): Pt => [x - minX, y - minY];
  return {
    title,
    shapes: shapes.map(s => ({ ...s, pts: s.pts.map(shift) })),
    labels: labels.map(l => ({ ...l, x: l.x - minX, y: l.y - minY })),
    w: maxX - minX,
    h: maxY - minY,
  };
}

export async function exportToPDF(
  dims: AircraftDimensions,
  metrics: AircraftMetrics,
  checks: ValidationCheck[],
  unit: 'cm' | 'mm',
  lang: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
  L: Layout,
  controls: ControlSurfaces,
  aircraftType: AircraftType,
  airfoil: AirfoilSpec = 'clarky',
  balance: BalanceResult | null = null,
): Promise<void> {
  const isFW = aircraftType === 'flying_wing';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const fmt = (n: number, d = 1) => `${n.toFixed(unit === 'mm' ? 0 : d)} ${unit}`;

  // ==========================================
  // PAGE 1: OVERVIEW & METRICS
  // ==========================================
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('AeroBuilder', 15, 22);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  doc.text(t('pdf_title'), 15, 30);
  doc.text(`${new Date().toLocaleDateString(lang)}`, 195, 22, { align: 'right' });
  const afInfo = splitAirfoilSpec(airfoil);
  const afLabel = `${t('airfoil_' + afInfo.type)} · ${(afInfo.pct ?? airfoilNaturalPct(afInfo.type as AirfoilType)).toFixed(1)}%`;
  doc.text(`${t(isFW ? 'preset_flying_wing' : 'preset_conventional')} · ${afLabel}`, 195, 30, { align: 'right' });
  doc.setDrawColor(220, 220, 220);
  doc.line(15, 35, 195, 35);

  let y = 40;
  const tableHeader = (a: string, b: string) => {
    doc.setFillColor(37, 99, 235);
    doc.rect(15, y, 180, 7, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text(a, 17, y + 5);
    doc.text(b, 117, y + 5);
    y += 7;
    doc.setFont('helvetica', 'normal');
  };
  const tableRows = (rows: { label: string; value: string }[]) => {
    rows.forEach((row, i) => {
      if (i % 2 === 0) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, y, 180, 6.5, 'F');
      }
      doc.setTextColor(0, 0, 0);
      doc.text(row.label, 17, y + 4.6);
      doc.text(row.value, 117, y + 4.6);
      y += 6.5;
    });
  };

  tableHeader(t('pdf_parameter'), t('pdf_value'));
  const rows = [
    { label: t('wing_area'), value: `${metrics.wingArea.toFixed(0)} ${unit}²` },
    { label: t('mac'), value: fmt(metrics.mac) },
    { label: isFW ? t('cg_position_fw', { sm: metrics.staticMargin.toFixed(0) }) : t('cg_position', { pct: (metrics.cgFraction * 100).toFixed(0) }), value: `${fmt(metrics.cgPosition)} ${t('cg_from_le')}` },
    { label: t('neutral_point'), value: `${fmt(metrics.neutralPoint)} ${t('cg_from_le')}` },
    { label: t('static_margin'), value: `${metrics.staticMargin.toFixed(1)} %` },
    { label: t('aspect_ratio'), value: `${metrics.aspectRatio.toFixed(2)}` },
  ];
  if (!isFW) {
    rows.push(
      { label: t('tail_moment_arm'), value: fmt(metrics.tailMomentArm) },
      { label: t('hstab_area'), value: `${metrics.hStabArea.toFixed(0)} ${unit}²` },
      { label: t('vstab_area'), value: `${metrics.vStabArea.toFixed(0)} ${unit}²` },
      { label: t('chart_vbar_label'), value: `${metrics.tailVolumeCoefficient.toFixed(3)}` },
    );
  }
  tableRows(rows);

  // Control surfaces table
  y += 5;
  tableHeader(t('control_surfaces_title'), t('pdf_dimensions'));
  const semi = dims.wingspan / 2;
  const chordAt = (f: number) => dims.rootChord + (dims.tipChord - dims.rootChord) * f;
  const f0 = controls.aileronStart / 100, f1 = controls.aileronEnd / 100;
  const csRows = [
    {
      label: `${t(isFW ? 'elevons' : 'ailerons')} (2×)`,
      value: `${fmt(semi * (f1 - f0))} × ${fmt(chordAt(f0) * controls.aileronChord / 100)} > ${fmt(chordAt(f1) * controls.aileronChord / 100)}  ·  ${(metrics.aileronAreaRatio * 100).toFixed(1)}%`,
    },
    {
      label: '   ' + t('pdf_pos_semispan'),
      value: `${controls.aileronStart.toFixed(0)}%  >  ${controls.aileronEnd.toFixed(0)}%  (${fmt(semi * f0)}  >  ${fmt(semi * f1)})`,
    },
  ];
  if (!isFW) {
    csRows.push(
      { label: t('elevator'), value: `${fmt(dims.hStabSpan)} × ${fmt(dims.hStabChord * controls.elevatorChord / 100)}  ·  ${controls.elevatorChord.toFixed(0)}%` },
      { label: t('rudder'), value: `${fmt(dims.vStabSpan)} × ${fmt(dims.vStabChord * controls.rudderChord / 100)}  ·  ${controls.rudderChord.toFixed(0)}%` },
    );
  }
  tableRows(csRows);

  // Analysis
  y += 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0, 0, 0);
  doc.text(t('analysis'), 15, y);
  y += 6;
  if (checks.length === 0) {
    doc.setTextColor(34, 197, 94);
    doc.setFont('helvetica', 'normal');
    doc.text(t('status_stable'), 15, y);
    y += 8;
  } else {
    checks.forEach(check => {
      if (y > 260) return;
      if (check.level === 'unstable') doc.setFillColor(239, 68, 68);
      else doc.setFillColor(245, 158, 11);
      doc.rect(15, y - 2, 3, 3, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(0, 0, 0);
      const msgLines = doc.splitTextToSize(t(check.messageKey), 170);
      doc.text(msgLines, 20, y);
      y += msgLines.length * 4;
      if (check.fixKey) {
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        const fixLines = doc.splitTextToSize(`-> ${t(check.fixKey)}`, 165);
        doc.text(fixLines, 23, y);
        y += fixLines.length * 3.5 + 2;
      } else {
        y += 2;
      }
    });
  }

  if (y < 255) {
    y += 6;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(t('pdf_formulas'), 15, y);
    y += 6;
    doc.setFont('courier', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(50, 50, 50);
    const formulas = isFW
      ? [
        'MAC = (2/3) x Cr x (1 + L + L^2) / (1 + L)',
        'NP  = MAC_LE + 25% MAC   (MAC at its span station; M. Hepperle)',
        `CG  = NP - SM x MAC = MAC_LE + ${(metrics.cgFraction * 100).toFixed(0)}% MAC   (SM = ${metrics.staticMargin.toFixed(0)} %)`,
      ]
      : [
        'MAC  = (2/3) x Cr x (1 + L + L^2) / (1 + L)',
        'NP   = AC_wing + lt x (St/Sw) x eta x (1 - de/da)',
        'SM   = (NP - CG) / MAC x 100 %',
        'Vbar = (St x lt) / (Sw x MAC)',
        'eta = 0.90  |  de/da = 2 x CLa / (pi x AR)  |  CLa = 2pi x AR / (2 + sqrt(AR^2 + 4))',
      ];
    formulas.forEach(f => { doc.text(f, 15, y); y += 4; });
    doc.setFont('helvetica', 'normal');
  }

  doc.setFontSize(7);
  doc.setTextColor(150);
  doc.text('AeroBuilder — aerobuilder-calc.netlify.app', 105, 290, { align: 'center' });

  // ==========================================
  // PAGE 2: WEIGHT & BALANCE
  // ==========================================
  if (balance) {
    doc.addPage();
    y = 22;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(t('mb_title'), 15, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    const bat = balance.items.find(i => i.id === 'battery')!;
    const leMm = L.wing.leS * L.toCm * 10;
    const summary = [
      `${t('mb_auw')}: ${Math.round(balance.auw)} g   ·   ${balance.wingLoading.toFixed(1)} g/dm²`,
      `${t('mb_battery')}: ${balance.battery.label} (${balance.battery.mass} g) — ${t('mb_battery_pos')}: ${Math.round(bat.s - bat.size![2] / 2)} mm ${t('mb_battery_front')} ${L.isFW ? t('mb_from_root_le') : t('mb_from_firewall')}`,
      t('mb_cg_line', { target: Math.round(balance.cgTarget - leMm), achieved: Math.round(balance.cgAchieved - leMm) }),
      `${t('mb_servos')}: ${balance.servo.label}`,
    ];
    summary.forEach(line => { doc.text(doc.splitTextToSize(line, 180), 15, y); y += 5.5; });
    y += 3;
    tableHeader(t('mb_breakdown'), t('pdf_mass_station'));
    const mbRows = balance.items.map(i => ({
      label: `${t(i.labelKey)}${i.detail ? ' — ' + i.detail : ''}`.slice(0, 60),
      value: `${i.mass.toFixed(0)} g   @ ${Math.round(i.s)} mm`,
    }));
    doc.setFontSize(8);
    tableRows(mbRows);
    y += 4;
    if (balance.linkages.length) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(t('mb_pushrods'), 15, y);
      doc.setFont('helvetica', 'normal');
      y += 5;
      balance.linkages.forEach(l => { doc.text(`${t('mb_' + l.id)}: ${l.length} mm`, 17, y); y += 4.5; });
    }
    if (balance.warnings.length) {
      y += 3;
      doc.setTextColor(180, 83, 9);
      balance.warnings.forEach(w => {
        const lines = doc.splitTextToSize('! ' + t(w.key, w.params), 180);
        doc.text(lines, 15, y); y += lines.length * 4 + 1;
      });
    }
    doc.setFontSize(7);
    doc.setTextColor(130, 130, 130);
    doc.text(doc.splitTextToSize(t('mb_note'), 180), 15, 285);
  }

  // ==========================================
  // PAGES 2+: 1:1 TEMPLATES
  // ==========================================
  const mm = unit === 'cm' ? 10 : 1;
  const w = L.wing;
  const wingAf = getAirfoil(airfoil);
  const BLUE: [number, number, number] = [2, 132, 199];
  const AMBER: [number, number, number] = [234, 88, 12];
  const RED: [number, number, number] = [220, 38, 38];
  const parts: Part[] = [];

  // 1. Right half wing (root on the left). X = span, Y = chord-wise from root LE.
  {
    const le0 = w.leAt(0);
    const P = (x: number, s: number): Pt => [x * mm, (s - le0) * mm];
    const outline: Pt[] = [P(0, w.leAt(0)), P(w.halfSpan, w.leAt(1)), P(w.halfSpan, w.teAt(1))];
    if (L.teCut) {
      const fc = L.teCut.halfWidth / w.halfSpan;
      outline.push(P(L.teCut.halfWidth, w.teAt(fc)), P(L.teCut.halfWidth, L.teCut.sCut), P(0, L.teCut.sCut));
    } else {
      outline.push(P(0, w.teAt(0)));
    }
    const ail = aileronOutline(L).map(([x, s]) => P(x, s));
    const hingeLine: Pt[] = [ail[0], ail[1]];
    const cg = P(0, L.cgS);
    parts.push(makePart(
      t('pdf_right_half', { cs: t(isFW ? 'elevons' : 'ailerons') }),
      [
        { pts: outline, closed: true, color: BLUE, width: 0.5 },
        { pts: ail, closed: true, dash: true, color: AMBER, width: 0.4 },
        { pts: hingeLine, closed: false, color: AMBER, width: 0.6 },
        { pts: [[cg[0] - 4, cg[1]], [cg[0] + 12, cg[1]]], closed: false, color: RED, width: 0.6 },
      ],
      [
        { text: `CG (${fmt(metrics.cgPosition)})`, x: cg[0] + 14, y: cg[1] + 1, color: RED },
        { text: `${t('root_chord')}: ${fmt(w.rootChord)}`, x: 2, y: outline[outline.length - 1][1] + 5 },
        { text: `${t('tip_chord')}: ${fmt(w.tipChord)}`, x: outline[1][0] - 40, y: outline[2][1] + 5 },
        { text: `${t('wingspan')}/2: ${fmt(w.halfSpan)}`, x: outline[1][0] / 2 - 15, y: -3 },
        { text: `${t(isFW ? 'elevons' : 'ailerons')}: ${controls.aileronStart.toFixed(0)}% > ${controls.aileronEnd.toFixed(0)}%, ${controls.aileronChord.toFixed(0)}%`, x: ail[0][0], y: ail[0][1] - 2, color: AMBER },
      ],
    ));
  }

  // 2. Wing ribs (root and tip airfoils, full size)
  {
    const ribs: Shape[] = [];
    const labels: Label[] = [];
    const root = airfoilSegment(wingAf, 0, 1, 60).map(([cx, ty]) => [cx * w.rootChord * mm, -ty * w.rootChord * mm] as Pt);
    const gap = Math.max(w.rootChord * mm * 0.18, 15);
    const tip = airfoilSegment(wingAf, 0, 1, 60).map(([cx, ty]) => [cx * w.tipChord * mm, gap - ty * w.tipChord * mm] as Pt);
    ribs.push({ pts: root, closed: true, width: 0.4 });
    ribs.push({ pts: tip, closed: true, width: 0.4 });
    const hingeX = (1 - L.aileron.chordFrac);
    ribs.push({ pts: [[hingeX * w.rootChord * mm, -wingAf.upper(hingeX) * w.rootChord * mm - 3], [hingeX * w.rootChord * mm, -wingAf.lower(hingeX) * w.rootChord * mm + 3]], closed: false, dash: true, color: AMBER });
    labels.push({ text: t('pdf_root_rib', { c: fmt(w.rootChord) }), x: 0, y: -wingAf.thickness * w.rootChord * mm - 4 });
    labels.push({ text: t('pdf_tip_rib', { c: fmt(w.tipChord) }), x: 0, y: gap - wingAf.thickness * w.tipChord * mm - 4 });
    parts.push(makePart(t('pdf_airfoils'), ribs, labels));
  }

  // 3. Horizontal stabiliser (half) + elevator
  if (L.hStab) {
    const h = L.hStab;
    const P = (x: number, s: number): Pt => [x * mm, (s - h.leS) * mm];
    const hs = h.span / 2;
    const hinge = h.leS + h.rootChord * (1 - h.hingeFrac);
    parts.push(makePart(
      t('pdf_half_hstab'),
      [
        { pts: [P(0, h.leS), P(hs, h.leS), P(hs, h.leS + h.rootChord), P(0, h.leS + h.rootChord)], closed: true, color: [219, 39, 119], width: 0.5 },
        ...(h.hingeFrac > 0 ? [{ pts: [P(0, hinge), P(hs, hinge)], closed: false, dash: true, color: AMBER, width: 0.5 } as Shape] : []),
      ],
      [{ text: `${t('hstab_span')}: ${fmt(h.span)} · ${t('elevator')}: ${fmt(h.rootChord * h.hingeFrac)}`, x: 2, y: -3 }],
    ));
  }

  // 4. Fin + rudder / winglet
  if (L.fin) {
    const f = L.fin;
    const P = (s: number, z: number): Pt => [(s - f.leS) * mm, -z * mm];
    const hinge = f.leS + f.rootChord * (1 - f.hingeFrac);
    parts.push(makePart(
      t('pdf_vstab'),
      [
        { pts: [P(f.leS, 0), P(f.leS + f.sweep, f.span), P(f.leS + f.sweep + f.tipChord, f.span), P(f.leS + f.rootChord, 0)], closed: true, color: [202, 138, 4], width: 0.5 },
        ...(f.hingeFrac > 0 ? [{ pts: [P(hinge, 0), P(hinge, f.span)], closed: false, dash: true, color: AMBER, width: 0.5 } as Shape] : []),
      ],
      [{ text: `${t('vstab_span')}: ${fmt(f.span)} · ${t('rudder')}: ${fmt(f.rootChord * f.hingeFrac)}`, x: 2, y: -f.span * mm - 3 }],
    ));
  }
  if (L.winglet && L.winglet.span > 0) {
    const g = L.winglet;
    const P = (s: number, z: number): Pt => [(s - g.leS) * mm, -z * mm];
    parts.push(makePart(
      t('pdf_winglet'),
      [{ pts: [P(g.leS, 0), P(g.leS + g.sweep, g.span), P(g.leS + g.sweep + g.tipChord, g.span), P(g.leS + g.rootChord, 0)], closed: true, color: [202, 138, 4], width: 0.5 }],
      [{ text: `${t('winglet_span')}: ${fmt(g.span)} · ${t('winglet_chord')}: ${fmt(g.rootChord)}`, x: 2, y: -g.span * mm - 3 }],
    ));
  }

  // 5. Fuselage side profile + top outline
  if (L.fuselage) {
    const fz = L.fuselage;
    const n = 50;
    const sideTop: Pt[] = [], sideBot: Pt[] = [], planR: Pt[] = [], planL: Pt[] = [];
    const planOffset = (fz.height / 2 + fz.width / 2) * mm + 25;
    for (let i = 0; i <= n; i++) {
      const s = (i / n) * fz.length;
      const sec = fz.section(s);
      sideTop.push([s * mm, -(sec.yc + sec.h / 2) * mm]);
      sideBot.unshift([s * mm, -(sec.yc - sec.h / 2) * mm]);
      planR.push([s * mm, planOffset + (sec.w / 2) * mm]);
      planL.unshift([s * mm, planOffset - (sec.w / 2) * mm]);
    }
    const wingMark: Pt[] = [[w.leS * mm, -w.mountY * mm], [(w.leS + w.rootChord) * mm, -w.mountY * mm]];
    parts.push(makePart(
      t('pdf_fuselage'),
      [
        { pts: [...sideTop, ...sideBot], closed: true, width: 0.5 },
        { pts: [...planR, ...planL], closed: true, width: 0.5 },
        { pts: wingMark, closed: false, color: BLUE, width: 0.8 },
        { pts: [[L.cgS * mm, -(w.mountY) * mm - 6], [L.cgS * mm, -(w.mountY) * mm + 6]], closed: false, color: RED, width: 0.6 },
      ],
      [
        { text: `${t('total_length')}: ${fmt(fz.length)} · ${t('fuselage_width')}: ${fmt(fz.width)} · ${t('fuselage_height')}: ${fmt(fz.height)}`, x: 0, y: -(fz.height) * mm - 4 },
        { text: 'CG', x: L.cgS * mm + 2, y: -(w.mountY) * mm - 7, color: RED },
      ],
    ));
  }

  // ── Page geometry ──
  const PW = 210, PH = 297;
  const MX = 12, MT = 24, MB = 12;            // margins (printers can't print to the edge)
  const areaW = PW - 2 * MX, areaH = PH - MT - MB;
  const OVERLAP = 10;
  const stepX = areaW - OVERLAP, stepY = areaH - OVERLAP;
  const TITLE = 8, SPACING = 14;

  // Long parts are turned to portrait so they need fewer sheets
  const oriented = parts.map(p => {
    if (p.w <= areaW || p.h >= p.w) return p;
    const rot = ([x, yy]: Pt): Pt => [p.h - yy, x];
    return {
      ...p,
      shapes: p.shapes.map(sh => ({ ...sh, pts: sh.pts.map(rot) })),
      labels: p.labels.map(l => { const [x, yy] = rot([l.x, l.y]); return { ...l, x, y: yy }; }),
      w: p.h,
      h: p.w,
    };
  });

  // A "page plan" is a list of parts placed at (ox, oy) inside one tiled region
  interface Placed { p: Part; ox: number; oy: number }
  interface Region { items: Placed[]; w: number; h: number; name: string }
  const regions: Region[] = [];

  // Parts that fit on one sheet are shelf-packed together
  const small = oriented.filter(p => p.w <= areaW && p.h + TITLE <= areaH);
  const big = oriented.filter(p => !small.includes(p));
  let cur: Region | null = null;
  let shelfX = 0, shelfY = 0, shelfH = 0;
  small.sort((a, bb) => bb.h - a.h).forEach(p => {
    const need = p.h + TITLE;
    if (!cur) { cur = { items: [], w: areaW, h: areaH, name: '' }; regions.push(cur); shelfX = 0; shelfY = 0; shelfH = 0; }
    if (shelfX + p.w > areaW) { shelfX = 0; shelfY += shelfH + SPACING; shelfH = 0; }
    if (shelfY + need > areaH) {
      cur = { items: [], w: areaW, h: areaH, name: '' }; regions.push(cur);
      shelfX = 0; shelfY = 0; shelfH = 0;
    }
    cur.items.push({ p, ox: shelfX, oy: shelfY + TITLE });
    shelfX += p.w + SPACING;
    shelfH = Math.max(shelfH, need);
  });
  big.forEach(p => regions.push({ items: [{ p, ox: 0, oy: TITLE }], w: p.w, h: p.h + TITLE, name: p.title }));

  // Enumerate the tiles that actually contain something
  interface Tile { region: Region; r: number; c: number; rows: number; cols: number; offX: number; offY: number }
  const tiles: Tile[] = [];
  // Liang–Barsky: does segment (x0,y0)-(x1,y1) cross the tile rectangle?
  // (tx0,ty0)-(tx1,ty1) is the part of the tile not already printed on the previous sheet
  const segHitsTile = (x0: number, y0: number, x1: number, y1: number, tx0: number, ty0: number, tx1: number, ty1: number) => {
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const edges: [number, number][] = [[-dx, x0 - tx0], [dx, tx1 - x0], [-dy, y0 - ty0], [dy, ty1 - y0]];
    for (const [pp, q] of edges) {
      if (pp === 0) { if (q < 0) return false; continue; }
      const r = q / pp;
      if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
      else { if (r < t0) return false; if (r < t1) t1 = r; }
    }
    return true;
  };
  regions.forEach(region => {
    const cols = Math.max(1, Math.ceil((region.w - OVERLAP) / stepX));
    const rows = Math.max(1, Math.ceil((region.h - OVERLAP) / stepY));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const offX = c * stepX, offY = r * stepY;
        const used = region.items.some(({ p, ox, oy }) => p.shapes.some(sh => sh.pts.some((q, i) => {
          const n = sh.pts[(i + 1) % sh.pts.length];
          return segHitsTile(ox + q[0], oy + q[1], ox + n[0], oy + n[1],
            offX + (c > 0 ? OVERLAP : 0), offY + (r > 0 ? OVERLAP : 0), offX + areaW, offY + areaH);
        })));
        if (used) tiles.push({ region, r, c, rows, cols, offX, offY });
      }
    }
  });

  tiles.forEach((tile, idx) => {
    doc.addPage();
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(t('pdf_template_title'), MX, 10);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const pos = tile.rows * tile.cols > 1
      ? t('pdf_tile_pos', { name: tile.region.name, r: tile.r + 1, rows: tile.rows, c: tile.c + 1, cols: tile.cols })
      : '';
    doc.text(`${t('pdf_sheet')} ${idx + 1}/${tiles.length}${pos}`, MX, 15);
    doc.text(
      `${t('pdf_print100')} ${tile.rows * tile.cols > 1 ? t('pdf_overlap', { mm: OVERLAP }) : ''}`,
      MX, 19.5,
    );

    // Registration crosses at the corners of the drawing area
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.2);
    const cross = (x: number, yy: number) => { doc.line(x - 4, yy, x + 4, yy); doc.line(x, yy - 4, x, yy + 4); };
    cross(MX + OVERLAP / 2, MT + OVERLAP / 2);
    cross(MX + areaW - OVERLAP / 2, MT + OVERLAP / 2);
    cross(MX + OVERLAP / 2, MT + areaH - OVERLAP / 2);
    cross(MX + areaW - OVERLAP / 2, MT + areaH - OVERLAP / 2);
    doc.setDrawColor(215, 215, 215);
    doc.rect(MX, MT, areaW, areaH);

    const X = (x: number) => MX + x - tile.offX;
    const Y = (yy: number) => MT + yy - tile.offY;

    doc.saveGraphicsState();
    doc.rect(MX, MT, areaW, areaH, null);
    doc.clip();
    doc.discardPath();

    tile.region.items.forEach(({ p, ox, oy }) => {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text(p.title, X(ox), Y(oy - 3));
      doc.setFont('helvetica', 'normal');
      p.shapes.forEach(sh => {
        const col = sh.color ?? [0, 0, 0];
        doc.setDrawColor(col[0], col[1], col[2]);
        doc.setLineWidth(sh.width ?? 0.35);
        doc.setLineDashPattern(sh.dash ? [2, 1.5] : [], 0);
        const pts = sh.pts;
        for (let i = 0; i < pts.length - 1; i++) {
          doc.line(X(ox + pts[i][0]), Y(oy + pts[i][1]), X(ox + pts[i + 1][0]), Y(oy + pts[i + 1][1]));
        }
        if (sh.closed && pts.length > 2) {
          const a2 = pts[pts.length - 1], b2 = pts[0];
          doc.line(X(ox + a2[0]), Y(oy + a2[1]), X(ox + b2[0]), Y(oy + b2[1]));
        }
        doc.setLineDashPattern([], 0);
      });
      doc.setFontSize(7);
      p.labels.forEach(l => {
        const col = l.color ?? [90, 90, 90];
        doc.setTextColor(col[0], col[1], col[2]);
        doc.text(l.text, X(ox + l.x), Y(oy + l.y));
      });
    });
    doc.restoreGraphicsState();

    // Scale check bar on every sheet
    doc.setDrawColor(0);
    doc.setLineWidth(0.4);
    const by = PH - 6;
    doc.line(PW - MX - 50, by, PW - MX, by);
    doc.line(PW - MX - 50, by - 2, PW - MX - 50, by + 2);
    doc.line(PW - MX, by - 2, PW - MX, by + 2);
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(t('pdf_ruler'), PW - MX - 25, by - 2.5, { align: 'center' });
  });

  doc.save('aerobuilder-templates.pdf');
}
