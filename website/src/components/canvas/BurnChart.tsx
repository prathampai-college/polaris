import { useEffect, useRef } from 'react';
import { burnSeries } from '../../lib/physics';
import { PALETTE } from '../../lib/tokens';

/** 24h burn-rate spark chart, redrawn from live temp/wind (and on resize) */
export default function BurnChart({ temp, wind, critical }: { temp: number; wind: number; critical: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth, h = c.clientHeight;
      if (w === 0 || h === 0) return;
      c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const pts = burnSeries(temp, wind);
      const min = Math.min(...pts), max = Math.max(...pts);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(16,25,40,0.1)';
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke(); }
      const X = (i: number) => 8 + (i / (pts.length - 1)) * (w - 16);
      const Y = (v: number) => h - 14 - ((v - min) / Math.max(1, max - min)) * (h - 34);
      const lineColor = critical ? PALETTE.flare : PALETTE.cobalt;
      ctx.beginPath(); pts.forEach((p, i) => (i === 0 ? ctx.moveTo(X(i), Y(p)) : ctx.lineTo(X(i), Y(p))));
      ctx.strokeStyle = lineColor; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = PALETTE.ink; ctx.beginPath(); ctx.arc(X(6), Y(pts[6]), 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PALETTE.slate; ctx.font = '9px JetBrains Mono';
      ctx.fillText('00h', 8, h - 2); ctx.fillText('12h', w / 2 - 8, h - 2); ctx.fillText('24h', w - 24, h - 2);
      ctx.fillText(`${max.toFixed(0)} L/d`, 8, 12);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [temp, wind, critical]);
  return <canvas ref={ref} className="h-[120px] w-full" />;
}
