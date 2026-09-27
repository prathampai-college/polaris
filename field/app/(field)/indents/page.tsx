'use client';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Clock, PackageCheck, PackagePlus, RefreshCw, Ship } from 'lucide-react';
import { useField } from '../../../lib/field-context';
import { db, useLiveQuery } from '../../../lib/db/client';
import { hq, ApiError } from '../../../lib/api';
import { Card, CardHeader, CardContent, PageHead, Empty, ErrorNote } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Field, Select, Stepper, Segmented } from '../../../components/ui/field';
import { Tabs, TabsList, TabsTrigger } from '../../../components/ui/tabs';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { ago, clock, cn } from '../../../lib/utils';

type Urgency = 'LOW' | 'MEDIUM' | 'CRITICAL';
type Group = 'inbound' | 'awaiting' | 'closed';
const STAGES = ['DRAFT', 'APPROVED', 'DISPATCHED', 'RECEIVED'] as const;

interface Indent {
  id: string; asset_id: string; sku?: string | null; name?: string | null; unit?: string | null; vessel_imo?: string | null;
  status: string; urgency?: string | null; qty_requested: number; created_at?: string | null; created_by?: string | null;
}
interface Asset { id: string; sku: string; name: string; qty: number; unit: string }

// Anything HQ invents beyond the four stages is still HQ's move, so it lands in "Awaiting HQ".
const groupOf = (s: string): Group => (s === 'DISPATCHED' ? 'inbound' : s === 'RECEIVED' ? 'closed' : 'awaiting');

function Track({ status }: { status: string }) {
  const at = STAGES.indexOf(status as (typeof STAGES)[number]);
  return (
    <ol className="grid grid-cols-4 gap-1" aria-label={at >= 0 ? `Stage ${at + 1} of 4: ${status}` : `Status ${status}`}>
      {STAGES.map((s, i) => (
        <li key={s} aria-current={i === at ? 'step' : undefined} className="min-w-0">
          <div className={cn('h-2 border',
            i === at ? (s === 'RECEIVED' ? 'border-structure bg-ink' : 'border-structure bg-cobalt')
              : i < at ? 'border-structure/40 bg-structure/25' : 'border-structure/40')} />
          <div className={cn('mt-1 truncate font-mono text-xs uppercase tracking-[0.06em]', i === at ? 'font-semibold text-ink' : 'text-slate')}>{s}</div>
        </li>
      ))}
    </ol>
  );
}

function NextStep({ ind }: { ind: Indent }) {
  const g = groupOf(ind.status);
  if (g === 'inbound') return <span className="flex items-center gap-1.5 text-sm text-ink"><Ship size={16} aria-hidden />Inbound — confirm on arrival{ind.vessel_imo && <span className="font-mono text-slate">· IMO {ind.vessel_imo}</span>}</span>;
  if (g === 'closed') return <span className="flex items-center gap-1.5 text-sm text-slate"><CheckCircle2 size={16} aria-hidden />Closed</span>;
  return <span className="flex items-center gap-1.5 text-sm text-caution"><Clock size={16} aria-hidden />Awaiting HQ{ind.status !== 'DRAFT' && ind.status !== 'APPROVED' && <span className="font-mono">· {ind.status}</span>}</span>;
}

function IndentRow({ ind, now, onReceive }: { ind: Indent; now: number; onReceive: (i: Indent) => void }) {
  return (
    <li className="border border-structure bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <div className="font-medium text-ink">{ind.name ?? ind.asset_id}</div>
          <div className="font-mono text-xs text-slate">
            {ind.sku ?? '—'} · #{ind.id.slice(-6)} · {clock(ind.created_at)} ({ago(ind.created_at, now)}){ind.created_by ? ` · ${ind.created_by}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ind.urgency === 'CRITICAL'
            ? <Badge variant="critical"><AlertTriangle size={12} aria-hidden />Critical</Badge>
            : <Badge>{ind.urgency ?? '—'}</Badge>}
          <span className="num font-mono text-xl font-semibold text-ink">{ind.qty_requested}<span className="ml-1 text-sm font-normal text-slate">{ind.unit ?? ''}</span></span>
        </div>
      </div>
      <div className="px-4 py-3"><Track status={ind.status} /></div>
      <div className="flex min-h-tap flex-wrap items-center justify-between gap-2 border-t border-structure/40 px-4 py-2">
        <NextStep ind={ind} />
        {ind.status === 'DISPATCHED' && (
          <Button size="sm" onClick={() => onReceive(ind)}><PackageCheck size={16} aria-hidden />Mark received</Button>
        )}
      </div>
    </li>
  );
}

function IndentsScreen() {
  const { session, stationLabel, toast } = useField();
  const station = session!.stationId;
  const indentsQ = useLiveQuery(() => db.listIndents() as Promise<Indent[]>, ['indents'], [station]);
  const assets = useLiveQuery(() => db.listAssets() as Promise<Asset[]>, ['assets'], [station]).data;
  const indents = indentsQ.data;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const groups = useMemo(() => {
    const g: Record<Group, Indent[]> = { inbound: [], awaiting: [], closed: [] };
    for (const i of indents ?? []) g[groupOf(i.status)].push(i);
    return g;
  }, [indents]);
  const [tab, setTab] = useState<Group | null>(null);
  const shown: Group = tab ?? (groups.inbound.length ? 'inbound' : groups.awaiting.length ? 'awaiting' : 'inbound');
  const open = groups.inbound.length + groups.awaiting.length;

  // ---- create form, prefilled from AssetSheet's /indents?asset=<id>
  const params = useSearchParams();
  const wanted = params.get('asset');
  const [assetId, setAssetId] = useState('');
  const [qty, setQty] = useState(1);
  const [urgency, setUrgency] = useState<Urgency>('MEDIUM');
  const [busy, setBusy] = useState(false);
  const [prefillMiss, setPrefillMiss] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    if (!wanted || !assets || prefilled.current === wanted) return;
    prefilled.current = wanted;
    if (!assets.some((a) => a.id === wanted)) { setPrefillMiss(wanted); return; }
    setAssetId(wanted);
    setPrefillMiss(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    selectRef.current?.focus({ preventScroll: true });
  }, [wanted, assets]);
  const asset = assets?.find((a) => a.id === assetId);

  const create = async () => {
    if (!asset) return;
    setBusy(true);
    try {
      await db.createIndent({ assetId: asset.id, qty, urgency });
      toast('Indent queued — reaches HQ on next sync', 'ok');
      setQty(1);
      setUrgency('MEDIUM');
    } catch (e) {
      toast((e as Error).message, 'alert');
    } finally {
      setBusy(false);
    }
  };

  // ---- receive dialog
  const [receiving, setReceiving] = useState<Indent | null>(null);
  const [recvQty, setRecvQty] = useState(0);
  const startReceive = (i: Indent) => { setReceiving(i); setRecvQty(Number(i.qty_requested)); };
  const receive = async () => {
    if (!receiving) return;
    setBusy(true);
    try {
      const r = await db.receiveIndent({ indentId: receiving.id, receivedQty: recvQty });
      toast(r
        ? `Received ${recvQty} ${r.unit} — ${r.sku} now ${r.newQty} ${r.unit} on hand`
        : `Indent closed — no stock booked (${recvQty > 0 ? 'item not held on this tablet' : 'zero received'})`, 'ok');
      setReceiving(null);
    } catch (e) {
      toast((e as Error).message, 'alert');
    } finally {
      setBusy(false);
    }
  };

  // ---- pull HQ's copy
  const [pulling, setPulling] = useState(false);
  const [pulledAt, setPulledAt] = useState<string | null>(null);
  const refresh = async () => {
    setPulling(true);
    try {
      const rows = await hq<Record<string, unknown>[]>(`/indents?station_id=${encodeURIComponent(station)}`);
      const { applied, skipped } = await db.mergeFromHQ({ entity: 'indents', rows });
      setPulledAt(new Date().toISOString());
      toast(`From HQ: ${applied} applied · ${skipped} skipped${skipped ? ' (unsynced local edits kept)' : ''}`, 'ok');
    } catch (e) {
      toast(e instanceof ApiError && e.offline ? "HQ unreachable — showing this tablet's copy" : (e as Error).message, 'alert');
    } finally {
      setPulling(false);
    }
  };

  const list = groups[shown];
  const emptyCopy: Record<Group, [string, string]> = {
    inbound: ['Nothing inbound.', 'Indents appear here once HQ dispatches them. Confirm each one when it lands to add the stock.'],
    awaiting: ['Nothing waiting on HQ.', 'New indents from this tablet sit here until HQ approves and dispatches them.'],
    closed: ['No closed indents yet.', 'Received indents are kept here as a record.'],
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHead
        eyebrow={`Resupply · ${stationLabel}`}
        title={!indents ? 'Loading…' : open === 0 ? 'Pipeline clear.' : <>{open} in the pipeline.</>}
        action={
          <Button variant="outline" onClick={refresh} disabled={pulling}>
            <RefreshCw size={16} aria-hidden className={cn(pulling && 'animate-spin')} />Refresh from HQ
          </Button>
        }
      >
        HQ approves and dispatches; this tablet raises indents and confirms arrival.
        {pulledAt ? ` HQ copy pulled ${ago(pulledAt, now)}.` : ' Showing this tablet’s copy.'}
      </PageHead>

      {indentsQ.error && <ErrorNote>Could not read indents: {indentsQ.error}</ErrorNote>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section aria-label="Indent pipeline" className="min-w-0 space-y-4">
          <Tabs value={shown} onValueChange={(v) => setTab(v as Group)}>
            <TabsList aria-label="Filter indents">
              <TabsTrigger value="inbound">Inbound · {groups.inbound.length}</TabsTrigger>
              <TabsTrigger value="awaiting">Awaiting HQ · {groups.awaiting.length}</TabsTrigger>
              <TabsTrigger value="closed">Closed · {groups.closed.length}</TabsTrigger>
            </TabsList>
          </Tabs>
          {indents && list.length === 0 && <Empty title={emptyCopy[shown][0]}>{emptyCopy[shown][1]}</Empty>}
          <ul className="space-y-2">
            {list.map((i) => <IndentRow key={i.id} ind={i} now={now} onReceive={startReceive} />)}
          </ul>
        </section>

        <aside className="lg:sticky lg:top-4 lg:self-start" ref={formRef}>
          <Card>
            <CardHeader eyebrow="New indent" title="Request resupply" />
            <CardContent className="space-y-4">
              <Field label="Item" error={prefillMiss ? `Item ${prefillMiss} isn't held at this station — pick one below.` : null}
                hint={assets && assets.length === 0 ? 'No stock lines on this tablet yet.' : undefined}>
                {(id) => (
                  <Select id={id} ref={selectRef} value={assetId} onChange={(e) => setAssetId(e.target.value)} disabled={!assets}>
                    <option value="">{assets ? 'Select item…' : 'Loading stock…'}</option>
                    {assets?.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.qty} {a.unit} on hand</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Quantity" hint={asset ? `${asset.sku} · ${asset.qty} ${asset.unit} on hand now` : undefined}>
                {(id) => <Stepper id={id} value={qty} onChange={setQty} unit={asset?.unit} />}
              </Field>
              <div className="space-y-1.5">
                <div className="eyebrow">Urgency</div>
                <Segmented<Urgency> label="Urgency" value={urgency} onChange={setUrgency}
                  options={[{ value: 'LOW', label: 'Low' }, { value: 'MEDIUM', label: 'Medium' }, { value: 'CRITICAL', label: 'Critical', tone: 'flare' }]} />
              </div>
              <Button className="w-full" size="lg" onClick={create} disabled={!asset || busy || !(qty > 0)}>
                <PackagePlus size={18} aria-hidden />Queue indent
              </Button>
              <p className="text-xs text-slate">Saved on this tablet first. It reaches HQ on the next sync, even if the link is down now.</p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <Dialog open={!!receiving} onOpenChange={(o) => { if (!o && !busy) setReceiving(null); }}>
        <DialogContent>
          {receiving && (
            <div className="space-y-4">
              <DialogTitle>Mark received</DialogTitle>
              <DialogDescription className="text-sm text-slate">
                {receiving.name ?? receiving.asset_id} · requested {receiving.qty_requested} {receiving.unit ?? ''}
                {receiving.vessel_imo ? ` · vessel IMO ${receiving.vessel_imo}` : ''}.
                Count what actually arrived — that amount is added to station stock as a new lot, and the indent closes.
              </DialogDescription>
              <Field label="Received quantity" hint={recvQty !== Number(receiving.qty_requested) ? `Differs from the ${receiving.qty_requested} requested — only the amount entered here is added to stock.` : undefined}>
                {(id) => <Stepper id={id} value={recvQty} onChange={setRecvQty} min={0} unit={receiving.unit ?? undefined} />}
              </Field>
              {recvQty === 0 && <p className="border border-caution bg-caution/10 px-3 py-2 text-sm text-ink">Zero received: the indent closes and no stock is added.</p>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" onClick={() => setReceiving(null)} disabled={busy}>Cancel</Button>
                <Button onClick={receive} disabled={busy}><PackageCheck size={16} aria-hidden />Confirm {recvQty} {receiving.unit ?? ''} received</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function IndentsPage() {
  return (
    <Suspense fallback={<div className="font-mono text-sm text-slate">Loading indents…</div>}>
      <IndentsScreen />
    </Suspense>
  );
}
