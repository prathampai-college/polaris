import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { ArrowUpRight, Cpu, Crosshair, Globe2, Layers, Pause, Play, ShieldCheck, Thermometer, Wind, Zap } from 'lucide-react';
import CrosshairField from '../components/CrosshairField';
import BurnChart from '../components/canvas/BurnChart';
import type { Station } from '../lib/data';
import { fmt } from '../lib/physics';

function useCountUp(target: number) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    const from = cur.current;
    if (from === target) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 600);
      const eased = 1 - Math.pow(1 - p, 3);
      const val = from + (target - from) * eased;
      cur.current = val;
      setV(Math.round(val));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

type Forecast = { physics: number; residual: number; total: number; days: number; lo: number; hi: number };

const heroContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.08 } },
};
const heroItem = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
};

export default function Hero({
  scrollYProgress, stationIdx, st, f, temp, wind, critical, snnActive, setSnnActive, playing, setPlaying,
}: {
  scrollYProgress: MotionValue<number>;
  stationIdx: number;
  st: Station;
  f: Forecast;
  temp: number;
  wind: number;
  critical: boolean;
  snnActive: boolean;
  setSnnActive: (v: boolean | ((v: boolean) => boolean)) => void;
  playing: boolean;
  setPlaying: (v: boolean | ((v: boolean) => boolean)) => void;
}) {
  const heroY = useTransform(scrollYProgress, [0, 0.16], [0, -50]);
  const daysCount = useCountUp(Math.round(f.days));

  return (
    <motion.div style={{ y: heroY }} className="relative overflow-hidden border-b border-structure">
      <div className="tickgrid absolute inset-0 opacity-70" />
      <CrosshairField />
      <div className="relative mx-auto max-w-[1280px] px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14">
        <motion.div variants={heroContainer} initial="hidden" animate="show" className="grid items-start gap-8 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <motion.div variants={heroItem} className="inline-flex items-center gap-2 border border-structure bg-surface px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] text-ink">
              <Crosshair size={12} className="text-cobalt" /> Supporting Bharati · Maitri · Himadri
              <span className="hidden bg-ink px-2.5 py-0.5 font-semibold tracking-normal text-canvas sm:inline-flex">Built for Antarctica</span>
            </motion.div>
            <motion.h1 variants={heroItem} className="mt-5 font-display leading-[0.88] tracking-[-0.04em] text-ink">
              <span className="block text-[44px] font-[400] sm:text-[64px] lg:text-[78px]">Survival</span>
              <span className="block text-[44px] font-[400] italic text-ink/80 sm:text-[64px] lg:text-[78px]">is a logistics</span>
              <span className="block text-[44px] font-[400] sm:text-[64px] lg:text-[78px]">problem<span className="text-cobalt">.</span></span>
            </motion.h1>
            <motion.p variants={heroItem} className="mt-4 max-w-[60ch] text-[15px] leading-6 text-slate">
              At −40°C, months of isolation and Iridium links that drop for hours, routine logistics becomes critical infrastructure. POLARIS runs inventory, forecasting and resupply coordination continuously — with or without a connection.
            </motion.p>
            <motion.div variants={heroItem} className="mt-6 flex flex-wrap gap-3">
              <a href="#live-ops" className="inline-flex items-center gap-2 border border-structure bg-cobalt px-5 py-3 text-sm font-semibold text-white hover:bg-structure">Explore capabilities <ArrowUpRight size={14} /></a>
              <a href="#pillars" className="inline-flex items-center gap-2 border border-structure bg-surface px-5 py-3 text-sm font-semibold text-ink hover:bg-structure hover:text-canvas">How it works</a>
              <button onClick={() => setPlaying((p) => !p)} className="inline-flex items-center gap-2 border border-structure px-4 py-3 font-mono text-sm text-slate hover:text-ink">
                {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Resume'} simulation
              </button>
            </motion.div>
            <motion.div variants={heroItem} className="mt-7 grid max-w-[560px] grid-cols-3 gap-3">
              {[
                { k: 'DATA EFFICIENCY', v: '95.6%', sub: 'reduced sync payload', Icon: Layers },
                { k: 'ENERGY USE', v: '0.8 mW', sub: 'on-device inference', Icon: Cpu },
                { k: 'POSITION ACCURACY', v: '<0.8 m', sub: 'without GPS', Icon: Crosshair },
              ].map((s) => (
                <div key={s.k} className="border border-structure bg-surface p-3">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-slate"><s.Icon size={12} />{s.k}</div>
                  <div className="mt-1 text-[18px] font-black tracking-tight text-ink">{s.v}</div>
                  <div className="text-[11px] leading-tight text-slate">{s.sub}</div>
                </div>
              ))}
            </motion.div>
            <motion.div variants={heroItem} className="mt-6 flex items-center gap-2 font-mono text-xs text-slate">
              <ShieldCheck size={14} className="text-cobalt" /> Runs without continuous connectivity — built for winter-over deployment
            </motion.div>
          </div>

          <motion.div variants={heroItem} className="lg:col-span-5">
            <div className="relative overflow-hidden border border-structure bg-surface shadow-panel">
              <div className="relative p-4 sm:p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-slate"><Globe2 size={12} /> POLAR VIEW · {st.name.toUpperCase()}</div>
                  <span className="bg-ink px-2 py-1 text-[10px] font-semibold text-canvas">{st.coord}</span>
                </div>
                <div className="relative mt-3 overflow-hidden border border-structure bg-canvas">
                  <svg viewBox="0 0 400 260" className="h-[210px] w-full">
                    <circle cx="200" cy="130" r="96" fill="none" stroke="rgba(16,25,40,0.14)" strokeWidth="1" />
                    <circle cx="200" cy="130" r="68" fill="none" stroke="rgba(16,25,40,0.1)" />
                    <circle cx="200" cy="130" r="36" fill="none" stroke="rgba(16,25,40,0.1)" />
                    <g stroke="rgba(16,25,40,0.08)">{Array.from({ length: 12 }).map((_, i) => <line key={i} x1="200" y1="130" x2={200 + Math.cos((i * Math.PI) / 6) * 96} y2={130 + Math.sin((i * Math.PI) / 6) * 96} />)}</g>
                    <path d="M140 150 Q180 110 220 130 Q260 150 240 190 Q200 210 160 190 Q130 170 140 150 Z" fill="rgba(16,25,40,0.04)" stroke="rgba(0,71,255,0.3)" />
                    {[{ x: 238, y: 148, label: 'Bharati', on: stationIdx === 0 }, { x: 168, y: 118, label: 'Maitri', on: stationIdx === 1 }, { x: 200, y: 54, label: 'Himadri', on: stationIdx === 2 }].map((p) => (
                      <g key={p.label} opacity={p.on ? 1 : 0.5}>
                        <circle cx={p.x} cy={p.y} r="13" fill={p.on ? 'rgba(0,71,255,0.14)' : 'rgba(16,25,40,0.05)'} />
                        <circle cx={p.x} cy={p.y} r="6" fill={p.on ? '#0047FF' : '#5B6776'} stroke="#101928" strokeWidth="1" />
                        {p.on && <circle cx={p.x} cy={p.y} r="10" fill="none" stroke="#0047FF" opacity="0.5"><animate attributeName="r" values="8;15;8" dur="2.2s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.5;0;0.5" dur="2.2s" repeatCount="indefinite" /></circle>}
                        <text x={p.x} y={p.y - 17} textAnchor="middle" fontSize="7" fontFamily="JetBrains Mono" fill="#101928" opacity="0.9">{p.label}</text>
                      </g>
                    ))}
                    <g>
                      <path d="M78 92 L92 88 L94 96 L80 100 Z" fill="#FF4800" stroke="#101928" strokeWidth="0.6" />
                      <text x="86" y="84" textAnchor="middle" fontSize="6" fontFamily="JetBrains Mono" fill="#FF4800">SAGAR NIDHI</text>
                      <path d="M94 96 Q140 108 168 118" fill="none" stroke="#FF4800" strokeDasharray="3 3" opacity="0.6" />
                    </g>
                  </svg>
                  <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                    <span className="bg-ink px-2 py-1 text-[10px] font-semibold text-canvas">Resupply · ETA 14h</span>
                    <span className="font-mono text-[10px] text-slate">Seasonal route</span>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
                  <div className="bg-ink p-3 text-canvas">
                    <div className="font-mono text-[10px] tracking-[0.12em] text-canvas/60">ESTIMATED COVERAGE</div>
                    <div className="mt-1 text-[28px] font-black leading-none">{daysCount}<span className="text-sm font-medium text-canvas/70"> days</span></div>
                    <div className="text-[11px] text-canvas/60">{fmt(f.lo, 0)}–{fmt(f.hi, 0)} days · {fmt(f.total)} L/day</div>
                  </div>
                  <div className="border border-structure bg-surface p-3">
                    <div className="font-mono text-[10px] text-slate">CONSUMPTION MODEL</div>
                    <div className="mt-1 font-mono text-xs text-ink">base {fmt(f.physics)}</div>
                    <div className="font-mono text-xs text-cobalt">+ adjustment {fmt(f.residual)}</div>
                    <div className="mt-1 text-[11px] text-slate">= {fmt(f.total)} L/day</div>
                  </div>
                  <div className="border border-cobalt bg-cobalt/[0.06] p-3">
                    <div className="font-mono text-[10px] text-cobalt">FORECAST MODE</div>
                    <button onClick={() => setSnnActive((v) => !v)} className={`mt-1 inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold ${snnActive ? 'bg-ink text-canvas' : 'border border-structure text-ink'}`}>
                      <Zap size={12} />{snnActive ? 'Adaptive' : 'Conservative'}
                    </button>
                    <div className="mt-1 text-[11px] text-slate">Adjusts to conditions</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                  <span className="inline-flex items-center gap-1 border border-structure px-2 py-1 text-slate"><Thermometer size={12} />{temp}°C</span>
                  <span className="inline-flex items-center gap-1 border border-structure px-2 py-1 text-slate"><Wind size={12} />{wind} m/s</span>
                  <span className={`ml-auto px-3 py-1 text-xs font-semibold ${critical ? 'bg-flare text-white' : 'border border-structure text-ink'}`}>{critical ? 'Attention required' : 'Within expected range'}</span>
                </div>
                <div className="mt-3"><BurnChart temp={temp} wind={wind} critical={critical} /></div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
              <div className="border border-structure bg-surface px-3 py-2 text-slate">Offline-capable</div>
              <div className="border border-structure bg-surface px-3 py-2 text-slate">Field-tested interface</div>
              <div className="border border-structure bg-surface px-3 py-2 text-slate">Extended operations</div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  );
}
