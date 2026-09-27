'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, Search } from 'lucide-react';
import { useField } from '../../../lib/field-context';
import { db, useLiveQuery } from '../../../lib/db/client';
import { hq, ApiError } from '../../../lib/api';
import { fusionStep, type Fix } from '../../../lib/sensors/fusion';
import { expiryStatus } from '@polaris/shared/expiry';
import { Card, CardHeader, CardContent, PageHead, Empty, ErrorNote } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Field, Input, Segmented, Toggle } from '../../../components/ui/field';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../../components/ui/tabs';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import type { AssetRow, CrateFlag } from '../../../components/Container3D';
import { cn } from '../../../lib/utils';

const Container3D = dynamic(() => import('../../../components/Container3D').then((m) => m.Container3D), {
  ssr: false,
  loading: () => <div className="tickgrid grid h-72 place-items-center border border-structure font-mono text-sm text-slate sm:h-80">Loading 3D twin…</div>,
});

type Asset = AssetRow & { container_id: string; barcode?: string | null };
interface Container { id: string; type: string; position_2d: string }
interface Crate { id: string; container_id: string; coords: string; temp_zone: string }

const xy = (coords: string) => {
  try { const p = JSON.parse(coords) as { x?: number; y?: number }; return { x: Number(p.x) || 0, y: Number(p.y) || 0 }; } catch { return { x: 0, y: 0 }; }
};
/** Bay "B2" → row 2, column 2. Unparseable bays go on a row of their own at the end. */
const bay = (p: string) => {
  const m = /^([A-Z])(\d+)$/i.exec(p ?? '');
  return m ? { row: m[1].toUpperCase().charCodeAt(0) - 64, col: Number(m[2]) } : null;
};

function FlagMark({ flag, inverse }: { flag?: CrateFlag; inverse?: boolean }) {
  if (flag === 'expired') return <span className={cn('flex items-center gap-1', !inverse && 'text-flare')}><AlertTriangle size={12} aria-hidden />expired</span>;
  if (flag === 'expiring') return <span className={cn('flex items-center gap-1', !inverse && 'text-caution')}><Clock size={12} aria-hidden />expiring</span>;
  return null;
}

export default function LocatePage() {
  const { session, stationLabel, openAsset, prefs } = useField();
  const station = session!.stationId;
  const assetsQ = useLiveQuery(() => db.listAssets(), ['assets', 'crates', 'containers'], [station]);
  const mapQ = useLiveQuery(() => db.stationMap(), ['containers', 'crates'], [station]);
  const lots = useLiveQuery(() => db.stationLots(), ['lots', 'assets'], [station]).data;
  const assets = (assetsQ.data ?? []) as Asset[];
  const containers = (mapQ.data?.containers ?? []) as Container[];
  const crates = (mapQ.data?.crates ?? []) as Crate[];

  const [q, setQ] = useState('');
  const [crate, setCrate] = useState<string | null>(null);
  const [view, setView] = useState('plan');

  // Worst expiry state per asset and per crate, from lots (an asset row only carries its first expiry).
  const { assetFlag, crateFlag } = useMemo(() => {
    const crateOf = new Map(assets.map((a) => [a.id, a.crate_id]));
    const assetFlag: Record<string, CrateFlag> = {};
    const crateFlag: Record<string, CrateFlag> = {};
    for (const l of lots ?? []) {
      const s = expiryStatus(l.expiry_date);
      if (s !== 'expired' && s !== 'expiring') continue;
      const k = crateOf.get(l.asset_id);
      if (assetFlag[l.asset_id] !== 'expired') assetFlag[l.asset_id] = s;
      if (k && crateFlag[k] !== 'expired') crateFlag[k] = s;
    }
    return { assetFlag, crateFlag };
  }, [lots, assets]);

  const term = q.trim().toLowerCase();
  const matches = useMemo(() => (term ? assets.filter((a) => [a.name, a.sku, a.barcode, a.id].some((v) => v && String(v).toLowerCase().includes(term))) : []), [assets, term]);
  const hlCrates = useMemo(() => Array.from(new Set(matches.map((m) => m.crate_id))), [matches]);
  const hlContainers = new Set(matches.map((m) => m.container_id));

  const byCrate = useMemo(() => {
    const m = new Map<string, Asset[]>();
    for (const a of assets) m.set(a.crate_id, [...(m.get(a.crate_id) ?? []), a]);
    return m;
  }, [assets]);

  const loadError = assetsQ.error ?? mapQ.error;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHead eyebrow={`Locate · ${stationLabel}`} title="Where is it?">
        Find which container and crate holds an item. Layout and stock come from this tablet&apos;s records.
      </PageHead>

      {loadError && <ErrorNote>Could not read the store layout: {loadError}</ErrorNote>}

      {!mapQ.data && !loadError ? (
        <p className="font-mono text-sm text-slate">Loading store layout…</p>
      ) : mapQ.data && containers.length === 0 ? (
        <Empty title={`No store containers registered for ${stationLabel} on this tablet`}>
          This station has no containers or crates in the local database yet, so there is nothing to locate. They appear here once they are registered and synced from HQ.
        </Empty>
      ) : (
        <div className={cn('grid gap-6', prefs.drill && 'lg:grid-cols-[1fr_360px]')}>
          <div className="min-w-0 space-y-4">
            <Field label="Find an item" hint="Name, SKU or barcode — matching crates are outlined in both views.">
              {(id) => (
                <div className="relative">
                  <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
                  <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. oxygen, FUEL-DIESEL-001" className="pl-10" autoComplete="off" />
                </div>
              )}
            </Field>

            {term && (
              <section aria-label="Search results" aria-live="polite" className="border border-structure bg-surface">
                <div className="eyebrow border-b border-structure px-4 py-2">{matches.length} match{matches.length === 1 ? '' : 'es'}</div>
                {matches.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-slate">Nothing at {stationLabel} matches &ldquo;{q.trim()}&rdquo;.</p>
                ) : (
                  <ul className="max-h-72 divide-y divide-structure/20 overflow-y-auto scroll-thin">
                    {matches.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => openAsset(a.id)} className="flex min-h-tap w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-canvas">
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink">{a.name}</span>
                            <span className="block font-mono text-xs text-slate">{a.sku}</span>
                          </span>
                          <span className="shrink-0 text-right font-mono text-xs">
                            <span className="block font-semibold text-cobalt">{a.container_id} › {a.crate_id}</span>
                            <span className="num block text-slate">{a.qty} {a.unit}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <Tabs value={view} onValueChange={setView}>
              <TabsList aria-label="View">
                <TabsTrigger value="plan">Store plan</TabsTrigger>
                <TabsTrigger value="3d">3D twin</TabsTrigger>
              </TabsList>

              <TabsContent value="plan" className="space-y-4">
                <StorePlan containers={containers} crates={crates} byCrate={byCrate} crateFlag={crateFlag} hlCrates={hlCrates} hlContainers={hlContainers} selected={crate} onSelect={setCrate} />
                {crate && (
                  <Card>
                    <CardHeader eyebrow={`Crate ${crate} · ${crates.find((k) => k.id === crate)?.temp_zone ?? ''}`} action={
                      <button type="button" onClick={() => setCrate(null)} className="min-h-tap border border-structure/40 px-3 font-mono text-xs font-semibold text-ink hover:border-structure">Close</button>
                    } />
                    {(byCrate.get(crate) ?? []).length ? (
                      <ul className="divide-y divide-structure/20">
                        {(byCrate.get(crate) ?? []).map((a) => (
                          <li key={a.id}>
                            <button type="button" onClick={() => openAsset(a.id)} className="flex min-h-tap w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-canvas">
                              <span className="min-w-0">
                                <span className="block truncate font-medium text-ink">{a.name}</span>
                                <span className="flex items-center gap-2 font-mono text-xs text-slate">{a.sku}<FlagMark flag={assetFlag[a.id]} /></span>
                              </span>
                              <span className="num shrink-0 font-mono text-sm font-semibold text-ink">{a.qty} {a.unit}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <CardContent><p className="text-sm text-slate">No stock recorded in crate {crate}.</p></CardContent>
                    )}
                  </Card>
                )}
              </TabsContent>

              <TabsContent value="3d">
                <ErrorBoundary label="3D twin">
                  <Container3D
                    assets={assets}
                    stationId={station}
                    selectedCrate={crate}
                    onSelectCrate={setCrate}
                    onSelectAsset={openAsset}
                    highlight={hlCrates}
                    flags={crateFlag}
                  />
                </ErrorBoundary>
                <p className="mt-2 text-xs text-slate">If the 3D view won&apos;t draw on this tablet, the Store plan tab shows the same crates.</p>
              </TabsContent>
            </Tabs>
          </div>

          {prefs.drill && <SimFixPanel assets={assets} station={station} />}
        </div>
      )}
    </div>
  );
}

function StorePlan({ containers, crates, byCrate, crateFlag, hlCrates, hlContainers, selected, onSelect }: {
  containers: Container[]; crates: Crate[]; byCrate: Map<string, Asset[]>; crateFlag: Record<string, CrateFlag>;
  hlCrates: string[]; hlContainers: Set<string>; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const placed = containers.map((c) => ({ c, b: bay(c.position_2d) }));
  const cols = Math.max(1, ...placed.map((p) => p.b?.col ?? 1));
  const lastRow = Math.max(0, ...placed.map((p) => p.b?.row ?? 0));
  const hl = new Set(hlCrates);

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-label="Store plan">
      {placed.map(({ c, b }) => {
        const mine = crates.filter((k) => k.container_id === c.id).map((k) => ({ k, p: xy(k.coords) }));
        const w = Math.max(1, ...mine.map((m) => m.p.x + 1));
        return (
          <section
            key={c.id}
            aria-label={`Container ${c.id}, bay ${c.position_2d}`}
            className={cn('border bg-surface', hlContainers.has(c.id) ? 'border-2 border-cobalt' : 'border-structure')}
            style={b ? { gridRow: b.row, gridColumn: b.col } : { gridRow: lastRow + 1 }}
          >
            <header className="flex items-baseline justify-between gap-2 border-b border-structure px-3 py-2">
              <span className="font-mono text-sm font-semibold text-ink">{c.id} <span className="text-slate">· {c.type}</span></span>
              <span className="eyebrow">Bay {c.position_2d}</span>
            </header>
            <div className="tickgrid grid gap-2 p-2" style={{ gridTemplateColumns: `repeat(${w}, minmax(0, 1fr))` }}>
              {mine.length === 0 && <p className="p-2 text-xs text-slate">No crates registered.</p>}
              {mine.map(({ k, p }) => {
                const on = selected === k.id;
                const n = byCrate.get(k.id)?.length ?? 0;
                const flag = crateFlag[k.id];
                return (
                  <button
                    key={k.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSelect(on ? null : k.id)}
                    style={{ gridColumn: p.x + 1, gridRow: p.y + 1 }}
                    className={cn('flex min-h-tap min-w-0 flex-col items-start justify-center border px-2 py-2 text-left',
                      on ? 'border-structure bg-cobalt text-white'
                        : flag === 'expired' ? 'border-2 border-flare bg-surface text-ink'
                        : hl.has(k.id) ? 'border-2 border-cobalt bg-surface text-ink'
                        : flag === 'expiring' ? 'border-2 border-caution bg-surface text-ink'
                        : 'border-structure/40 bg-surface text-ink hover:border-structure')}
                  >
                    <span className="font-mono text-sm font-semibold">{k.id}</span>
                    <span className={cn('flex flex-wrap items-center gap-x-2 font-mono text-xs', on ? 'text-white' : 'text-slate')}>
                      <span><span className="num">{n}</span> item{n === 1 ? '' : 's'}</span>
                      <FlagMark flag={flag} inverse={on} />
                      {hl.has(k.id) && <span className={cn(!on && 'text-cobalt')}>match</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const VIS = { clear: 30, whiteout: 0.8 } as const;
const R = 32; // plot radius, metres

/** Drill-only: SIMULATED LiDAR+camera fixes (no sensor exists on the tablet). Never labelled live. */
function SimFixPanel({ assets, station }: { assets: Asset[]; station: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [vis, setVis] = useState<keyof typeof VIS>('clear');
  const [send, setSend] = useState(false);
  const [fixes, setFixes] = useState<Fix[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const inflight = useRef(false);

  const key = picked.join(',');
  useEffect(() => {
    if (!running || !key) return;
    const ids = key.split(',');
    let alive = true;
    const tick = () => {
      const next = ids.map((id) => fusionStep(id, VIS[vis]));
      setFixes(next);
      if (!send || inflight.current) return; // never stack POSTs behind a slow link
      inflight.current = true;
      Promise.all(next.map((f) => hq('/tracking/update', { method: 'POST', body: JSON.stringify({ asset_id: f.id, x: f.x, y: f.y, theta: 0, conf: f.conf, station_id: station }) })))
        .then(() => { if (alive) setStatus({ ok: true, msg: `Sent ${next.length} simulated fix${next.length === 1 ? '' : 'es'} to HQ at ${new Date().toLocaleTimeString()}` }); })
        .catch((e) => { if (alive) setStatus({ ok: false, msg: e instanceof ApiError && e.offline ? 'HQ unreachable — fixes not sent' : `HQ rejected fix: ${(e as Error).message}` }); })
        .finally(() => { inflight.current = false; });
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [running, key, vis, send, station]);

  const name = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
  const shown = fixes.filter((f) => picked.includes(f.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));

  return (
    <Card className="h-fit">
      <CardHeader eyebrow="Drill · simulated LiDAR fix" action={<Badge>SIM</Badge>}>
        <p className="mt-1 text-xs text-slate">No LiDAR or camera is fitted to this tablet. These positions are generated for drills and are not a real location.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="eyebrow mb-2">Track up to 3 items ({picked.length}/3)</div>
          <div className="max-h-48 space-y-1 overflow-y-auto scroll-thin">
            {assets.map((a) => {
              const on = picked.includes(a.id);
              return (
                <button key={a.id} type="button" aria-pressed={on} disabled={!on && picked.length >= 3} onClick={() => toggle(a.id)}
                  className={cn('flex min-h-tap w-full items-center justify-between gap-2 border px-3 text-left text-sm disabled:opacity-40',
                    on ? 'border-structure bg-cobalt text-white' : 'border-structure/40 bg-surface text-ink hover:border-structure')}>
                  <span className="truncate">{a.name}</span>
                  <span className="shrink-0 font-mono text-xs">{on ? 'tracking' : a.crate_id}</span>
                </button>
              );
            })}
          </div>
        </div>

        <Toggle checked={running} onChange={setRunning} label="Run simulated fix" description={picked.length ? 'New fix every 2 s' : 'Pick at least one item first'} />
        <Segmented label="Visibility" value={vis} onChange={setVis} options={[{ value: 'clear', label: 'Clear 30 m' }, { value: 'whiteout', label: 'Whiteout 0.8 m' }]} />

        <figure className="border border-structure bg-canvas">
          <svg viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} className="block aspect-square w-full" role="img" aria-label={`Polar plot of ${shown.length} simulated fixes around this tablet, 10 m rings`}>
            {[10, 20, 30].map((r) => <circle key={r} r={r} fill="none" className="stroke-structure/30" strokeWidth={0.2} />)}
            <line x1={-R} x2={R} y1={0} y2={0} className="stroke-structure/30" strokeWidth={0.2} />
            <line y1={-R} y2={R} x1={0} x2={0} className="stroke-structure/30" strokeWidth={0.2} />
            {[10, 20, 30].map((r) => <text key={r} x={0.8} y={-r + 2.2} fontSize={2} className="fill-slate font-mono">{r} m</text>)}
            <rect x={-0.9} y={-0.9} width={1.8} height={1.8} className="fill-ink" />
            {shown.map((f, i) => {
              const x = Math.max(-R + 2, Math.min(R - 2, f.x));
              const y = Math.max(-R + 2, Math.min(R - 2, -f.y));
              return (
                <g key={f.id}>
                  <rect x={x - 1.4} y={y - 1.4} width={2.8} height={2.8} className="fill-slate stroke-ink" strokeWidth={0.2} />
                  <text x={x + 2} y={y + 0.8} fontSize={2.4} className="fill-ink font-mono">{i + 1}</text>
                </g>
              );
            })}
          </svg>
          <figcaption className="border-t border-structure px-3 py-2 font-mono text-xs text-slate">Local frame · tablet at centre · {vis === 'whiteout' ? 'camera blind, LiDAR only' : 'LiDAR 70% + camera 30%'}</figcaption>
        </figure>

        {shown.length > 0 && (
          <ol className="space-y-1">
            {shown.map((f, i) => (
              <li key={f.id} className="flex items-center justify-between gap-2 border border-structure/40 px-3 py-2 font-mono text-xs">
                <span className="min-w-0 truncate text-ink">{i + 1}. {name(f.id)}</span>
                <span className="num shrink-0 text-slate">[{f.x.toFixed(1)}, {f.y.toFixed(1)}] m · conf {Math.round(f.conf * 100)}%</span>
              </li>
            ))}
          </ol>
        )}

        <Toggle checked={send} onChange={(v) => { setSend(v); setStatus(null); }} label="Send fixes to HQ tracking (drill)" description="Posts each simulated fix to HQ — off unless you are exercising the HQ tracking board" />
        {send && (
          <p role="status" className={cn('border px-3 py-2 text-xs', status && !status.ok ? 'border-flare bg-flare/10 text-ink' : 'border-structure/40 text-slate')}>
            {status ? <>{!status.ok && <span className="font-mono font-semibold text-flare">NOT SENT · </span>}{status.msg}</> : running ? 'Waiting for next fix…' : 'Start the simulated fix to send.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
