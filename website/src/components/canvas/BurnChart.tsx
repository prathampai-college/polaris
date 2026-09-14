import { useEffect, useRef } from 'react';
import { burnSeries } from '../../lib/physics';

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
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0, (h / 4) * i); ctx.lineTo(w, (h / 4) * i); ctx.stroke(); }
      const X = (i: number) => 8 + (i / (pts.length - 1)) * (w - 16);
      const Y = (v: number) => h - 14 - ((v - min) / Math.max(1, max - min)) * (h - 34);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, critical ? 'rgba(255,90,90,0.5)' : 'rgba(34,240,216,0.45)');
      grad.addColorStop(1, 'transparent');
      ctx.beginPath(); ctx.moveTo(X(0), Y(pts[0]));
      pts.forEach((p, i) => ctx.lineTo(X(i), Y(p)));
      ctx.lineTo(X(pts.length - 1), h); ctx.lineTo(X(0), h); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath(); pts.forEach((p, i) => (i === 0 ? ctx.moveTo(X(i), Y(p)) : ctx.lineTo(X(i), Y(p))));
      ctx.strokeStyle = critical ? '#ff5a5a' : '#22f0d8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(X(6), Y(pts[6]), 3.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '9px JetBrains Mono';
      ctx.fillText('00h', 8, h - 2); ctx.fillText('12h', w / 2 - 8, h - 2); ctx.fillText('24h', w - 24, h - 2);
      ctx.fillText(`${max.toFixed(0)} L/d`, 8, 12);
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [temp, wind, critical]);
  return <canvas ref={ref} className="h-[120px] w-full" />;
}
