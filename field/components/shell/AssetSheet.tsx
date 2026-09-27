'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, History, Layers, PackagePlus } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Field, Input, Segmented, Stepper, Toggle } from '../ui/field';
import { useField } from '../../lib/field-context';
import { db, useLiveQuery } from '../../lib/db/client';
import { clock, cn, haptic } from '../../lib/utils';
import { expiryStatus } from '@polaris/shared/expiry';
import { categoryLabel } from '../../lib/labels';

type Tx = 'CONSUME' | 'OUT' | 'IN' | 'ADJUST';
const VERB: Record<Tx, string> = { CONSUME: 'Consume', OUT: 'Issue out', IN: 'Receive in', ADJUST: 'Correct count' };

export function ExpiryBadge({ date }: { date: string | null }) {
  const s = expiryStatus(date);
  if (s === 'no_expiry') return null;
  if (s === 'expired') return <Badge variant="critical"><AlertTriangle size={12} aria-hidden />Expired {date}</Badge>;
  if (s === 'expiring') return <Badge variant="caution">Expires {date}</Badge>;
  return <Badge>Exp {date}</Badge>;
}

/** Global asset detail + transaction sheet — opened from Brief, Stock, Scan and the keyboard-wedge scanner. */
export function AssetSheet() {
  const { assetId, openAsset, session, toast, prefs } = useField();
  const { data, error } = useLiveQuery(() => (assetId ? db.getAsset(assetId) : Promise.resolve(null)), ['assets', 'lots', 'transactions', 'outbox'], [assetId]);
  const [type, setType] = useState<Tx>('CONSUME');
  const [qty, setQty] = useState(1);
  const [down, setDown] = useState(true);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setType('CONSUME'); setQty(1); setOverride(false); setReason(''); setDown(true); }, [assetId]);

  const a = data?.asset;
  const lead = session?.role === 'STATION_LEAD';
  const hasExpired = (data?.lots ?? []).some((l) => l.qty > 0 && expiryStatus(l.expiry_date) === 'expired');
  const offStation = a && session && a.station_id && a.station_id !== session.stationId;
  const signed = type === 'ADJUST' ? (down ? -qty : qty) : type === 'IN' ? qty : -qty;

  async function submit() {
    if (!a) return;
    if (type === 'ADJUST' && !reason.trim()) { toast('A count correction needs a reason', 'alert'); return; }
    setBusy(true);
    try {
      const r = await db.recordTx({ assetId: a.id, type, qty: type === 'ADJUST' ? signed : qty, overrideExpired: override && lead, reason: reason.trim() || undefined });
      haptic(30);
      toast(`${VERB[type]} ${Math.abs(r.delta)} ${r.unit} · ${r.sku} → ${r.newQty} ${r.unit}${prefs.drill ? ' (DRILL)' : ''}`, 'ok');
      setQty(1); setReason(''); setOverride(false);
    } catch (e) {
      haptic([80, 60, 80]);
      toast((e as Error).message, 'alert');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!assetId} onOpenChange={(o) => !o && openAsset(null)}>
      <SheetContent side="right" className="p-0">
        {error && <p className="p-5 text-flare">{error}</p>}
        {assetId && data === null && <p className="p-5 text-slate">No asset with id {assetId} on this tablet.</p>}
        {a && (
          <>
            <div className="border-b border-structure p-5 pr-16">
              <div className="eyebrow">{a.sku} · {categoryLabel(a.category)}</div>
              <SheetTitle className="mt-1 font-display text-3xl leading-tight text-ink">{a.name}</SheetTitle>
              <SheetDescription className="sr-only">Stock detail and transactions</SheetDescription>
              <div className="mt-4 flex items-end gap-3">
                <span className="num font-mono text-5xl font-semibold leading-none text-ink">{a.qty}</span>
                <span className="pb-1 font-mono text-lg text-slate">{a.unit}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {a.criticality === 'CRITICAL' && <Badge variant="solid">Critical supply</Badge>}
                <ExpiryBadge date={a.expiry_date} />
                <Badge>{a.container_id ?? '—'} / {a.crate_id} · {a.temp_zone}</Badge>
                {data.pending > 0 && <Badge variant="active">{data.pending} change{data.pending > 1 ? 's' : ''} awaiting HQ</Badge>}
              </div>
              {offStation && <p className="mt-3 border border-caution bg-caution/10 px-3 py-2 text-sm text-ink">Registered to <b>{a.station_id}</b>, not your station. Check the crate label before moving stock.</p>}
            </div>

            <div className="space-y-4 border-b border-structure p-5">
              <Segmented<Tx> label="Transaction type" value={type} onChange={setType}
                options={[{ value: 'CONSUME', label: 'Consume' }, { value: 'OUT', label: 'Issue' }, { value: 'IN', label: 'Receive' }, { value: 'ADJUST', label: 'Correct' }]} />
              {type === 'ADJUST' && (
                <Segmented<'down' | 'up'> label="Correction direction" value={down ? 'down' : 'up'} onChange={(v) => setDown(v === 'down')}
                  options={[{ value: 'down', label: '− Less than recorded' }, { value: 'up', label: '+ More than recorded' }]} />
              )}
              <Field label="Quantity">{(id) => <Stepper id={id} value={qty} onChange={setQty} unit={a.unit} max={type === 'IN' || (type === 'ADJUST' && !down) ? 99999 : Math.max(1, a.qty)} />}</Field>
              {type === 'ADJUST' && <Field label="Reason (audited)">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. monthly stock-take, spillage" />}</Field>}
              {type === 'CONSUME' && hasExpired && (lead
                ? <Toggle checked={override} onChange={setOverride} label="Override: allow expired lots" description="Station-lead decision, recorded in the audit log" />
                : <p className="border border-caution bg-caution/10 px-3 py-2 text-sm">Some lots are expired and will be skipped. Using them needs a station-lead session.</p>)}
              <Button size="lg" className={cn('w-full', signed < 0 && type !== 'ADJUST' && 'bg-ink')} disabled={busy || qty <= 0} onClick={submit}>
                {VERB[type]} {signed > 0 ? '+' : '−'}{qty} {a.unit}
              </Button>
              <Link href={`/indents?asset=${a.id}`} onClick={() => openAsset(null)} className="flex min-h-tap items-center justify-center gap-2 border border-structure font-mono text-sm font-semibold text-ink hover:bg-structure hover:text-canvas">
                <PackagePlus size={18} aria-hidden /> Request resupply indent
              </Link>
            </div>

            <section className="border-b border-structure p-5">
              <h3 className="eyebrow mb-2 flex items-center gap-2"><Layers size={14} aria-hidden />Lots · first-expiry first-out</h3>
              <ul className="divide-y divide-structure/20 border border-structure">
                {data.lots.map((l) => (
                  <li key={l.id} className={cn('flex flex-wrap items-center justify-between gap-2 px-3 py-2', l.qty <= 0 && 'opacity-50')}>
                    <span className="font-mono text-sm">{l.id === data.lots.find((x) => x.qty > 0)?.id ? <b className="mr-2 text-cobalt">NEXT</b> : null}{l.lot_code}</span>
                    <span className="flex items-center gap-2"><ExpiryBadge date={l.expiry_date} /><span className="num font-mono text-sm font-semibold">{l.qty} {a.unit}</span></span>
                  </li>
                ))}
                {!data.lots.length && <li className="px-3 py-2 text-sm text-slate">No lots recorded.</li>}
              </ul>
            </section>

            <section className="p-5">
              <h3 className="eyebrow mb-2 flex items-center gap-2"><History size={14} aria-hidden />Recent movements</h3>
              <ul className="space-y-1">
                {data.history.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2 border-b border-structure/20 py-1.5 text-sm">
                    <span className="font-mono">{t.type}{t.drill ? ' · DRILL' : ''}</span>
                    <span className="num font-mono font-semibold">{t.qty_delta > 0 ? '+' : ''}{t.qty_delta}</span>
                    <span className="text-xs text-slate">{clock(t.ts)}</span>
                    <Badge variant={t.sync_status === 'SYNCED' ? 'ok' : t.sync_status === 'FAILED' ? 'critical' : 'active'}>{t.sync_status === 'SYNCED' ? 'At HQ' : t.sync_status === 'FAILED' ? 'Rejected' : 'Queued'}</Badge>
                  </li>
                ))}
                {!data.history.length && <li className="text-sm text-slate">No movements recorded on this tablet.</li>}
              </ul>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
