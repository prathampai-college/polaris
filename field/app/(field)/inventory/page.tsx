'use client';
import Link from 'next/link';
import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ChevronRight, Clock, MapPin, Search, ShieldAlert, X } from 'lucide-react';
import { expiryStatus } from '@polaris/shared/expiry';
import { useField } from '../../../lib/field-context';
import { db, useLiveQuery } from '../../../lib/db/client';
import type { Row } from '../../../lib/db/core';
import { Empty, ErrorNote, PageHead } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/field';
import { ExpiryBadge } from '../../../components/shell/AssetSheet';
import { cn } from '../../../lib/utils';
import { CATEGORY_LABEL } from '../../../lib/labels';

type FilterKey = 'all' | 'critical' | 'expired' | 'expiring' | 'fuel' | 'oxygen' | 'food' | 'medical' | 'spares' | 'science';

const CATEGORY_FILTERS: { key: FilterKey; label: string; cats: string[] }[] = [
  { key: 'fuel', label: 'Fuel', cats: ['FUEL_DIESEL', 'FUEL_KEROSENE'] },
  { key: 'oxygen', label: 'Oxygen', cats: ['OXYGEN'] },
  { key: 'food', label: 'Food', cats: ['FOOD'] },
  { key: 'medical', label: 'Medical', cats: ['MEDICAL'] },
  { key: 'spares', label: 'Spares', cats: ['SPARES_DG', 'SPARES_HVAC'] },
  { key: 'science', label: 'Science', cats: ['SCIENTIFIC'] },
];
const FILTER_LABEL: Record<FilterKey, string> = {
  all: 'All', critical: 'Critical supply', expired: 'Expired', expiring: 'Expiring ≤30d',
  ...Object.fromEntries(CATEGORY_FILTERS.map((c) => [c.key, c.label])),
} as Record<FilterKey, string>;
const KEYS = Object.keys(FILTER_LABEL) as FilterKey[];

/** Per-asset view of its live (qty > 0) lots. */
interface LotInfo { expired: boolean; expiring: boolean; first: string | null }

function matches(a: Row, f: FilterKey, info: LotInfo | undefined): boolean {
  if (f === 'all') return true;
  if (f === 'critical') return a.criticality === 'CRITICAL';
  if (f === 'expired') return !!info?.expired;
  if (f === 'expiring') return !!info?.expiring;
  return CATEGORY_FILTERS.find((c) => c.key === f)!.cats.includes(a.category);
}

export default function StockPage() {
  // useSearchParams needs a Suspense boundary in Next 14.
  return (
    <Suspense fallback={<p className="font-mono text-sm text-slate">Loading stock…</p>}>
      <Stock />
    </Suspense>
  );
}

function Stock() {
  const { session, stationLabel, openAsset } = useField();
  const station = session!.stationId;
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get('f') as FilterKey | null;
  const filter: FilterKey = raw && KEYS.includes(raw) ? raw : 'all';
  const [q, setQ] = useState('');

  const assetsQ = useLiveQuery(() => db.listAssets(), ['assets', 'lots'], [station]);
  const lotsQ = useLiveQuery(() => db.stationLots(), ['lots', 'assets'], [station]);
  const pending = useLiveQuery(() => db.pendingByAsset(), ['outbox'], [station]).data ?? {};
  const assets = assetsQ.data;
  const lots = lotsQ.data;

  const lotInfo = useMemo(() => {
    const m = new Map<string, LotInfo>();
    for (const l of lots ?? []) {
      const cur = m.get(l.asset_id) ?? { expired: false, expiring: false, first: null };
      const st = expiryStatus(l.expiry_date);
      if (st === 'expired') cur.expired = true;
      if (st === 'expiring') cur.expiring = true;
      if (!cur.first && l.expiry_date) cur.first = l.expiry_date; // stationLots is earliest-expiry first
      m.set(l.asset_id, cur);
    }
    return m;
  }, [lots]);

  const setFilter = (f: FilterKey) => router.replace(f === 'all' ? '/inventory' : `/inventory?f=${f}`, { scroll: false });
  const count = (f: FilterKey) => (assets ?? []).filter((a) => matches(a, f, lotInfo.get(a.id))).length;

  const needle = q.trim().toLowerCase();
  const shown = (assets ?? []).filter((a) => matches(a, filter, lotInfo.get(a.id))
    && (!needle || [a.name, a.sku, a.barcode].some((v) => String(v ?? '').toLowerCase().includes(needle))));

  const onHand = (assets ?? []).filter((a) => Number(a.qty) > 0).length;
  const lotsReady = lots !== undefined;

  const summary: { key: FilterKey; label: string; icon: typeof AlertTriangle; tone: 'ink' | 'flare' | 'caution'; needsLots: boolean }[] = [
    { key: 'critical', label: 'Critical lines', icon: ShieldAlert, tone: 'ink', needsLots: false },
    { key: 'expired', label: 'Expired lines', icon: AlertTriangle, tone: 'flare', needsLots: true },
    { key: 'expiring', label: 'Expiring ≤30d', icon: Clock, tone: 'caution', needsLots: true },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHead
        eyebrow={`Stock · ${stationLabel}`}
        title={assets ? <>{onHand} line{onHand === 1 ? '' : 's'} on hand</> : 'Stock'}
      >
        {assets
          ? `${assets.length} line${assets.length === 1 ? '' : 's'} registered to this station on this tablet${assets.length - onHand ? ` · ${assets.length - onHand} at zero` : ''}. Tap a line to consume, issue, receive or correct.`
          : 'Reading the local register…'}
      </PageHead>

      {assetsQ.error && <ErrorNote>Could not read stock: {assetsQ.error}</ErrorNote>}
      {lotsQ.error && <ErrorNote>Could not read lots — expiry counts unavailable: {lotsQ.error}</ErrorNote>}

      {assets && assets.length === 0 ? (
        <Empty
          title="No stock registered"
          action={<Link href="/comms" className="inline-flex min-h-tap items-center gap-2 border border-structure px-4 font-mono text-sm font-semibold text-ink hover:bg-structure hover:text-canvas">Open Comms <ChevronRight size={16} aria-hidden /></Link>}
        >
          No stock is registered to {stationLabel} on this tablet. Pull the register from HQ in Comms.
        </Empty>
      ) : (
        <>
          <section aria-label="Stock summary" className="grid grid-cols-3 gap-px border border-structure bg-structure">
            {summary.map((s) => {
              const n = !assets || (s.needsLots && !lotsReady) ? null : count(s.key);
              const on = filter === s.key;
              const hot = !!n && s.tone !== 'ink';
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(on ? 'all' : s.key)}
                  className={cn('flex min-h-tap flex-col items-start gap-1 p-4 text-left transition-colors', on ? 'bg-cobalt/10' : 'bg-surface hover:bg-canvas')}
                >
                  <span className={cn('flex items-center gap-2', hot ? (s.tone === 'flare' ? 'text-flare' : 'text-caution') : 'text-ink')}>
                    <s.icon size={20} aria-hidden />
                    <span className="num font-mono text-3xl font-semibold leading-none">{n ?? '—'}</span>
                  </span>
                  <span className={cn('eyebrow', on && 'text-cobalt')}>{s.label}</span>
                </button>
              );
            })}
          </section>

          <div className="space-y-3">
            <div className="relative">
              <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate" />
              <Input type="search" aria-label="Search stock by name, SKU or barcode" placeholder="Name, SKU or barcode" value={q} onChange={(e) => setQ(e.target.value)} className="pl-10 pr-14" />
              {q && (
                <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute right-0 top-0 grid min-h-tap min-w-tap place-items-center text-slate hover:text-ink">
                  <X size={18} aria-hidden />
                </button>
              )}
            </div>
            <div role="group" aria-label="Filter stock" className="flex flex-wrap gap-2">
              {KEYS.map((k) => {
                const on = filter === k;
                const n = !assets || ((k === 'expired' || k === 'expiring') && !lotsReady) ? null : count(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setFilter(k)}
                    className={cn('inline-flex min-h-tap items-center gap-2 border px-3 font-mono text-xs font-semibold uppercase tracking-[0.06em] transition-colors',
                      on ? 'border-cobalt bg-cobalt text-white' : 'border-structure/40 bg-surface text-ink hover:border-structure')}
                  >
                    {FILTER_LABEL[k]}
                    <span className={cn('num', on ? 'text-white' : 'text-slate')}>{n ?? '—'}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {!assets ? (
            !assetsQ.error && <p className="font-mono text-sm text-slate">Reading the local register…</p>
          ) : shown.length === 0 ? (
            <Empty title="No matching stock" action={<Button variant="ghost" onClick={() => { setQ(''); setFilter('all'); }}>Clear search and filters</Button>}>
              Nothing in {stationLabel}&apos;s register matches {needle ? <>&ldquo;{q.trim()}&rdquo;</> : 'this filter'}{needle && filter !== 'all' ? ` under ${FILTER_LABEL[filter]}` : ''}.
            </Empty>
          ) : (
            <section aria-label="Stock lines">
              <div aria-hidden className="eyebrow hidden gap-4 border border-b-0 border-structure bg-canvas px-4 py-2 lg:grid lg:grid-cols-[minmax(0,1fr)_8rem_13rem_minmax(0,15rem)_20px]">
                <span>Item</span><span className="text-right">On hand</span><span>Location</span><span className="text-right">Status</span><span />
              </div>
              <ul className="space-y-2 lg:space-y-0">
                {shown.map((a) => {
                  const info = lotInfo.get(a.id);
                  // Earliest live lot is the truth; fall back to the registered date only if no lot rows exist.
                  const exp = info?.first ?? (lotsReady && !info && Number(a.qty) > 0 ? a.expiry_date ?? null : null);
                  const qty = a.qty == null ? '—' : Number(a.qty).toLocaleString();
                  return (
                    <li key={a.id} className="lg:-mt-px">
                      <button
                        type="button"
                        onClick={() => openAsset(a.id)}
                        className="grid min-h-[72px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border border-structure bg-surface px-4 py-3 text-left transition-colors hover:relative hover:border-cobalt lg:grid-cols-[minmax(0,1fr)_8rem_13rem_minmax(0,15rem)_20px]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-display text-2xl leading-tight text-ink">{a.name ?? a.sku}</span>
                          <span className="block truncate font-mono text-xs text-slate">{a.sku}{a.category ? ` · ${CATEGORY_LABEL[a.category] ?? a.category}` : ''}</span>
                        </span>
                        <span className="text-right">
                          <span className={cn('num font-mono text-3xl font-semibold leading-none', Number(a.qty) > 0 ? 'text-ink' : 'text-slate')}>{qty}</span>
                          <span className="ml-1.5 font-mono text-sm text-slate">{a.unit ?? ''}</span>
                        </span>
                        <span className="col-span-2 flex min-w-0 items-center gap-1.5 font-mono text-sm text-slate lg:col-span-1">
                          <MapPin size={14} aria-hidden className="shrink-0" />
                          <span className="truncate">{a.container_id ?? '—'} / {a.crate_id ?? '—'} · {a.temp_zone ?? 'zone —'}</span>
                        </span>
                        <span className="col-span-2 flex flex-wrap gap-1.5 lg:col-span-1 lg:justify-end">
                          {Number(a.qty) <= 0 && <Badge variant="critical"><AlertTriangle size={12} aria-hidden />Out of stock</Badge>}
                          {a.criticality === 'CRITICAL' ? <Badge variant="solid"><ShieldAlert size={12} aria-hidden />Critical</Badge>
                            : a.criticality ? <Badge>{a.criticality}</Badge> : null}
                          <ExpiryBadge date={exp} />
                          {pending[a.id] > 0 && <Badge variant="active">{pending[a.id]} awaiting HQ</Badge>}
                        </span>
                        <ChevronRight size={20} aria-hidden className="hidden text-slate lg:block" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
