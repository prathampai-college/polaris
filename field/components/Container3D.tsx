'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, OrbitControls, Text } from '@react-three/drei';
import { AlertTriangle, Clock, Search } from 'lucide-react';
import { CONTAINER_SPECS, CRATE_COORDS } from '@polaris/shared/containers.js';
import { cn } from '../lib/utils';

// Local font: drei's default fetches from a CDN, which a station with no link can't reach.
const LABEL_FONT = '/fonts/jetbrains-mono-latin-600-normal.woff';

// Releases GPU geometries/materials on unmount - prevents WebGL context loss on tablets.
function GLCleanup() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => () => {
    try {
      scene.traverse((o: any) => {
        try { o.geometry?.dispose?.(); } catch {}
        const m = o.material;
        const kill = (x: any) => { try { x.map?.dispose?.(); x.dispose?.(); } catch {} };
        if (Array.isArray(m)) m.forEach(kill); else if (m) kill(m);
      });
    } catch {}
    try { gl.dispose(); } catch {}
  }, [gl, scene]);
  return null;
}

export interface AssetRow {
  id: string;
  sku: string;
  name: string;
  qty: number;
  unit: string;
  crate_id: string;
  expiry_date?: string | null;
  criticality?: string;
}
export type CrateFlag = 'expired' | 'expiring';

// three.js needs concrete colours: read the design tokens ("0 71 255") off :root and
// re-read whenever the Day/Night theme flips.
const TOKENS = ['canvas', 'surface', 'structure', 'ink', 'slate', 'cobalt', 'flare', 'caution'] as const;
type Palette = Record<(typeof TOKENS)[number], string>;
function readPalette(): Palette {
  const cs = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement);
  const out = {} as Palette;
  for (const t of TOKENS) {
    const v = cs?.getPropertyValue(`--${t}`).trim().split(/\s+/).filter(Boolean) ?? [];
    out[t] = v.length === 3 ? `rgb(${v.join(',')})` : 'rgb(128,128,128)';
  }
  return out;
}
function usePalette() {
  const [p, setP] = useState(readPalette);
  useEffect(() => {
    const mo = new MutationObserver(() => setP(readPalette()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return p;
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); // hand the probe context straight back
    return !!gl;
  } catch {
    return false;
  }
}

const WHITE = 'rgb(255,255,255)';

function CrateMesh({ id, position, count, flag, selected, match, c, onSelect }: {
  id: string; position: [number, number, number]; count: number; flag?: CrateFlag; selected: boolean; match: boolean; c: Palette; onSelect: (id: string) => void;
}) {
  const fill = selected ? c.cobalt : flag === 'expired' ? c.flare : c.surface;
  const text = selected || flag === 'expired' ? WHITE : c.ink;
  const edge = selected ? c.ink : match ? c.cobalt : flag === 'expiring' ? c.caution : c.structure;
  const status = flag === 'expired' ? 'EXPIRED' : flag === 'expiring' ? 'EXPIRING' : match ? 'MATCH' : '';
  return (
    <group
      position={position}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.delta > 8) return; // that was an orbit drag, not a tap
        onSelect(id);
      }}
    >
      <mesh>
        <boxGeometry args={[0.88, 0.8, 0.88]} />
        <meshStandardMaterial color={fill} roughness={1} metalness={0} />
        <Edges color={edge} lineWidth={match || selected || flag ? 3 : 1.5} />
      </mesh>
      {/* Own Suspense: troika fetches its font on first use — offline that must not blank the crates. */}
      <Suspense fallback={null}>
        <Text font={LABEL_FONT} position={[0, 0.16, 0.45]} fontSize={0.15} color={text} anchorX="center" anchorY="middle">{id}</Text>
        <Text font={LABEL_FONT} position={[0, -0.04, 0.45]} fontSize={0.1} color={text} anchorX="center" anchorY="middle">{`${count} item${count === 1 ? '' : 's'}`}</Text>
        {status && <Text font={LABEL_FONT} position={[0, -0.22, 0.45]} fontSize={0.1} color={selected || flag === 'expired' ? WHITE : flag === 'expiring' ? c.caution : c.cobalt} anchorX="center" anchorY="middle">{status}</Text>}
      </Suspense>
    </group>
  );
}

const containerOf = (crateId: string) => Object.keys(CONTAINER_SPECS).find((k) => CONTAINER_SPECS[k].crates.includes(crateId));

/**
 * 3D twin of one station's store containers. Selection is owned by the caller so the
 * 2D plan and this view stay in step; every crate is also a button in the list below.
 */
export function Container3D({ assets, stationId, selectedCrate, onSelectCrate, onSelectAsset, highlight = [], flags = {} }: {
  assets: AssetRow[];
  stationId: string;
  selectedCrate: string | null;
  onSelectCrate: (id: string | null) => void;
  onSelectAsset: (assetId: string) => void;
  highlight?: string[];
  flags?: Record<string, CrateFlag>;
}) {
  const c = usePalette();
  const [webgl] = useState(hasWebGL);
  const containers = useMemo(() => Object.keys(CONTAINER_SPECS).filter((k) => CONTAINER_SPECS[k].stationId === stationId), [stationId]);
  const [active, setActive] = useState<string | null>(null);

  // Follow the selection / first search match into its container.
  const follow = selectedCrate ?? highlight[0] ?? null;
  useEffect(() => {
    const k = follow && containerOf(follow);
    if (k) setActive(k);
  }, [follow]);

  const cur = active && containers.includes(active) ? active : containers[0];
  const spec = cur ? CONTAINER_SPECS[cur] : null;

  const byCrate = useMemo(() => {
    const m = new Map<string, AssetRow[]>();
    for (const a of assets) m.set(a.crate_id, [...(m.get(a.crate_id) ?? []), a]);
    return m;
  }, [assets]);

  if (!spec) {
    return <p className="border border-dashed border-structure/50 p-4 text-sm text-slate">No 3D layout is defined for this station&apos;s containers. Use the store plan.</p>;
  }

  const hl = new Set(highlight);
  const inside = selectedCrate ? byCrate.get(selectedCrate) ?? [] : [];
  const flagLabel = (id: string) => (flags[id] === 'expired' ? 'expired stock' : flags[id] === 'expiring' ? 'expiring stock' : '');

  return (
    <div className="space-y-3">
      <div role="group" aria-label="Container" className="flex flex-wrap gap-2">
        {containers.map((k) => {
          const s = CONTAINER_SPECS[k];
          const hasMatch = s.crates.some((id) => hl.has(id));
          return (
            <button
              key={k}
              type="button"
              aria-pressed={k === cur}
              onClick={() => setActive(k)}
              className={cn('flex min-h-tap items-center gap-2 border px-3 font-mono text-xs font-semibold uppercase tracking-[0.06em]',
                k === cur ? 'border-structure bg-ink text-canvas' : 'border-structure/40 bg-surface text-ink hover:border-structure',
                hasMatch && k !== cur && 'border-cobalt text-cobalt')}
            >
              {k} · {s.type}
              {hasMatch && <Search size={14} aria-label="contains a search match" />}
            </button>
          );
        })}
      </div>

      <div className="relative h-72 border border-structure bg-canvas sm:h-80">
        <div className="pointer-events-none absolute left-2 top-2 z-10 border border-structure bg-surface px-2 py-1">
          <div className="font-mono text-xs font-semibold text-ink">{spec.name}</div>
          <div className="font-mono text-xs text-slate">{spec.tempZone} · drag to rotate · pinch to zoom</div>
        </div>
        {webgl ? (
          <Canvas camera={{ position: [0, 2.2, 4.8], fov: 46 }} dpr={[1, 2]} gl={{ antialias: true, powerPreference: 'low-power' }}>
            <GLCleanup />
            <ambientLight intensity={1.6} />
            <directionalLight position={[6, 8, 4]} intensity={1.2} />
            <OrbitControls enablePan={false} maxPolarAngle={Math.PI / 2 + 0.1} minDistance={2.2} maxDistance={8} />
            {/* Container envelope — outline only, never intercepts taps. */}
            <mesh raycast={() => null}>
              <boxGeometry args={[3.4, 2.0, 2.4]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              <Edges color={c.structure} />
            </mesh>
            <gridHelper key={`${c.structure}${c.slate}`} args={[5, 6, c.structure, c.slate]} position={[0, -1, 0]} />
            {spec.crates.map((id) => (
              <CrateMesh
                key={id}
                id={id}
                position={CRATE_COORDS[id] ?? [0, 0, 0]}
                count={byCrate.get(id)?.length ?? 0}
                flag={flags[id]}
                selected={selectedCrate === id}
                match={hl.has(id)}
                c={c}
                onSelect={onSelectCrate}
              />
            ))}
          </Canvas>
        ) : (
          <div role="note" className="grid h-full place-items-center p-6 text-center text-sm text-slate">
            This tablet can&apos;t draw 3D (WebGL unavailable). The crate list below and the store plan show the same stock.
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-slate" aria-label="Legend">
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 border border-structure bg-cobalt" />Selected</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 border border-structure bg-flare" />Expired stock</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 border-2 border-caution bg-surface" />Expiring</span>
        <span className="flex items-center gap-1.5"><span aria-hidden className="h-3 w-3 border-2 border-cobalt bg-surface" />Search match</span>
      </div>

      <div role="group" aria-label={`Crates in ${cur}`} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {spec.crates.map((id) => {
          const on = selectedCrate === id;
          const n = byCrate.get(id)?.length ?? 0;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => onSelectCrate(on ? null : id)}
              className={cn('flex min-h-tap flex-col items-start justify-center border px-3 py-2 text-left',
                on ? 'border-structure bg-cobalt text-white' : hl.has(id) ? 'border-2 border-cobalt bg-surface text-ink' : 'border-structure/40 bg-surface text-ink hover:border-structure')}
            >
              <span className="font-mono text-sm font-semibold">{id}</span>
              <span className={cn('flex items-center gap-1 font-mono text-xs', on ? 'text-white' : 'text-slate')}>
                <span className="num">{n}</span> item{n === 1 ? '' : 's'}
                {flags[id] === 'expired' && <span className={cn('flex items-center gap-1', !on && 'text-flare')}><AlertTriangle size={12} aria-hidden />expired</span>}
                {flags[id] === 'expiring' && <span className={cn('flex items-center gap-1', !on && 'text-caution')}><Clock size={12} aria-hidden />expiring</span>}
                {hl.has(id) && <span className={cn(!on && 'text-cobalt')}>· match</span>}
              </span>
            </button>
          );
        })}
      </div>

      {selectedCrate && (
        <section aria-label={`Crate ${selectedCrate} contents`} className="border border-structure bg-surface">
          <header className="flex items-center justify-between gap-2 border-b border-structure px-4 py-2">
            <div>
              <div className="eyebrow">Crate {selectedCrate}</div>
              <div className="text-sm text-slate">{inside.length} item{inside.length === 1 ? '' : 's'} inside{flagLabel(selectedCrate) && ` · holds ${flagLabel(selectedCrate)}`}</div>
            </div>
            <button type="button" onClick={() => onSelectCrate(null)} className="min-h-tap border border-structure/40 px-3 font-mono text-xs font-semibold text-ink hover:border-structure">
              Close
            </button>
          </header>
          {inside.length ? (
            <ul className="divide-y divide-structure/20">
              {inside.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => onSelectAsset(a.id)} className="flex min-h-tap w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{a.name}</span>
                      <span className="block font-mono text-xs text-slate">{a.sku}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="num block font-mono text-sm font-semibold text-ink">{a.qty} {a.unit}</span>
                      <span className="block font-mono text-xs font-semibold text-cobalt">Inspect →</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-slate">No stock recorded in crate {selectedCrate}.</p>
          )}
        </section>
      )}
    </div>
  );
}
