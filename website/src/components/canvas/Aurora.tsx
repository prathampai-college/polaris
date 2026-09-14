import { useEffect, useRef } from 'react';

/** Aurora bands + starfield */
export default function Aurora() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    let raf = 0; let t = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => { c.width = c.clientWidth * dpr; c.height = c.clientHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize(); window.addEventListener('resize', resize);
    const stars = Array.from({ length: 90 }, (_, i) => ({
      sx: (Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1),
      sy: (Math.abs(Math.sin(i * 78.233) * 43758.5453) % 1) * 0.5,
      r: i % 4 === 0 ? 1.3 : 0.7, p: Math.random() * Math.PI * 2,
    }));
    const draw = () => {
      t += 0.008;
      const w = c.clientWidth, h = c.clientHeight;
      ctx.clearRect(0, 0, w, h);
      const bands: [string, string][] = [['#00e5cc', '#0ea5e9'], ['#8b8eff', '#22f0d8'], ['#ffb84d', '#ff5a79']];
      bands.forEach(([a], i) => {
        const y0 = h * 0.16 + i * 30;
        const amp = 16 + i * 10;
        ctx.beginPath(); ctx.moveTo(0, y0);
        for (let x = 0; x <= w; x += 8) {
          const y = y0 + Math.sin(x * 0.006 * (0.6 + i * 0.25) + t * (0.9 + i * 0.3)) * amp + Math.cos(x * 0.003 + t * 0.5) * 6;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, y0 + 100); ctx.lineTo(0, y0 + 100); ctx.closePath();
        const g = ctx.createLinearGradient(0, y0, 0, y0 + 90);
        g.addColorStop(0, a + '55'); g.addColorStop(1, 'transparent');
        ctx.fillStyle = g; ctx.fill();
      });
      stars.forEach((s) => {
        ctx.globalAlpha = 0.3 + 0.7 * Math.abs(Math.sin(t * 1.4 + s.p));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(s.sx * w, s.sy * h, s.r, 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />;
}
