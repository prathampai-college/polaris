'use client';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, Clock, Database, Layers, Package, RadioTower, RefreshCw, Send, Tablet, XCircle } from 'lucide-react';
import { useField } from '../../../lib/field-context';
import { db, useLiveQuery } from '../../../lib/db/client';
import { hq, ApiError } from '../../../lib/api';
import { Card, CardHeader, CardContent, PageHead, Empty, ErrorNote } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { HoldButton } from '../../../components/ui/hold-button';
import { Segmented, Toggle } from '../../../components/ui/field';
import { ago, cn } from '../../../lib/utils';
import { LINK, LinkPanel, DtnPanel, type Bundle, type Tone } from './panels';

type Frame = {
  ulid: string; entity: string; entity_id: string; op: string; status: 'PENDING' | 'SENT' | 'BUNDLED' | 'FAILED' | 'ACKED';
  retry_count: number; created_at: string; last_error: string | null; patch: Record<string, unknown> | null;
};

const ENTITY: Record<string, string> = {
  assets: 'Stock', lots: 'Stock lot', transactions: 'Stock', indents: 'Indent', personnel: 'Muster', field_sorties: 'Sortie',
  emergencies: 'Emergency', manifests: 'Manifest', expeditions: 'Expedition',
};
const SKIP = new Set(['updated_at', 'version', 'vector_clock', 'id']);

function summary(p: Record<string, unknown> | null): string {
  if (!p) return 'payload unreadable';
  const parts = Object.entries(p).filter(([k, v]) => !SKIP.has(k) && v != null && v !== '').slice(0, 4).map(([k, v]) => {
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `${k}=${s.length > 22 ? `${s.slice(0, 21)}…` : s}`;
  });
  return parts.join('  ') || '—';
}

function StatusBadge({ f }: { f: Frame }) {
  if (f.status === 'FAILED') return <Badge variant="critical"><XCircle size={12} aria-hidden />Failed</Badge>;
  if (f.status === 'ACKED') return <Badge variant="ok"><CheckCircle2 size={12} aria-hidden />Acked</Badge>;
  if (f.status === 'SENT') return <Badge><Send size={12} aria-hidden />Sent · awaiting ACK</Badge>;
  if (f.status === 'BUNDLED') return <Badge><Package size={12} aria-hidden />Bundled · DTN</Badge>;
  if (f.last_error) return <Badge variant="caution"><RefreshCw size={12} aria-hidden />Retry · backoff</Badge>;
  return <Badge><Clock size={12} aria-hidden />Queued</Badge>;
}

// ---------------------------------------------------------------- custody ledger

interface Seg { label: string; tone: Tone; dashed: boolean; pulse?: boolean }
const LINE: Record<Tone, string> = { phosphor: 'border-phosphor', slate: 'border-slate', caution: 'border-caution', flare: 'border-flare', ink: 'border-ink' };
const TEXT: Record<Tone, string> = { phosphor: 'text-ink', slate: 'text-slate', caution: 'text-caution', flare: 'text-flare', ink: 'text-ink' };

function Hop({ seg, from, to }: { seg: Seg; from: string; to: string }) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center gap-1 px-0.5 sm:w-20" role="img" aria-label={`${from} to ${to}: ${seg.label}`}>
      <span className="flex w-full items-center">
        <span className={cn('block flex-1 border-t-2', LINE[seg.tone], seg.dashed && 'border-dashed', seg.pulse && 'animate-blink')} />
        <ChevronRight size={14} aria-hidden className={cn('-ml-1.5', TEXT[seg.tone])} />
      </span>
      <span className={cn('text-center font-mono text-xs font-semibold leading-tight tracking-[0.04em]', TEXT[seg.tone])}>{seg.label}</span>
    </div>
  );
}

function Node({ icon: Icon, name, count, unit, sub, alert }: { icon: typeof Tablet; name: string; count: number | undefined; unit: string; sub: React.ReactNode; alert?: boolean }) {
  return (
    <div className={cn('min-w-0 flex-1 border bg-surface p-3', alert ? 'border-flare' : 'border-structure')}>
      <div className="eyebrow flex items-center gap-1.5 truncate"><Icon size={14} aria-hidden className="shrink-0" />{name}</div>
      <div className="num mt-2 font-mono text-4xl font-semibold leading-none text-ink">{count ?? '—'}</div>
      <div className="mt-1 font-mono text-xs uppercase tracking-[0.06em] text-slate">{unit}</div>
      <div className="mt-2 border-t border-structure/30 pt-2 text-xs text-slate">{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------- page

export default function CommsPage() {
  const { session, stationLabel, sync, outbox, storage, prefs, toast } = useField();
  const station = session!.stationId;
  const frames = useLiveQuery(() => db.listOutbox(100) as Promise<Frame[]>, ['outbox', 'dtn_bundles'], [station]);
  const bundles = useLiveQuery(() => db.listBundles() as Promise<Bundle[]>, ['outbox', 'dtn_bundles'], [station]).data;
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [pulling, setPulling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, []);

  const live = sync.link === 'live';
  const unsynced = outbox?.unsynced ?? 0;
  const failed = outbox?.FAILED ?? 0;
  const retrying = (frames.data ?? []).filter((f) => f.status === 'PENDING' && f.last_error).length;
  const carrying = (bundles ?? []).filter((b) => b.src !== session!.deviceId).length;
  const shown = useMemo(() => (frames.data ?? []).filter((f) => filter === 'all' || f.status !== 'ACKED'), [frames.data, filter]);

  const title = sync.link === 'cut' ? 'Link cut (drill).'
    : sync.link === 'key_mismatch' ? <em className="not-italic text-flare">Key rejected.</em>
    : live ? 'Live to HQ.'
    : unsynced > 0 ? <>Holding {unsynced} change{unsynced === 1 ? '' : 's'}.</>
    : sync.link === 'connecting' ? 'Connecting to gateway.'
    : 'No link. Nothing waiting.';

  const segs: [Seg, Seg, Seg] = [
    live ? { label: 'BYPASSED', tone: 'slate', dashed: true }
      : { label: (outbox?.BUNDLED ?? 0) > 0 ? 'STORE-FWD' : 'STANDBY', tone: (outbox?.BUNDLED ?? 0) > 0 ? 'ink' : 'slate', dashed: (outbox?.BUNDLED ?? 0) === 0 },
    { label: LINK[sync.link].label, tone: LINK[sync.link].tone, dashed: !live, pulse: LINK[sync.link].pulse },
    !live ? { label: 'UNKNOWN', tone: 'slate', dashed: true }
      : retrying > 0 ? { label: 'HQ BUSY', tone: 'caution', dashed: true }
      : { label: 'LIVE', tone: 'phosphor', dashed: false },
  ];

  const retryAll = async () => {
    try { const n = await db.retryFailed(); toast(`${n} frame${n === 1 ? '' : 's'} re-queued for HQ`, 'ok'); }
    catch (e) { toast((e as Error).message, 'alert'); }
  };
  const retryOne = async (f: Frame) => {
    try { await db.retryOne(f.ulid); toast(`Re-queued ${ENTITY[f.entity] ?? f.entity} · ${f.op}`, 'ok'); }
    catch (e) { toast((e as Error).message, 'alert'); }
  };
  const discard = async (f: Frame) => {
    try { await db.discardFailed(f.ulid); toast(`Discarded ${ENTITY[f.entity] ?? f.entity} · ${f.op} — logged in audit`, 'info'); }
    catch (e) { toast((e as Error).message, 'alert'); }
  };
  const sendNow = async () => { await db.syncNow(); toast('Sending queued frames now', 'info'); };
  const pullStock = async () => {
    setPulling(true);
    try {
      const rows = await hq<Record<string, unknown>[]>('/assets');
      const mine = rows.filter((r) => r.station_id === station);
      const { applied, skipped } = await db.mergeFromHQ({ entity: 'assets', rows: mine });
      toast(`Stock register: ${applied} updated from HQ${skipped ? ` · ${skipped} kept local (unsynced edits win)` : ''}`, 'ok');
    } catch (e) {
      toast(e instanceof ApiError && e.offline ? 'HQ unreachable — stock register not pulled. Local stock is unchanged.' : `Pull failed: ${(e as Error).message}`, 'alert');
    } finally {
      setPulling(false);
    }
  };
  const cut = async (v: boolean) => {
    try { await db.cutLink(v); toast(v ? 'Drill: satellite link cut on this tablet' : 'Drill: link restored — reconnecting', 'info'); }
    catch (e) { toast((e as Error).message, 'alert'); }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHead
        eyebrow={`Comms · ${stationLabel}`}
        title={title}
        action={<>
          <Button onClick={sendNow} disabled={!live} title={live ? undefined : 'Needs a live link'}><Send size={16} aria-hidden />Send now</Button>
          <Button variant="ghost" onClick={pullStock} disabled={pulling}><Database size={16} aria-hidden />{pulling ? 'Pulling…' : 'Pull stock register'}</Button>
        </>}
      >
        Every change is saved on this tablet first, then carried to HQ over the best path available. Nothing leaves the ledger until HQ acknowledges it.
      </PageHead>

      <Card>
        <CardHeader eyebrow="Custody ledger" action={<span className="font-mono text-xs text-slate">last ACK {ago(outbox?.lastAckAt, now)}</span>} />
        <CardContent className="tickgrid">
          <div className="overflow-x-auto scroll-thin"><div className="flex min-w-[560px] items-stretch">
            <Node icon={Tablet} name="This tablet" count={outbox?.PENDING} unit="queued"
              alert={failed > 0 || storage.state === 'memory'}
              sub={failed > 0 ? <span className="text-flare">{failed} failed — needs you</span> : storage.state === 'memory' ? <span className="text-flare">in memory only</span> : 'saved on disk'} />
            <Hop seg={segs[0]} from="This tablet" to="Mesh / QR" />
            <Node icon={Layers} name="Mesh / QR" count={outbox?.BUNDLED} unit="bundled" sub={`${carrying} carried for others`} />
            <Hop seg={segs[1]} from="Mesh / QR" to="Camp gateway" />
            <Node icon={RadioTower} name="Gateway" count={outbox?.SENT} unit="in flight" sub="resent if no ACK in 15 s" />
            <Hop seg={segs[2]} from="Camp gateway" to="HQ" />
            <Node icon={CheckCircle2} name="HQ" count={outbox?.ACKED} unit="acked" sub="applied exactly once" />
          </div></div>
          <p className="mt-3 max-w-3xl text-xs text-slate">
            Live link: frames go straight from this tablet to the gateway over an AES-GCM encrypted WebSocket. No link: they are sealed into DTN bundles that any tablet on the mesh, or a QR hand-off, can carry to a live gateway. Bundles carried for other tablets relay automatically when the link returns.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-label="Outbox frames" className="min-w-0">
          <Card>
            <CardHeader eyebrow="Frames" action={
              <div className="flex flex-wrap items-center gap-2">
                {failed > 0 && <Button size="sm" onClick={retryAll}><RefreshCw size={14} aria-hidden />Retry all failed ({failed})</Button>}
                <div className="w-40"><Segmented label="Show frames" value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'all', label: 'All' }]} /></div>
              </div>
            } />
            {frames.error && <div className="p-4"><ErrorNote>{frames.error}</ErrorNote></div>}
            {frames.loading ? <p className="p-4 font-mono text-xs text-slate">Loading…</p> : shown.length === 0 ? (
              <div className="p-4"><Empty title={filter === 'open' ? 'Nothing waiting — every change has reached HQ.' : 'No frames on this tablet yet.'}>Switch to All to see acknowledged history.</Empty></div>
            ) : (
              <ul>
                {shown.map((f) => (
                  <li key={f.ulid} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-structure/30 px-4 py-3 last:border-b-0', f.status === 'FAILED' && 'bg-flare/5', f.status === 'ACKED' && 'opacity-70')}>
                    <div className="min-w-0 flex-1 basis-60">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium text-ink">{ENTITY[f.entity] ?? f.entity} · {f.op}</span>
                        <span className="font-mono text-xs text-slate">{f.entity_id}</span>
                      </div>
                      <div className="truncate font-mono text-xs text-slate" title={f.patch ? JSON.stringify(f.patch) : undefined}>{summary(f.patch)}</div>
                      {f.last_error && (f.status === 'FAILED' || f.status === 'PENDING') && (
                        <div className={cn('mt-1 text-xs', f.status === 'FAILED' ? 'text-flare' : 'text-caution')}>{f.last_error}</div>
                      )}
                    </div>
                    <div className="num flex items-center gap-3 font-mono text-xs text-slate">
                      <span>{ago(f.created_at, now)}</span>
                      {f.retry_count > 0 && <span>{f.retry_count}× sent</span>}
                    </div>
                    <StatusBadge f={f} />
                    {f.status === 'FAILED' && (
                      <Button variant="ghost" size="sm" onClick={() => retryOne(f)}>Retry</Button>
                    )}
                    {f.status === 'FAILED' && (
                      <HoldButton label={`Discard ${ENTITY[f.entity] ?? f.entity} ${f.op} frame`} onConfirm={() => discard(f)} className="text-xs">Hold · discard</HoldButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>

        <aside className="min-w-0 space-y-4">
          <LinkPanel now={now} />
          <DtnPanel bundles={bundles} now={now} />
          {prefs.drill && (
            <Card>
              <CardHeader eyebrow="Drill" />
              <CardContent className="space-y-2">
                <Toggle checked={sync.link === 'cut'} onChange={cut} label="Cut satellite link" description="Simulated on this tablet only — the gateway and HQ keep running. Watch changes move to DTN custody." />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
