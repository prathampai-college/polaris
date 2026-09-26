import { useEffect, useRef } from 'react';
import { PALETTE } from '../lib/tokens';

/**
 * Full-bleed survey grid of tick marks. Ticks near the cursor elongate into
 * crosshairs and tint cobalt→phosphor by proximity — a targeting-grid feel
 * for the hero backdrop. Plain distance falloff, no physics lib needed.
 */
export default function CrosshairField() {
  const ref = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const SPACING = 34;
    const RADIUS = 170;

    const resize = () => {
      c.width = c.clientWidth * dpr;
      c.height = c.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const move = (e: MouseEvent) => {
      const rect = c.getBoundingClientRect();
      mouse.current.x = e.clientX - rect.left;
      mouse.current.y = e.clientY - rect.top;
    };
    const leave = () => { mouse.current.x = -9999; mouse.current.y = -9999; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseleave', leave);

    const draw = () => {
      const w = c.clientWidth, h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const { x: mx, y: my } = mouse.current;

      for (let x = SPACING / 2; x < w; x += SPACING) {
        for (let y = SPACING / 2; y < h; y += SPACING) {
          const d = Math.hypot(x - mx, y - my);
          const t = Math.max(0, 1 - d / RADIUS);
          const len = 3 + t * 9;
          const color = t > 0.55 ? PALETTE.phosphor : PALETTE.cobalt;
          ctx.strokeStyle = t > 0.02 ? color : PALETTE.structure;
          ctx.globalAlpha = t > 0.02 ? 0.35 + t * 0.65 : 0.14;
          ctx.lineWidth = t > 0.4 ? 1.4 : 1;
          ctx.beginPath();
          ctx.moveTo(x - len, y); ctx.lineTo(x + len, y);
          ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      if (mx > -100) {
        ctx.strokeStyle = PALETTE.cobalt;
        ctx.globalAlpha = 0.5;
        ctx.beginPath(); ctx.arc(mx, my, 22, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseleave', leave);
    };
  }, []);

  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
