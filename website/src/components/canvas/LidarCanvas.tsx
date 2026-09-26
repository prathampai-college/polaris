import { useEffect, useRef } from 'react';
import { PALETTE } from '../../lib/tokens';

/** 360-pt LiDAR sweep + fused dot. Whiteout shortens returns. */
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
      ctx.fillStyle = PALETTE.surface; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(16,25,40,0.08)'; ctx.lineWidth = 1;
      for (let i = -5; i <= 5; i++) {
        ctx.beginPath(); ctx.moveTo(cx + i * 22, 0); ctx.lineTo(cx + i * 22, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy + i * 22); ctx.lineTo(w, cy + i * 22); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(16,25,40,0.14)';
      const maxR = Math.min(w, h) / 2 - 6;
      for (let r = 22; r < maxR; r += 22) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
      obstacles.forEach((o) => {
        ctx.fillStyle = PALETTE.flare;
        ctx.fillRect(cx + o.x * 5 - 6, cy + o.y * 5 - 6, 12, 12);
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
        ctx.fillStyle = hit ? PALETTE.flare : white ? 'rgba(0,71,255,0.32)' : PALETTE.cobalt;
        ctx.beginPath(); ctx.arc(x, y, hit ? 2.1 : 1.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = PALETTE.cobalt; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR); ctx.stroke();
      ctx.fillStyle = PALETTE.ink; ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
      // fused target — smooth Lissajous drift
      const fx = cx + Math.cos(ang * 0.7) * 20, fy = cy + Math.sin(ang * 0.55) * 15;
      ctx.fillStyle = PALETTE.phosphor;
      ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,194,255,0.55)'; ctx.beginPath(); ctx.arc(fx, fy, 13 + 2 * Math.sin(ang), 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = PALETTE.slate; ctx.font = '9px JetBrains Mono';
      ctx.fillText(white ? 'CONF 0.75 · LIDAR SOLO' : 'CONF 0.79 · FUSED 70/30', 10, h - 10);
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="h-[300px] w-full border border-structure/20" />;
}
