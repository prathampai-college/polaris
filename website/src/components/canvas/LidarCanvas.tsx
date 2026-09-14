import { useEffect, useRef } from 'react';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof (ctx as any).roundRect === 'function') { ctx.beginPath(); (ctx as any).roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** 360-pt LiDAR sweep + Kalman fused dot. Whiteout shortens returns. */
export default function LidarCanvas({ whiteout }: { whiteout: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wref = useRef(whiteout); wref.current = whiteout;
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    let raf = 0; let ang = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener('resize', resize);
    const obstacles = [{ x: 12, y: -8 }, { x: -14, y: 10 }, { x: 6, y: 15 }, { x: -9, y: -12 }];
    const frame = () => {
      ang += 0.02;
      const white = wref.current;
      const w = c.clientWidth, h = c.clientHeight, cx = w / 2, cy = h / 2;
      ctx.fillStyle = '#060f1a'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(34,240,216,0.08)'; ctx.lineWidth = 1;
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath(); ctx.moveTo(cx + i * 22, 0); ctx.lineTo(cx + i * 22, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy + i * 22); ctx.lineTo(w, cy + i * 22); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      const maxR = Math.min(w, h) / 2 - 6;
      for (let r = 22; r < maxR; r += 22) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      obstacles.forEach((o) => {
        ctx.fillStyle = 'rgba(255,184,77,0.9)';
        rr(ctx, cx + o.x * 5 - 6, cy + o.y * 5 - 6, 12, 12, 2); ctx.fill();
      });
      for (let a = 0; a < 360; a += 5) {
        const rad = (a * Math.PI) / 180;
        let dist = Math.min(maxR - 4, 66 + 10 * Math.sin(a * 0.05 + ang * 2));
        const ox = Math.cos(rad) * dist, oy = Math.sin(rad) * dist;
        let hit = false;
        for (const o of obstacles) {
          if (Math.hypot(ox - o.x * 5, oy - o.y * 5) < 10) { dist = Math.hypot(o.x * 5, o.y * 5); hit = true; break; }
        }
        if (white && Math.random() < 0.22) dist *= 0.32;
        const x = cx + Math.cos(rad) * dist, y = cy + Math.sin(rad) * dist;
        ctx.fillStyle = hit ? 'rgba(255,184,77,0.95)' : white ? 'rgba(34,240,216,0.32)' : 'rgba(34,240,216,0.9)';
        ctx.beginPath(); ctx.arc(x, y, hit ? 2.1 : 1.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(34,240,216,0.9)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR); ctx.stroke();
      ctx.fillStyle = '#22f0d8'; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
      // fused target — smooth Lissajous drift
      const fx = cx + Math.cos(ang * 0.7) * 20, fy = cy + Math.sin(ang * 0.55) * 15;
      ctx.fillStyle = '#fff'; ctx.shadowColor = '#22f0d8'; ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(34,240,216,0.55)'; ctx.beginPath(); ctx.arc(fx, fy, 13 + 2 * Math.sin(ang), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = '9px JetBrains Mono';
      ctx.fillText(white ? 'CONF 0.75 • LIDAR SOLO' : 'CONF 0.79 • FUSED 70/30', 10, h - 10);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="h-[300px] w-full rounded-xl border border-white/10 bg-[#060f1a]" />;
}
