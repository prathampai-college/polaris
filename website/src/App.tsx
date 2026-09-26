import { useEffect, useMemo, useRef, useState } from 'react';
import { useScroll } from 'motion/react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Nav, Footer } from './components/chrome';
import Hero from './sections/Hero';
import Marquee from './sections/Marquee';
import Context from './sections/Context';
import Capabilities from './sections/Capabilities';
import Simulator from './sections/Simulator';
import FieldInterface from './sections/FieldInterface';
import OperationsOverview from './sections/OperationsOverview';
import Vessels from './sections/Vessels';
import Architecture from './sections/Architecture';
import ApiExplorer from './sections/ApiExplorer';
import Trust from './sections/Trust';
import Cta from './sections/Cta';
import { STATIONS, TABS } from './lib/data';
import { thermoHybrid } from './lib/physics';

gsap.registerPlugin(ScrollTrigger);

const TICKS = 48;

export default function App() {
  const { scrollYProgress } = useScroll();

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
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setWind((w) => Math.max(3, Math.min(26, w + (Math.random() - 0.5) * 2))), 1100);
    return () => clearInterval(id);
  }, [playing]);

  // Tick-rail spine: fills top→bottom with scroll progress, GSAP-driven.
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const bar = el.querySelector<HTMLElement>('.rail-fill');
    if (!bar) return;
    gsap.set(bar, { scaleY: 0 });
    const trigger = ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => gsap.set(bar, { scaleY: self.progress }),
    });
    return () => trigger.kill();
  }, []);

  const st = STATIONS[stationIdx];
  const f = useMemo(() => thermoHybrid(temp, wind, snnActive, st.dieselL), [temp, wind, snnActive, st.dieselL]);
  const critical = f.days < 20;

  return (
    <div id="top" className="min-h-screen bg-canvas text-ink selection:bg-cobalt/20">
      <div ref={railRef} className="pointer-events-none fixed left-0 top-[64px] z-[60] hidden h-[calc(100vh-64px)] w-[3px] bg-structure/10 lg:block">
        <div className="rail-fill h-full w-full origin-top bg-cobalt" />
        <div className="absolute inset-0 flex flex-col justify-between py-1" aria-hidden>
          {Array.from({ length: TICKS }).map((_, i) => (
            <div key={i} className="h-[1px] w-2 -translate-x-[2.5px] bg-structure/25" />
          ))}
        </div>
      </div>

      <Nav stationIdx={stationIdx} setStationIdx={setStationIdx} />

      <Hero
        scrollYProgress={scrollYProgress}
        stationIdx={stationIdx}
        st={st}
        f={f}
        temp={temp}
        wind={wind}
        critical={critical}
        snnActive={snnActive}
        setSnnActive={setSnnActive}
        playing={playing}
        setPlaying={setPlaying}
      />
      <Marquee />
      <Context />
      <Capabilities
        whiteout={whiteout}
        setWhiteout={setWhiteout}
        snnActive={snnActive}
        setSnnActive={setSnnActive}
        bundled={bundled}
        setBundled={setBundled}
      />
      <Simulator
        temp={temp}
        setTemp={setTemp}
        wind={wind}
        setWind={setWind}
        stationIdx={stationIdx}
        setStationIdx={setStationIdx}
        st={st}
        f={f}
        critical={critical}
        bundled={bundled}
      />
      <FieldInterface
        st={st}
        tab={tab}
        setTab={setTab}
        f={f}
        snnActive={snnActive}
        setSnnActive={setSnnActive}
        bundled={bundled}
        setTemp={setTemp}
        setWind={setWind}
      />
      <OperationsOverview f={f} temp={temp} wind={wind} critical={critical} stationIdx={stationIdx} setStationIdx={setStationIdx} />
      <Vessels />
      <Architecture />
      <ApiExplorer apiQ={apiQ} setApiQ={setApiQ} apiSel={apiSel} setApiSel={setApiSel} st={st} f={f} snnActive={snnActive} />
      <Trust />
      <Cta st={st} />

      <Footer />
    </div>
  );
}
