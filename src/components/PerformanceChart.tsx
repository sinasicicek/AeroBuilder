import { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { AircraftMetrics, AircraftType } from '../utils/calculations';
import { SM_RANGE } from '../utils/calculations';

interface PerformanceChartProps {
  metrics: AircraftMetrics;
  unit: 'cm' | 'mm';
  isDarkMode: boolean;
  aircraftType: AircraftType;
}

export default function PerformanceChart({ metrics, isDarkMode, aircraftType }: PerformanceChartProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const w = rect.width;
      const h = rect.height;

      ctx.clearRect(0, 0, w, h);

      // Title
      ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#111827';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(t('chart_title'), 10, 20);

      const PADDING_LEFT = 20;
      const PADDING_RIGHT = 60; // matches mini-bar right padding (space for value text)
      const BAR_X = PADDING_LEFT;
      const BAR_W = w - PADDING_LEFT - PADDING_RIGHT;

      // === Static Margin Horizontal Bar ===
      const SM_Y = 50;
      const SM_H = 20;
      const smValue = metrics.staticMargin;

      // Regions: < 5, 5-20, > 20
      // Let's map -10% to 40% SM across the bar (range 50)
      // The ideal zone always spans 30 %–60 % of the bar (the mini bars share
      // those columns); the scale adapts to the layout's comfortable range.
      const [smLo, smHi] = SM_RANGE[aircraftType];
      const SM_RANGE_W = (smHi - smLo) / 0.3;
      const SM_MIN = smLo - 0.3 * SM_RANGE_W;
      const SM_MAX = SM_MIN + SM_RANGE_W;
      const smToX = (sm: number) => {
        const clamped = Math.max(SM_MIN, Math.min(SM_MAX, sm));
        return BAR_X + ((clamped - SM_MIN) / (SM_MAX - SM_MIN)) * BAR_W;
      };
      // x5 and x20 mark the ideal zone boundaries — shared with mini bars
      // idealLeftFrac = (5 - SM_MIN) / (SM_MAX - SM_MIN) = 15/50 = 0.30
      // idealRightFrac = (20 - SM_MIN) / (SM_MAX - SM_MIN) = 30/50 = 0.60

      const x5 = smToX(smLo);
      const x20 = smToX(smHi);

      // Draw Unstable (Red)
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(BAR_X, SM_Y, x5 - BAR_X, SM_H);

      // Draw Ideal (Green)
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(x5, SM_Y, x20 - x5, SM_H);

      // Draw Sluggish (Amber)
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(x20, SM_Y, (BAR_X + BAR_W) - x20, SM_H);

      // SM Labels
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('chart_unstable'), BAR_X + (x5 - BAR_X) / 2, SM_Y + 14);
      ctx.fillText(t('chart_ideal'), x5 + (x20 - x5) / 2, SM_Y + 14);
      ctx.fillText(t('chart_sluggish'), x20 + ((BAR_X + BAR_W) - x20) / 2, SM_Y + 14);

      // SM Marker
      const smMarkerX = smToX(smValue);
      ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#ffffff' : '#000000';
      ctx.beginPath();
      ctx.moveTo(smMarkerX, SM_Y - 5);
      ctx.lineTo(smMarkerX - 5, SM_Y - 15);
      ctx.lineTo(smMarkerX + 5, SM_Y - 15);
      ctx.fill();

      ctx.fillStyle = document.documentElement.classList.contains('dark') ? '#e5e7eb' : '#111827';
      ctx.fillText(`${t('chart_sm_label')}: ${smValue.toFixed(1)}%`, smMarkerX, SM_Y - 18);

      // === Mini Horizontal Bars ===
      const barMetrics =
        aircraftType === 'flying_wing'
          ? [
              {
                labelKey: 'chart_sweep_ratio',
                value: metrics.sweepRatio ?? 0,
                min: 0, max: 1,
                idealMin: 0.15, idealMax: 0.45,
              },
              {
                labelKey: 'chart_taper_ratio',
                value: metrics.taperRatio ?? 0,
                min: 0, max: 1,
                idealMin: 0.25, idealMax: 0.55,
              },
              {
                labelKey: 'chart_ar_label',
                value: metrics.aspectRatio,
                min: 0, max: 12,
                idealMin: 4.0, idealMax: 7.0,
              },
            ]
          : [
              {
                labelKey: 'chart_vbar_label',
                value: metrics.tailVolumeCoefficient,
                min: 0, max: 0.8,
                idealMin: 0.35, idealMax: 0.55,
              },
              {
                labelKey: 'chart_hstab_label',
                value: metrics.hStabArea / metrics.wingArea,
                min: 0, max: 0.5,
                idealMin: 0.15, idealMax: 0.30,
              },
              {
                labelKey: 'chart_ar_label',
                value: metrics.aspectRatio,
                min: 0, max: 12,
                idealMin: 4.5, idealMax: 8.0,
              },
            ];

      const rowHeight = 32;
      const barHeight = 12;
      const labelFontSize = 11;
      const valueFontSize = 11;
      // Mini bars share the same BAR_X / BAR_W as the SM bar (same left+right padding)
      const barTop = (rowIndex: number) => 90 + rowIndex * rowHeight + labelFontSize + 4;

      barMetrics.forEach((m, i) => {
        // Calibrate mini bar so idealMin → x5 and idealMax → x20 (same columns as SM bar)
        // Linear mapping: value → x using the ideal zone as anchor
        const idealSpan = m.idealMax - m.idealMin;
        const IDEAL_FRAC = 0.30; // (x20 - x5) / BAR_W = 15/50
        const LEFT_FRAC  = 0.30; // x5 position from left = 15/50
        const totalRange = idealSpan / IDEAL_FRAC;
        const adjustedMin = m.idealMin - LEFT_FRAC * totalRange;
        const metricToX = (v: number) => {
          const clamped = Math.max(adjustedMin, Math.min(adjustedMin + totalRange, v));
          return BAR_X + ((clamped - adjustedMin) / totalRange) * BAR_W;
        };

        // 1. Draw label
        ctx.font = `${labelFontSize}px sans-serif`;
        ctx.fillStyle = isDarkMode ? '#d1d5db' : '#374151';
        ctx.textAlign = 'left';
        ctx.fillText(t(m.labelKey), BAR_X, 90 + i * rowHeight + labelFontSize);

        // 2. Draw background bar (same width as SM bar)
        ctx.fillStyle = isDarkMode ? '#374151' : '#e5e7eb';
        ctx.fillRect(BAR_X, barTop(i), BAR_W, barHeight);

        // 3. Draw value fill
        const fillWidth = Math.max(0, metricToX(m.value) - BAR_X);
        const inIdeal   = m.value >= m.idealMin && m.value <= m.idealMax;
        const nearIdeal = m.value >= m.idealMin * 0.7 && m.value <= m.idealMax * 1.3;
        const barColor  = inIdeal ? '#22c55e' : nearIdeal ? '#f59e0b' : '#ef4444';
        ctx.fillStyle = barColor;
        ctx.fillRect(BAR_X, barTop(i), fillWidth, barHeight);

        // 4. Dotted ideal-range lines — directly at x5 and x20 (shared with SM bar)
        ctx.strokeStyle = isDarkMode ? '#9ca3af' : '#6b7280';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x5, barTop(i) - 2);
        ctx.lineTo(x5, barTop(i) + barHeight + 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x20, barTop(i) - 2);
        ctx.lineTo(x20, barTop(i) + barHeight + 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // 5. Value text to the right of bar
        ctx.font = `${valueFontSize}px sans-serif`;
        ctx.fillStyle = barColor;
        ctx.textAlign = 'left';
        ctx.fillText(
          m.value.toFixed(2),
          BAR_X + BAR_W + 4,
          barTop(i) + barHeight / 2 + 4
        );
      });

    };

    draw();

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(draw);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [metrics, t, isDarkMode, aircraftType]);

  return (
    <div ref={containerRef} className="w-full" style={{ height: '220px' }}>
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
