import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import * as animeModule from 'animejs';
const anime: any = (animeModule as any).default ?? animeModule;
import {
  Activity, Anchor, ArrowUpRight, Boxes, Cpu, Crosshair, Database,
  Globe2, Layers, Play, Pause, Satellite, ShieldCheck, Ship, Snowflake,
  Thermometer, Timer, Wind, Workflow, Zap, QrCode, ScanLine, Package, ClipboardList, MapPin,
} from 'lucide-react';
import Aurora from './components/canvas/Aurora';
import LidarCanvas from './components/canvas/LidarCanvas';
import SnnCanvas from './components/canvas/SnnCanvas';
import BurnChart from './components/canvas/BurnChart';
import DtnFlow from './components/DtnFlow';
import { Nav, SectionHead, Footer } from './components/chrome';
import { STATIONS, INVENTORY, VESSELS, API_ROUTES, TABS } from './lib/data';
import { thermoHybrid, fmt } from './lib/physics';

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

const statusColor = (s: string) =>
  s === 'CRITICAL' ? 'text-red-300' : s === 'LOW' ? 'text-amber-300' : s === 'EXPIRING' ? 'text-amber-200' : 'text-emerald-300';

export default function App() {
  const { scrollYProgress } = useScroll();
  const heroY = useTransform(scrollYProgress, [0, 0.16], [0, -70]);
  const heroScale = useTransform(scrollYProgress, [0, 0.16], [1, 0.975]);

  const [temp, setTemp] = useState(-22);
  const [wind, setWind] = useState(8);
  const [playing, setPlaying] = useState(true);
  const [whiteout, setWhiteout] = useState(false);
  const [snnActive, setSnnActive] = useState(true);
  const [bundled, setBundled] = useState(5);
  const [stationIdx, setStationIdx] = useState(0);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Today');
  const [apiQ, setApiQ] = useState('');
  const [apiSel, setApiSel] = useState(3);
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setWind((w) => Math.max(3, Math.min(26, w + (Math.random() - 0.5) * 2))), 1100);
    return () => clearInterval(id);
  }, [playing]);

  const st = STATIONS[stationIdx];
  const f = useMemo(() => thermoHybrid(temp, wind, snnActive, st.dieselL), [temp, wind, snnActive, st.dieselL]);
  const daysCount = useCountUp(Math.round(f.days));
  const critical = f.days < 20;

  useEffect(() => {
    anime({ targets: '.hero-kicker', translateY: [12, 0], opacity: [0, 1], duration: 700, easing: 'easeOutExpo', delay: 80 });
    anime({ targets: '.hero-title > span', translateY: [60, 0], opacity: [0, 1], duration: 900, easing: 'easeOutExpo', delay: anime.stagger(70, { start: 150 }) });
    anime({ targets: '.hero-card', translateY: [26, 0], opacity: [0, 1], duration: 900, easing: 'easeOutExpo', delay: 480 });
    anime({ targets: '.stat', scale: [0.9, 1], opacity: [0, 1], duration: 600, easing: 'easeOutExpo', delay: anime.stagger(80, { start: 700 }) });
  }, []);

  useEffect(() => {
    const el = glowRef.current; if (!el) return;
    const move = (e: MouseEvent) => { el.style.transform = `translate(${e.clientX - 260}px, ${e.clientY - 260}px)`; };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, []);

  const apiFiltered = API_ROUTES.filter((r) => (r.method + ' ' + r.path + ' ' + r.note).toLowerCase().includes(apiQ.toLowerCase()));

  return (
    <div id="top" className="min-h-screen bg-[#020a12] text-white selection:bg-cyan-500/30">
      <div className="pointer-events-none fixed inset-0 opacity-[0.035] mix-blend-soft-light"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")` }} />
      <div ref={glowRef} className="pointer-events-none fixed left-0 top-0 z-[5] hidden h-[520px] w-[520px] rounded-full opacity-[0.10] blur-3xl transition-transform duration-150 lg:block"
        style={{ background: 'radial-gradient(circle, #22f0d8 0%, transparent 65%)' }} />
      <motion.div className="fixed left-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-cyan-400 via-violet-400 to-amber-400" style={{ scaleX: scrollYProgress, width: '100%' }} />

      <Nav stationIdx={stationIdx} setStationIdx={setStationIdx} />

      {/* HERO */}
      <motion.div style={{ y: heroY, scale: heroScale }} className="relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-[#071a2e] via-[#020a12] to-[#020a12]" />
          <div className="absolute inset-0 opacity-40" style={{ background: 'radial-gradient(900px 600px at 20% 10%, rgba(34,240,216,0.16), transparent 60%), radial-gradient(800px 500px at 85% 15%, rgba(139,142,255,0.18), transparent 60%), radial-gradient(700px 400px at 60% 85%, rgba(255,184,77,0.10), transparent 60%)' }} />
          <Aurora />
          <div className="blueprint absolute inset-0 opacity-60" />
        </div>
        <div className="relative mx-auto max-w-[1280px] px-4 pb-8 pt-10 sm:px-6 sm:pb-10 sm:pt-14">
          <div className="grid items-start gap-8 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="hero-kicker inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 font-mono text-[11px] tracking-[0.12em] text-white/70 backdrop-blur">
                <Snowflake size={12} className="text-cyan-300" /> Supporting Bharati &middot; Maitri &middot; Himadri
                <span className="hidden rounded-full bg-white px-2.5 py-0.5 font-semibold tracking-normal text-black sm:inline-flex">Designed for Antarctica</span>
              </div>
              <h1 className="hero-title mt-5 font-display leading-[0.88] tracking-[-0.04em]">
                <span className="block text-[44px] font-[400] sm:text-[64px] lg:text-[78px]">Survival</span>
                <span className="block text-[44px] font-[400] italic text-white/90 sm:text-[64px] lg:text-[78px]">is a logistics</span>
                <span className="block text-[44px] font-[400] sm:text-[64px] lg:text-[78px]">problem<span className="text-cyan-300">.</span></span>
              </h1>
              <p className="mt-4 max-w-[60ch] text-[15px] leading-6 text-white/70">
                At &minus;40&deg;C with months of isolation and intermittent connectivity, routine logistics becomes critical infrastructure. POLARIS provides reliable inventory management, consumption forecasting and coordinated resupply — operating consistently where conventional systems cannot.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#live-ops" className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-black">Explore capabilities <ArrowUpRight size={14} /></a>
                <a href="#pillars" className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold backdrop-blur hover:bg-white/10">How it works</a>
                <button onClick={() => setPlaying((p) => !p)} className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-3 font-mono text-sm text-white/70">
                  {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : 'Resume'} simulation
                </button>
              </div>
              <div className="mt-7 grid max-w-[560px] grid-cols-3 gap-3">
                {[
                  { k: 'DATA EFFICIENCY', v: '95.6%', sub: 'reduced sync payload', Icon: Layers },
                  { k: 'ENERGY USE', v: '0.8 mW', sub: 'efficient on-device inference', Icon: Cpu },
                  { k: 'POSITION ACCURACY', v: '<0.8 m', sub: 'without reliance on GPS', Icon: Crosshair },
                ].map((s) => (
                  <div key={s.k} className="stat rounded-2xl border border-white/10 bg-white/[0.06] p-3 backdrop-blur">
                    <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-white/50"><s.Icon size={12} />{s.k}</div>
                    <div className="mt-1 text-[18px] font-black tracking-tight">{s.v}</div>
                    <div className="text-[11px] leading-tight text-white/50">{s.sub}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex items-center gap-2 font-mono text-xs text-white/50">
                <ShieldCheck size={14} className="text-emerald-400" /> Operates without continuous connectivity — built for extended deployment
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="hero-card relative overflow-hidden rounded-[24px] border border-white/10 bg-[#0a1a2e]/60 shadow-card backdrop-blur-xl">
                <div className="absolute inset-0 opacity-60" style={{ background: 'radial-gradient(600px 300px at 70% 0%, rgba(34,240,216,0.14), transparent 60%)' }} />
                <div className="relative p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-white/60"><Globe2 size={12} /> POLAR VIEW &middot; {st.name.toUpperCase()}</div>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-black">{st.coord}</span>
                  </div>
                  <div className="relative mt-3 overflow-hidden rounded-xl border border-white/10 bg-[#020a12]">
                    <svg viewBox="0 0 400 260" className="h-[210px] w-full">
                      <circle cx="200" cy="130" r="96" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
                      <circle cx="200" cy="130" r="68" fill="none" stroke="rgba(255,255,255,0.06)" />
                      <circle cx="200" cy="130" r="36" fill="none" stroke="rgba(255,255,255,0.06)" />
                      <g stroke="rgba(255,255,255,0.05)">{Array.from({ length: 12 }).map((_, i) => <line key={i} x1="200" y1="130" x2={200 + Math.cos((i * Math.PI) / 6) * 96} y2={130 + Math.sin((i * Math.PI) / 6) * 96} />)}</g>
                      <path d="M140 150 Q180 110 220 130 Q260 150 240 190 Q200 210 160 190 Q130 170 140 150 Z" fill="rgba(255,255,255,0.05)" stroke="rgba(34,240,216,0.25)" />
                      {[{ x: 238, y: 148, label: 'Bharati', on: stationIdx === 0 }, { x: 168, y: 118, label: 'Maitri', on: stationIdx === 1 }, { x: 200, y: 54, label: 'Himadri', on: stationIdx === 2 }].map((p) => (
                        <g key={p.label} opacity={p.on ? 1 : 0.45}>
                          <circle cx={p.x} cy={p.y} r="13" fill={p.on ? 'rgba(34,240,216,0.2)' : 'rgba(255,255,255,0.06)'} />
                          <circle cx={p.x} cy={p.y} r="6" fill={p.on ? '#22f0d8' : '#64748b'} stroke="white" strokeWidth="1.2" />
                          {p.on && <circle cx={p.x} cy={p.y} r="10" fill="none" stroke="#22f0d8" opacity="0.5"><animate attributeName="r" values="8;15;8" dur="2.2s" repeatCount="indefinite" /><animate attributeName="opacity" values="0.5;0;0.5" dur="2.2s" repeatCount="indefinite" /></circle>}
                          <text x={p.x} y={p.y - 17} textAnchor="middle" fontSize="7" fontFamily="JetBrains Mono" fill="white" opacity="0.9">{p.label}</text>
                        </g>
                      ))}
                      <g>
                        <path d="M78 92 L92 88 L94 96 L80 100 Z" fill="#ffb84d" stroke="white" strokeWidth="0.6" />
                        <text x="86" y="84" textAnchor="middle" fontSize="6" fontFamily="JetBrains Mono" fill="#ffb84d">SAGAR NIDHI</text>
                        <path d="M94 96 Q140 108 168 118" fill="none" stroke="#ffb84d" strokeDasharray="3 3" opacity="0.6" />
                      </g>
                    </svg>
                    <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-black">Resupply &middot; ETA 14h</span>
                      <span className="font-mono text-[10px] text-white/50">Seasonal route</span>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 min-[480px]:grid-cols-3">
                    <div className="rounded-xl bg-white p-3 text-black">
                      <div className="font-mono text-[10px] tracking-[0.12em] text-black/50">ESTIMATED COVERAGE</div>
                      <div className="mt-1 text-[28px] font-black leading-none">{daysCount}<span className="text-sm font-medium text-black/60"> days</span></div>
                      <div className="text-[11px] text-black/60">{fmt(f.lo, 0)}&#8211;{fmt(f.hi, 0)} days &middot; {fmt(f.total)} L/day</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
                      <div className="font-mono text-[10px] text-white/50">CONSUMPTION MODEL</div>
                      <div className="mt-1 font-mono text-xs">base {fmt(f.physics)}</div>
                      <div className="font-mono text-xs text-cyan-300">+ adjustment {fmt(f.residual)}</div>
                      <div className="mt-1 text-[11px] text-white/50">= {fmt(f.total)} L/day</div>
                    </div>
                    <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-3">
                      <div className="font-mono text-[10px] text-cyan-200">FORECAST MODE</div>
                      <button onClick={() => setSnnActive((v) => !v)} className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-semibold ${snnActive ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>
                        <Zap size={12} />{snnActive ? 'Adaptive' : 'Conservative'}
                      </button>
                      <div className="mt-1 text-[11px] text-white/60">Adjusts to conditions</div>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-white/70"><Thermometer size={12} />{temp}&#176;C</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-white/70"><Wind size={12} />{wind} m/s</span>
                    <span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${critical ? 'bg-amber-400 text-black' : 'bg-white/10 text-white'}`}>{critical ? 'Attention required' : 'Within expected range'}</span>
                  </div>
                  <div className="mt-3"><BurnChart temp={temp} wind={wind} critical={critical} /></div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 font-mono text-[11px]">
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/60">Offline-capable</div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/60">Field-tested interface</div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/60">Extended operations</div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* MARQUEE */}
      <div className="overflow-hidden border-y border-white/10 bg-white text-black">
        <div className="flex w-max animate-marquee whitespace-nowrap">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center gap-6 px-6 py-3 font-mono text-[13px] tracking-[0.08em]">
              <span>Designed for extended winter isolation</span><span className="opacity-20">—</span>
              <span>Reliable coordination over limited links</span><span className="opacity-20">—</span>
              <span>Efficient forecasting that conserves resources</span><span className="opacity-20">—</span>
              <span>Positioning without reliance on GPS</span><span className="opacity-20">—</span>
              <span>Coordinated resupply across stations</span><span className="opacity-20">—</span>
            </div>
          ))}
        </div>
      </div>

      {/* 01 CONTEXT */}
      <section className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHead kicker="01 — CONTEXT"
              title={<>Built for conditions<br /><span className="italic text-white/70">where standard systems fall short.</span></>}
              blurb="Conventional logistics platforms assume stable connectivity, accurate positioning and continuous power. Polar operations offer none of these. POLARIS is structured around those constraints from the outset." />
            <div className="mt-6 grid grid-cols-1 gap-3">
              {[
                ['Positioning remains available without GPS', 'Local sensing maintains accurate coordinates when satellite navigation is degraded by polar conditions.'],
                ['Designed for limited connectivity', 'Compact, incremental synchronization keeps stations coordinated even on constrained links.'],
                ['Conserves energy where it matters', 'Forecasting operates efficiently, running only when meaningful change is detected.'],
              ].map(([h, p]) => (
                <motion.div key={h} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-sm font-semibold">{h}</div>
                  <div className="mt-1 text-[13px] leading-5 text-white/60">{p}</div>
                </motion.div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-7">
            <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#0b1e33]">
              <div className="grid grid-cols-3 divide-x divide-white/10">
                {[
                  ['PAYLOAD SIZE', '1.1 KB', 'compact updates'],
                  ['RECONNECT', '<2 s', 'after outage'],
                  ['INTEGRITY', 'Verified', 'no duplication'],
                ].map(([l, v, s]) => (
                  <div key={l} className="p-4 text-center">
                    <div className="font-mono text-[10px] tracking-[0.12em] text-white/50">{l}</div>
                    <div className="mt-1 text-[22px] font-black">{v}</div>
                    <div className="text-[11px] text-white/50">{s}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 border-t border-white/10 p-4 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="font-mono text-[11px] tracking-[0.08em] text-white/50">SYNCHRONIZATION</div>
                  <div className="mt-1 text-sm font-medium text-white">Incremental updates, not full transfers</div>
                  <div className="mt-1 text-xs leading-5 text-white/60">Only what changed is shared. Each update is verified and applied once, keeping stations aligned without excess bandwidth.</div>
                </div>
                <div className="rounded-xl bg-white p-3 text-black">
                  <div className="font-mono text-[11px] tracking-[0.1em] text-black/50">ACCOUNTABILITY</div>
                  <div className="mt-1 text-sm font-semibold">Complete record of every change</div>
                  <div className="text-xs leading-5 text-black/60">A consistent audit trail supports review and handover across rotations.</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 px-4 pb-4 font-mono text-[11px]">
                <span className="rounded-full border border-white/15 px-3 py-1.5 text-white/70">Works offline by default</span>
                <span className="rounded-full border border-white/15 px-3 py-1.5 text-white/70">Coordinated across stations</span>
                <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-black">Supports multiple stations</span>
              </div>
            </div>
            <div className="mt-3 flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-white/60" size={16} />
              <div className="text-[13px] leading-5 text-white/70">With resupply windows measured in weeks, early and reliable forecasting is essential. The system is designed to surface risk well in advance, even while offline.</div>
            </div>
          </div>
        </div>
      </section>

      {/* 02 CAPABILITIES */}
      <section id="pillars" className="border-t border-white/10 bg-[#050e1a]">
        <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHead kicker="02 — CAPABILITIES"
              title={<>Three capabilities,<br />integrated as one system.</>} />
            <div className="max-w-[44ch] text-sm leading-6 text-white/60">Each addresses a specific constraint of polar deployment — positioning, energy and connectivity — and operates within the same platform.</div>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-3">
            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
              className="overflow-hidden rounded-[22px] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02]">
              <div className="p-5">
                <div className="font-mono text-[11px] tracking-[0.12em] text-white/50">01 &middot; POSITIONING</div>
                <h3 className="mt-3 text-[18px] font-bold leading-tight">Reliable tracking<br /><span className="font-medium text-white/60">without satellite dependency.</span></h3>
                <p className="mt-2 text-[13px] leading-5 text-white/60">Local sensing maintains position estimates at sub-meter accuracy when GPS is unavailable. The approach is consistent in low-visibility conditions.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setWhiteout((v) => !v)} className={`rounded-full border px-3 py-1.5 font-mono text-xs ${whiteout ? 'border-amber-400 bg-amber-400 text-black' : 'border-white/10 bg-white/5 text-white/70'}`}>{whiteout ? 'Limited visibility' : 'Standard conditions'}</button>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-white/60">Interactive demo</span>
                </div>
              </div>
              <div className="px-3 pb-3"><LidarCanvas whiteout={whiteout} /></div>
              <div className="px-5 pb-4 font-mono text-[11px] text-white/40">Illustrative sensor fusion &middot; simulated data for demonstration</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.06 }}
              className="overflow-hidden rounded-[22px] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02]">
              <div className="p-5">
                <div className="font-mono text-[11px] tracking-[0.12em] text-white/50">02 &middot; FORECASTING</div>
                <h3 className="mt-3 text-[18px] font-bold leading-tight">Forecasting that<br /><span className="font-medium text-white/60">respects power constraints.</span></h3>
                <p className="mt-2 text-[13px] leading-5 text-white/60">Consumption is estimated from environmental and operational inputs. Computation is applied selectively to reduce energy use while remaining responsive to change.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setSnnActive((v) => !v)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${snnActive ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>{snnActive ? 'Adaptive mode' : 'Conservative mode'}</button>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-white/60">Energy-aware</span>
                </div>
              </div>
              <div className="px-3 pb-3"><SnnCanvas active={snnActive} /></div>
              <div className="px-5 pb-4 font-mono text-[11px] text-white/40">Conceptual model &middot; illustrates adaptive inference</div>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.12 }}
              className="overflow-hidden rounded-[22px] border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.02]">
              <div className="p-5">
                <div className="font-mono text-[11px] tracking-[0.12em] text-white/50">03 &middot; CONNECTIVITY</div>
                <h3 className="mt-3 text-[18px] font-bold leading-tight">Stay coordinated<br /><span className="font-medium text-white/60">even when disconnected.</span></h3>
                <p className="mt-2 text-[13px] leading-5 text-white/60">Updates are held locally and shared opportunistically — via available links or physical transfer — with deterministic reconciliation when stations reconnect.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => setBundled((b) => Math.min(8, b + 1))} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-black">Add update</button>
                  <button onClick={() => setBundled((b) => Math.max(1, b - 1))} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 font-mono text-xs text-white/70">Remove</button>
                </div>
              </div>
              <div className="px-3 pb-3"><DtnFlow bundled={bundled} /></div>
              <div className="px-5 pb-4 font-mono text-[11px] text-white/40">Illustrative transfer flow &middot; opportunistic synchronization</div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 03 SIMULATOR */}
      <section id="live-ops" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead kicker="03 — SIMULATOR" title={<>Adjust conditions.<br />Observe the effect on coverage.</>} blurb="This interactive estimate shows how temperature and wind influence consumption and, consequently, time to resupply. Values are illustrative." />
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-white/60">Station</span>
            <div className="flex rounded-full border border-white/10 bg-white/5 p-1">
              {STATIONS.map((s, i) => <button key={s.id} onClick={() => setStationIdx(i)} className={`rounded-full px-3 py-1 font-mono text-xs ${i === stationIdx ? 'bg-white text-black' : 'text-white/60'}`}>{s.name}</button>)}
            </div>
          </div>
        </div>
        <div className="mt-6 grid gap-5 lg:grid-cols-12">
          <div className="rounded-[22px] border border-white/10 bg-[#0b1e33] p-4 lg:col-span-4">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[11px] tracking-[0.12em] text-white/50">CONDITIONS &middot; {st.id}</div>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-black">{st.coord}</span>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex justify-between font-mono text-xs text-white/60"><span className="flex items-center gap-1"><Thermometer size={12} /> Outside temperature</span><span className="font-semibold text-white">{temp}&#176;C</span></div>
                <input type="range" min={-40} max={-8} value={temp} onChange={(e) => setTemp(parseInt(e.target.value))} aria-label="Outside temperature in Celsius" className="mt-2 w-full" />
                <div className="flex justify-between font-mono text-[10px] text-white/40"><span>Colder</span><span>Milder</span></div>
              </div>
              <div>
                <div className="flex justify-between font-mono text-xs text-white/60"><span className="flex items-center gap-1"><Wind size={12} /> Wind</span><span className="font-semibold text-white">{wind} m/s</span></div>
                <input type="range" min={2} max={26} value={wind} onChange={(e) => setWind(parseInt(e.target.value))} aria-label="Wind speed in meters per second" className="amber mt-2 w-full" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { setTemp(-15); setWind(5); }} className="rounded-xl border border-white/10 bg-white py-2.5 text-xs font-semibold text-black">Calm conditions</button>
                <button onClick={() => { setTemp(-38); setWind(22); }} className="rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-white">Severe conditions</button>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-xs leading-5">
                <div className="text-white/50">Estimated daily consumption</div>
                <div className="text-white">{fmt(f.total)} L/day &middot; range {fmt(f.lo, 0)}&#8211;{fmt(f.hi, 0)} days</div>
                <div className="text-white/40">Illustrative model for demonstration</div>
              </div>
              <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium ${critical ? 'bg-amber-400 text-black' : 'bg-white/10 text-white'}`}>
                <Timer size={14} />{critical ? 'Coverage is becoming limited — review resupply timing' : `Estimated coverage: ${fmt(f.days)} days`}
              </div>
            </div>
          </div>
          <div className="space-y-5 lg:col-span-8">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[20px] bg-white p-4 text-black">
                <div className="font-mono text-[10px] tracking-[0.12em] text-black/50">ESTIMATED COVERAGE</div>
                <div className="mt-1 text-[30px] font-black leading-none">{fmt(f.days)} <span className="text-sm font-medium text-black/60">days</span></div>
                <div className="text-xs text-black/60">Current reserve: {st.dieselL.toLocaleString()} L</div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10"><div className="h-full bg-black transition-all" style={{ width: `${Math.min(100, (f.days / 42) * 100)}%` }} /></div>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/[0.06] p-4">
                <div className="font-mono text-[10px] tracking-[0.12em] text-white/50">RESUPPLY</div>
                <div className="mt-2 flex items-center gap-2 text-sm font-medium"><Ship size={14} className="text-white/60" /> Next window &middot; ~14 days</div>
                <div className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${f.days < 14 ? 'bg-amber-400 text-black' : 'bg-white/10 text-white'}`}>{f.days < 14 ? 'Review timing' : 'Within current window'}</div>
                <div className="mt-1 font-mono text-[11px] text-white/40">Seasonal scheduling</div>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/[0.06] p-4">
                <div className="font-mono text-[10px] tracking-[0.12em] text-white/50">SYNCHRONIZATION</div>
                <div className="mt-1 text-sm font-medium text-white">{bundled} updates queued</div>
                <div className="mt-1 text-xs leading-5 text-white/60">Held locally and shared when a link is available.</div>
              </div>
            </div>
            <div className="overflow-hidden rounded-[22px] border border-white/10 bg-[#0b1e33]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                <div className="font-mono text-[11px] tracking-[0.12em] text-white/60">INVENTORY &middot; {st.name.toUpperCase()}</div>
                <div className="flex flex-wrap gap-1.5 font-mono text-[10px]"><span className="rounded-full bg-white/10 px-2 py-1 text-white/70">Illustrative</span></div>
              </div>
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead className="font-mono text-[11px] text-white/40"><tr className="border-b border-white/5"><th className="px-4 py-2 text-left">Item</th><th className="text-left">Location</th><th className="text-right">Quantity</th><th className="pl-4 text-left">Status</th></tr></thead>
                  <tbody className="font-mono text-xs">
                    {INVENTORY.slice(0, 5).map((r) => (
                      <tr key={r.sku} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                        <td className="px-4 py-2.5 text-white">{r.sku}</td><td className="text-white/60">{r.crate}</td><td className="text-right text-white">{r.qty.toLocaleString()} {r.unit}</td><td className={`pl-4 ${statusColor(r.status)}`}>{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 font-mono text-[11px] text-white/40">Sample data for demonstration &middot; quantities and locations are illustrative</div>
            </div>
          </div>
        </div>
      </section>

      {/* 04 FIELD */}
      <section id="field" className="border-y border-white/10 bg-[#050e1a]">
        <div className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
          <SectionHead kicker="04 — FIELD INTERFACE"
            title={<>Designed for use<br /><span className="italic text-white/60">in the field.</span></>}
            blurb="A focused, offline-capable interface for station personnel. The same information model is shared across field and operations views." />
          <div className="mt-8 grid gap-6 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <div className="overflow-hidden rounded-[26px] border border-white/15 bg-black shadow-card">
                <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
                  <div className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /></div>
                  <span className="font-mono text-[10px] text-white/50">{st.name.toUpperCase()} &middot; FIELD VIEW</span>
                </div>
                <div className="flex gap-1 overflow-x-auto border-b border-white/10 p-2 no-scrollbar">
                  {TABS.map((t) => (
                    <button key={t} onClick={() => setTab(t)} className={`whitespace-nowrap rounded-full px-4 py-2 font-mono text-xs ${tab === t ? 'bg-white font-semibold text-black' : 'bg-white/5 text-white/60'}`}>{t}</button>
                  ))}
                </div>
                <div className="min-h-[300px] p-4">
                  {tab === 'Today' && (
                    <div className="space-y-3">
                      <div className="rounded-xl bg-white p-3 text-black"><div className="font-mono text-[10px] text-black/50">ESTIMATED COVERAGE</div><div className="text-2xl font-black">{fmt(f.days)} days</div><div className="font-mono text-[11px] text-black/60">Based on current conditions</div></div>
                      <div className="flex gap-2">
                        <button onClick={() => { setTemp(-15); setWind(5); }} className="flex-1 rounded-xl bg-white/10 py-3 font-mono text-xs">Calm</button>
                        <button onClick={() => { setTemp(-38); setWind(22); }} className="flex-1 rounded-xl bg-white/10 py-3 font-mono text-xs">Severe</button>
                        <button onClick={() => setSnnActive((v) => !v)} className="flex-1 rounded-xl bg-white py-3 font-mono text-xs font-semibold text-black">{snnActive ? 'Adaptive' : 'Standard'}</button>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3 font-mono text-[11px] text-white/60">{bundled} updates awaiting synchronization</div>
                    </div>
                  )}
                  {tab === 'Inventory' && (
                    <div className="space-y-2">
                      <div className="flex gap-1.5 font-mono text-[10px]">{['All', 'Attention', 'Expiring', 'Low'].map((p, i) => <span key={p} className={`rounded-full px-2 py-1 ${i === 0 ? 'bg-white font-semibold text-black' : 'bg-white/10 text-white/60'}`}>{p}</span>)}</div>
                      {INVENTORY.slice(0, 4).map((r) => (
                        <div key={r.sku} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                          <div><div className="font-mono text-xs text-white">{r.sku}</div><div className="font-mono text-[10px] text-white/40">{r.crate}</div></div>
                          <div className={`font-mono text-xs font-medium ${statusColor(r.status)}`}>{r.qty.toLocaleString()} {r.unit}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === 'Scan' && (
                    <div className="space-y-3">
                      <div className="grid place-items-center rounded-xl border-2 border-dashed border-white/15 bg-white/[0.03] py-8">
                        <ScanLine size={28} className="text-white/40" />
                        <div className="mt-2 font-mono text-xs text-white/60">Scan to identify item and location</div>
                        <div className="mt-1 rounded-full bg-white px-3 py-1 font-mono text-[11px] font-semibold text-black">FUEL-DIESEL-001</div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">{['FUEL-DIESEL-001', 'O2-CYL-47L-003', 'BEARING-6205'].map((c) => <span key={c} className="rounded-full bg-white/10 px-2.5 py-1.5 font-mono text-[10px] text-white/70">{c}</span>)}</div>
                    </div>
                  )}
                  {tab === 'Indents' && (
                    <div className="space-y-2">
                      {[
                        ['IND-8F2A', 'Diesel 500 L', 'Requires attention', 'bg-amber-400 text-black'],
                        ['IND-91BC', 'Bearings 4 pcs', 'Approved', 'bg-white text-black'],
                        ['IND-77E0', 'Oxygen 6 cyl', 'In transit', 'bg-white/15 text-white'],
                      ].map(([id, what, stt, cls]) => (
                        <div key={id} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                          <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-white">{id} · {what}</span><span className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}>{stt}</span></div>
                          <div className="mt-1 font-mono text-[10px] text-white/40">Request &rarr; Review &rarr; Dispatch &rarr; Received</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {tab === 'Locate' && (
                    <div className="space-y-2">
                      <div className="flex gap-2 font-mono text-[11px]">
                        <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/60">Satellite unavailable</span>
                        <span className="rounded-full bg-white px-2.5 py-1 font-semibold text-black">Local positioning</span>
                      </div>
                      <div className="dotgrid rounded-xl border border-white/10 bg-[#060f1a] p-3">
                        <div className="relative h-[150px]">
                          <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-glow" />
                          <div className="absolute left-[30%] top-[30%] rounded bg-white px-1.5 py-0.5 font-mono text-[9px] font-semibold text-black">C1-K1</div>
                          <div className="absolute left-[62%] top-[58%] rounded bg-white/15 px-1.5 py-0.5 font-mono text-[9px] text-white">C2-K1</div>
                          <div className="absolute bottom-1 left-2 font-mono text-[9px] text-white/40">Local grid &middot; illustrative</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-t border-white/10 bg-white/[0.03] px-4 py-2.5 font-mono text-[10px] text-white/40">Sample interface &middot; data shown is illustrative</div>
              </div>
            </div>
            <div className="space-y-4 lg:col-span-7">
              {[
                ['Clear actions in difficult conditions', 'The interface prioritizes legibility and simple actions suitable for field use, including operation with limited dexterity.', <Package key="i" size={16} />],
                ['Identification by scan', 'Items can be identified quickly to confirm location and status, supporting accurate handling and handover.', <QrCode key="i" size={16} />],
                ['Understand where things are', 'Storage locations are shown in context to reduce search time and support orderly management.', <Boxes key="i" size={16} />],
                ['A consistent workflow', 'Requests follow a clear lifecycle from need to receipt, with a shared understanding between field and operations.', <ClipboardList key="i" size={16} />],
              ].map(([h, p, icon]) => (
                <motion.div key={h as string} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                  className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-white/70">{icon as React.ReactNode}</div>
                  <div><div className="text-sm font-semibold">{h as string}</div><div className="mt-1 text-[13px] leading-5 text-white/60">{p as string}</div></div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 05 OPERATIONS */}
      <section id="hq" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
        <SectionHead kicker="05 — OPERATIONS OVERVIEW"
          title={<>A shared view<br /><span className="italic text-white/60">across stations.</span></>}
          blurb="Operations has a consolidated picture of inventory, requests and coverage. The view remains useful with live data and remains coherent when data is delayed." />
        <div className="mt-8 overflow-hidden rounded-[24px] border border-white/10 bg-[#0b1e33]">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <div className="flex gap-1.5">{['Overview', 'Forecast', 'Inventory', 'Requests', 'Trends', 'Planning', 'History'].map((t, i) => <span key={t} className={`hidden rounded-full px-3 py-1.5 font-mono text-[11px] sm:inline ${i === 1 ? 'bg-white font-semibold text-black' : 'bg-white/5 text-white/50'}`}>{t}</span>)}</div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-white/60">Live when available</span>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-5">
            {[
              ['Stations', '3', 'Bharati · Maitri · Himadri'],
              ['Tracked items', '20', 'Across categories'],
              ['Requiring attention', '3', 'Based on thresholds'],
              ['Active requests', '7', 'Across lifecycle'],
              ['Expiring soon', '2', 'Within 30 days'],
            ].map(([k, v, s]) => (
              <div key={k} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-center">
                <div className="font-mono text-[10px] tracking-[0.1em] text-white/50">{k}</div>
                <div className="text-xl font-semibold">{v}</div>
                <div className="font-mono text-[10px] text-white/40">{s}</div>
              </div>
            ))}
          </div>
          <div className="grid gap-3 px-4 pb-4 lg:grid-cols-2">
            <div className="rounded-2xl bg-white p-4 text-black">
              <div className="font-mono text-[10px] tracking-[0.12em] text-black/50">CONSUMPTION OUTLOOK</div>
              <div className="mt-1 text-[22px] font-semibold">Estimated {fmt(f.total)} L/day &middot; {fmt(f.days)} days coverage</div>
              <BurnChart temp={temp} wind={wind} critical={critical} />
              <div className="mt-1 font-mono text-[11px] text-black/50">Range {fmt(f.lo, 0)}–{fmt(f.hi, 0)} days &middot; illustrative estimate</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
              <div className="font-mono text-[10px] tracking-[0.12em] text-white/50">RESUPPLY PLANNING</div>
              {[['Diesel', '850 L', 'Estimated need'], ['Oxygen', '6 cyl', 'Estimated need'], ['Bearings', '4 pcs', 'Recommended']].map(([item, qty, note]) => (
                <div key={item} className="mt-2 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  <span className="text-sm text-white">{item} &middot; {qty}</span>
                  <span className="font-mono text-[11px] text-white/50">{note}</span>
                </div>
              ))}
              <div className="mt-2 font-mono text-[11px] text-white/35">Planning is based on current reserve and forecast</div>
            </div>
          </div>
        </div>
      </section>

      {/* 06 LOGISTICS */}
      <section id="vessels" className="border-y border-white/10 bg-[#050e1a]">
        <div className="mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
          <SectionHead kicker="06 — RESUPPLY COORDINATION" title={<>Align supply<br /><span className="italic text-white/60">with operational need.</span></>} blurb="Vessel movements and station needs are viewed together so that timing can be assessed, even when live tracking is temporarily unavailable." />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {VESSELS.map((v) => (
              <motion.div key={v.imo} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold"><Ship size={14} className="text-white/50" /> {v.name}</span>
                  <span className="rounded-full bg-white/10 px-2 py-1 font-mono text-[10px] text-white/60">IMO {v.imo}</span>
                </div>
                <div className="mt-3 h-[110px] rounded-xl border border-white/10 bg-[#020a12] p-2">
                  <svg viewBox="0 0 300 90" className="h-full w-full">
                    <path d="M10 70 Q80 60 150 55 Q220 50 290 30" fill="none" stroke="rgba(255,255,255,0.25)" strokeDasharray="4 3" />
                    <circle cx="20" cy="68" r="5" fill="#64748b" /><circle cx="280" cy="32" r="6" fill="white" stroke="white" strokeWidth="1" />
                    <circle cx={20 + (280 - 20) * 0.62} cy={68 - (68 - 32) * 0.62} r="5" fill="white" stroke="white" strokeWidth="1" />
                    <text x="20" y="84" fontSize="8" fontFamily="JetBrains Mono" fill="white" opacity="0.5">Origin</text>
                    <text x="245" y="50" fontSize="8" fontFamily="JetBrains Mono" fill="white" opacity="0.6">Station</text>
                  </svg>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                  <span className="rounded-full bg-white px-2 py-1 font-semibold text-black">ETA ~{v.etaH}h</span>
                  <span className="text-white/40">Illustrative</span>
                </div>
                <div className="mt-1 font-mono text-[10px] text-white/30">Timings are estimates for planning purposes</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 07 SYSTEM */}
      <section id="architecture" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
        <div className="grid items-start gap-8 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHead kicker="07 — SYSTEM" title={<>Designed to operate<br /><span className="italic text-white/60">without continuous connectivity.</span></>}
              blurb="Field and operations share a consistent data model. The system is intended to run self-contained, with synchronization applied when links allow." />
            <div className="mt-5 space-y-2 font-mono text-xs leading-5">
              {[
                ['Field', 'Focused interface for station use, with local storage and straightforward workflows.'],
                ['Gateway', 'Handles exchange between field and operations, managing intermittent links.'],
                ['Operations', 'Consolidated view for planning, review and coordination across stations.'],
                ['Approach', 'Shared definitions and a single coordination point support consistency.'],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5"><span className="shrink-0 font-semibold text-white">{k}</span><span className="text-white/60">{v}</span></div>
              ))}
            </div>
          </div>
          <div className="rounded-[22px] border border-white/10 bg-[#0b1e33] p-4 lg:col-span-7">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#020a12] p-3">
              <div className="flex items-center justify-between font-mono text-[11px] text-white/50"><span className="flex items-center gap-1.5"><Workflow size={12} /> FIELD — LINK — OPERATIONS</span><span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white/60">Intermittent</span></div>
              <div className="mt-3 grid grid-cols-1 gap-2 font-mono text-[11px] sm:grid-cols-3">
                <div className="rounded-xl bg-white p-3 text-black"><div className="font-semibold">Field</div><div className="text-black/60">Local-first</div><div className="mt-2 rounded bg-black px-2 py-1 text-xs text-white">Updates queued</div></div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-white"><div className="flex items-center gap-1 font-semibold"><Satellite size={12} /> Link</div><div className="text-white/50">When available</div><div className="mt-2 rounded bg-white/10 px-2 py-1 text-center text-xs text-white">Shared when possible</div></div>
                <div className="rounded-xl bg-white p-3 text-black"><div className="font-semibold">Operations</div><div className="text-black/60">Consolidated</div><div className="mt-2 rounded bg-black px-2 py-1 text-xs text-white">View reconciled</div></div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px]"><span className="rounded-full border border-white/15 px-2 py-1 text-white/60">Local storage</span><span className="rounded-full border border-white/15 px-2 py-1 text-white/60">Queued updates</span><span className="rounded-full border border-white/15 px-2 py-1 text-white/60">Coordinated state</span></div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-white/10 bg-white/5 py-3"><div className="font-mono text-[11px] text-white/50">Stations</div><div className="text-lg font-semibold">3</div><div className="font-mono text-[11px] text-white/40">Supported</div></div>
              <div className="rounded-xl border border-white/10 bg-white/5 py-3"><div className="font-mono text-[11px] text-white/50">Locations</div><div className="text-lg font-semibold">12</div><div className="font-mono text-[11px] text-white/40">Storage areas</div></div>
              <div className="rounded-xl border border-white/10 bg-white/5 py-3"><div className="font-mono text-[11px] text-white/50">Categories</div><div className="text-lg font-semibold">Multiple</div><div className="font-mono text-[11px] text-white/40">Item types</div></div>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs leading-5 text-white/60"><ShieldCheck size={14} className="shrink-0 text-white/50" />A shared structure underpins both field and operations views — including inventory, requests and position data.</div>
          </div>
        </div>
      </section>

      {/* 08 API */}
      <section id="api" className="border-y border-white/10 bg-[#050e1a]">
        <div className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <SectionHead kicker="08 — INTERFACE" title={<>Integrate without<br /><span className="italic text-white/60">added complexity.</span></>} blurb="A documented HTTP interface covers core operations. Responses are versioned to support reliable synchronization." />
            <input value={apiQ} onChange={(e) => setApiQ(e.target.value)} placeholder="Filter — e.g. inventory" className="w-full max-w-[260px] rounded-full border border-white/15 bg-white/5 px-4 py-2 font-mono text-xs text-white placeholder:text-white/30 focus:border-white/25 focus:outline-none" />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              {apiFiltered.map((r) => (
                <button key={r.path} onClick={() => setApiSel(API_ROUTES.indexOf(r))} className={`flex w-full items-center gap-3 border-b border-white/[0.06] px-4 py-2.5 text-left font-mono text-xs ${API_ROUTES.indexOf(r) === apiSel ? 'bg-white/10' : 'bg-white/[0.02] hover:bg-white/[0.05]'}`}>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.method === 'GET' ? 'bg-white text-black' : 'bg-white/15 text-white'}`}>{r.method}</span>
                  <span className="min-w-0 flex-1 truncate text-white">{r.path}</span>
                  <span className="ml-auto hidden text-white/40 sm:inline">{r.note}</span>
                </button>
              ))}
              {apiFiltered.length === 0 && <div className="bg-white/[0.02] px-4 py-6 font-mono text-xs text-white/40">No routes match &ldquo;{apiQ}&rdquo;.</div>}
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4 font-mono text-xs leading-5">
              <div className="flex items-center justify-between text-white/40"><span>{API_ROUTES[apiSel].method} {API_ROUTES[apiSel].path}</span><span className="rounded-full bg-white px-2 py-0.5 font-semibold text-black">Example</span></div>
              <pre className="mt-3 overflow-x-auto text-white/70">$ curl $HQ{API_ROUTES[apiSel].path}{API_ROUTES[apiSel].method === 'POST' ? " -H 'Authorization: Bearer $TOKEN'" : ''}</pre>
              <pre className="mt-2 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.03] p-3 text-white/70">{API_ROUTES[apiSel].path.includes('forecast/snn')
                ? `{\n  "quantity": ${st.dieselL},\n  "estimate_per_day": ${fmt(f.total)},\n  "days_remaining": ${fmt(f.days)},\n  "mode": "${snnActive ? 'adaptive' : 'conservative'}"\n}`
                : API_ROUTES[apiSel].path.includes('forecast')
                  ? `{\n  "quantity": ${st.dieselL},\n  "estimate_per_day": ${fmt(f.total)},\n  "days_remaining": ${fmt(f.days)},\n  "range": [${fmt(f.lo, 0)}, ${fmt(f.hi, 0)}]\n}`
                  : API_ROUTES[apiSel].path.includes('vessels')
                    ? `[{ "name": "SAGAR NIDHI",\n   "eta": "~14h",\n   "status": "scheduled" }]`
                    : `{\n  "station": "${st.id}",\n  "status": "recorded",\n  "version": "3.1.2"\n}`}</pre>
              <div className="mt-2 text-[11px] text-white/35">Illustrative response &middot; structure matches the implemented API</div>
            </div>
          </div>
        </div>
      </section>

      {/* 09 FLEET */}
      <section id="fleet" className="mx-auto max-w-[1280px] scroll-mt-24 px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHead kicker="09 — COVERAGE" title={<>Consistent across<br /><span className="italic text-white/60">stations.</span></>} blurb="The same platform supports each station. Current reserves and estimates are shown together for planning." />
          <div className="font-mono text-xs text-white/40">Overview for planning &middot; illustrative figures</div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {STATIONS.map((s, i) => {
            const sf = i === stationIdx ? f : thermoHybrid(s.crew % 2 ? -26 : -18, s.crew % 3 ? 11 : 4, true, s.dieselL);
            return (
              <motion.div key={s.id} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
                className={`rounded-[22px] border p-4 ${i === stationIdx ? 'border-white/20 bg-white/[0.06]' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="flex items-center justify-between">
                  <div className="font-mono text-[11px] tracking-[0.12em] text-white/50">{s.id}</div>
                  <span className="rounded-full bg-white/10 px-2 py-1 font-mono text-[11px] text-white/60">Crew {s.crew}</span>
                </div>
                <div className="mt-2 text-[20px] font-semibold">{s.name} <span className="font-mono text-xs font-normal text-white/40">{s.coord}</span></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-white py-2 text-black"><div className="font-mono text-[11px] text-black/50">Fuel</div><div className="text-sm font-semibold">{s.dieselL.toLocaleString()} L</div></div>
                  <div className="rounded-xl border border-white/10 bg-white/5 py-2"><div className="font-mono text-[11px] text-white/50">Oxygen</div><div className="text-sm font-medium">{s.oxygenCyl} cyl</div></div>
                  <div className="rounded-xl border border-white/10 bg-white/5 py-2"><div className="font-mono text-[11px] text-white/50">Spares</div><div className="text-sm font-medium">{s.bearings} pcs</div></div>
                </div>
                <div className="mt-3 flex items-center gap-2 font-mono text-xs">
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1 text-white/60"><Activity size={12} />{fmt(sf.days)} days</span>
                  <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-medium ${sf.days < 20 ? 'bg-amber-400 text-black' : 'bg-white/10 text-white/70'}`}>{sf.days < 20 ? 'Review' : 'Adequate'}</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-white/60 transition-all" style={{ width: `${Math.min(100, (sf.days / 42) * 100)}%` }} /></div>
              </motion.div>
            );
          })}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3 rounded-[20px] border border-white/10 bg-white/[0.03] p-4 font-mono text-xs text-white/50">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-medium text-black"><Boxes size={12} /> Storage areas</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5"><Layers size={12} /> Inventory categories</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5"><Anchor size={12} /> Resupply coordination</span>
          <span className="w-full text-white/40 sm:ml-auto sm:w-auto">All stations share the same coordination model</span>
        </div>
      </section>

      {/* TRUST */}
      <section className="border-y border-white/10 bg-white text-black">
        <div className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
          <div className="font-mono text-[11px] tracking-[0.16em] text-black/40">PRINCIPLES</div>
          <div className="mt-4 grid gap-3 text-sm md:grid-cols-4">
            {[
              ['Operates offline', 'Core functions remain available without connectivity, with synchronization applied when possible.'],
              ['Clear status at all times', 'The interface communicates what is current, what is delayed and what requires attention.'],
              ['No duplicate actions', 'Each update is applied once, supporting consistency across stations.'],
              ['Built for the environment', 'Designed around the practical constraints of extended polar deployment.'],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-black/10 bg-black/[0.03] p-4"><div className="font-semibold">{t}</div><div className="mt-1 text-[13px] leading-5 text-black/60">{d}</div></div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 font-mono text-xs">
            <span className="rounded-full bg-black px-3 py-2 text-white">No new hardware required</span>
            <span className="rounded-full border border-black/10 px-3 py-2">Documented and verifiable</span>
            <span className="rounded-full border border-black/10 px-3 py-2">SIH26062</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b1e33] via-[#020a12] to-[#0a1a2e]" />
        <div className="absolute inset-0 opacity-20" style={{ background: 'radial-gradient(700px 400px at 15% 20%, rgba(34,240,216,0.25), transparent), radial-gradient(600px 400px at 85% 30%, rgba(139,142,255,0.22), transparent)' }} />
        <div className="relative mx-auto max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-col items-start justify-between gap-6 rounded-[28px] border border-white/10 bg-white/[0.06] p-6 backdrop-blur sm:p-8 lg:flex-row lg:items-center">
            <div>
              <div className="font-mono text-[11px] tracking-[0.16em] text-white/50">DEPLOYMENT</div>
              <h3 className="mt-2 font-display text-[30px] leading-none tracking-[-0.03em] sm:text-[40px]">Ready for extended operation.</h3>
              <p className="mt-2 max-w-[60ch] text-sm leading-6 text-white/60">A self-contained setup for evaluation. Field, gateway and operations components run together, with synchronization reflecting real deployment behavior.</p>
              <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-medium text-black"><MapPin size={12} /> {st.name} &middot; {st.coord}</span>
                <span className="rounded-full border border-white/15 px-3 py-1.5 text-white/60">Self-contained deployment</span>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 lg:w-auto">
              <a href="#top" className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black">Back to top <ArrowUpRight size={14} /></a>
              <a href="#live-ops" className="inline-flex items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-medium text-white hover:bg-white/10">Try the simulator</a>
              <div className="text-center font-mono text-[11px] text-white/35">No external services required</div>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-white/30">
            <span>SIH26062</span><span>Built for Bharati, Maitri and Himadri</span>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
