import { useEffect, useRef } from 'react';

/** Spiking LIF network 5→32→16→1. Active = dense spikes; idle = sparse. */
export default function SnnCanvas({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const aref = useRef(active); aref.current = active;
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    let raf = 0; let t = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener('resize', resize);
    const layers = [5, 12, 9, 1];
    let spikes = 0;
    const draw = () => {
      const on = aref.current;
      t += on ? 0.12 : 0.015;
      const w = c.clientWidth, h = c.clientHeight;
      ctx.fillStyle = '#060a14'; ctx.fillRect(0, 0, w, h);
      const gap = w / layers.length;
      const pos: { x: number; y: number }[][] = [];
      layers.forEach((n, li) => {
        const arr: { x: number; y: number }[] = [];
        const x = gap * 0.55 + li * gap;
        for (let i = 0; i < n; i++) {
          const y = h * 0.16 + (i + 0.5) * ((h * 0.66) / n);
          arr.push({ x, y });
          const firing = on && Math.random() < (li === 0 ? 0.5 : li === 1 ? 0.2 : li === 2 ? 0.26 : 0.7) && Math.sin(t + i * 0.7) > 0.1;
          if (firing) spikes++;
          ctx.fillStyle = firing ? '#22f0d8' : 'rgba(255,255,255,0.16)';
          if (firing) { ctx.shadowColor = '#22f0d8'; ctx.shadowBlur = 10; } else ctx.shadowBlur = 0;
          ctx.beginPath(); ctx.arc(x, y, firing ? 4.6 : 2.8, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
        pos.push(arr);
      });
      ctx.lineWidth = 1;
      for (let li = 0; li < pos.length - 1; li++) {
        pos[li].forEach((a) => {
          pos[li + 1].slice(0, 5).forEach((b) => {
            const alpha = on ? 0.16 + 0.18 * Math.abs(Math.sin(t * 1.2 + a.y * 0.02)) : 0.06;
            ctx.strokeStyle = `rgba(34,240,216,${alpha.toFixed(3)})`;
            ctx.beginPath(); ctx.moveTo(a.x + 4, a.y);
            ctx.bezierCurveTo(a.x + gap * 0.4, a.y, b.x - gap * 0.4, b.y, b.x - 4, b.y); ctx.stroke();
            if (on && Math.random() < 0.025) {
              const p = 0.5 + 0.5 * Math.sin(t * 3);
              ctx.fillStyle = '#ffb84d';
              ctx.beginPath(); ctx.arc(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, 2, 0, Math.PI * 2); ctx.fill();
            }
          });
        });
      }
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px JetBrains Mono';
      ctx.fillText('5 IN', gap * 0.55 - 14, h * 0.93);
      ctx.fillText('32 LIF', gap * 1.55 - 18, h * 0.93);
      ctx.fillText('16 LIF', gap * 2.55 - 18, h * 0.93);
      ctx.fillText('1 OUT', gap * 3.55 - 16, h * 0.93);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="h-[280px] w-full rounded-xl border border-white/10" />;
}
