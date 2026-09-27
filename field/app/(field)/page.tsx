'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, Fuel, HardDrive, PackageCheck, SatelliteDish, Siren, Users } from 'lucide-react';
import { useField } from '../../lib/field-context';
import { db, useLiveQuery } from '../../lib/db/client';
import { hq, ApiError } from '../../lib/api';
import { expiryStatus } from '@polaris/shared/expiry';
import { Card, CardHeader, CardContent, PageHead } from '../../components/ui/card';
import { Badge, Dot } from '../../components/ui/badge';
import { ago, clock, cn } from '../../lib/utils';
import { emergencyType } from '../../lib/labels';

type Severity = 'alert' | 'caution' | 'info';
interface Item { key: string; severity: Severity; icon: typeof Siren; title: string; detail: string; href?: string; onClick?: () => void; action: string }

interface Forecast { qty: number; total_per_day: number; days_to_stockout: number; ci: [number, number]; ci_source?: string; used_model?: string; tele?: { source?: string; temp_outside?: number; wind_speed?: number; fetched_at?: string } }

/** HQ fuel forecast — polled at most once a minute, never overlapping, age always shown. */
function useForecast(stationId: string) {
  const [state, setState] = useState<{ data: Forecast | null; at: string | null; error: string | null }>({ data: null, at: null, error: null });
  useEffect(() => {
    // Guard is per-effect: a ref shared across StrictMode's double mount dropped the first result and blocked the second.
    let alive = true;
    let busy = false;
    const pull = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await hq<Forecast>(`/forecast/${encodeURIComponent(stationId)}`);
        if (alive) setState({ data, at: new Date().toISOString(), error: null });
      } catch (e) {
        if (alive) setState((s) => ({ ...s, error: e instanceof ApiError && e.offline ? 'HQ unreachable' : (e as Error).message }));
      } finally {
        busy = false;
      }
    };
    void pull();
    const t = setInterval(pull, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [stationId]);
  return state;
}

export default function BriefPage() {
  const { session, stationLabel, outbox, sync, storage, openAsset, setSosOpen } = useField();
  const station = session!.stationId;
  const assets = useLiveQuery(() => db.listAssets(), ['assets'], [station]).data;
  const lots = useLiveQuery(() => db.stationLots(), ['lots'], [station]).data;
  const emergencies = useLiveQuery(() => db.listEmergencies(), ['emergencies'], [station]).data;
  const sorties = useLiveQuery(() => db.listSorties(), ['field_sorties'], [station]).data;
  const personnel = useLiveQuery(() => db.listPersonnel(), ['personnel'], [station]).data;
  const indents = useLiveQuery(() => db.listIndents(), ['indents'], [station]).data;
  const fc = useForecast(station);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const e of emergencies ?? []) if (e.status !== 'RESOLVED') {
      out.push({ key: `em-${e.id}`, severity: 'alert', icon: Siren, title: `${emergencyType(e.type).label} emergency · ${e.status}`, detail: `${e.location_coord ?? 'no location'} · raised ${ago(e.ts, now)}`, href: '/muster', action: 'Triage' });
    }
    for (const s of sorties ?? []) {
      const overdue = s.safety_status === 'OVERDUE' || (s.safety_status === 'ACTIVE' && Date.parse(s.expected_return_time) < now);
      if (overdue) out.push({ key: `so-${s.id}`, severity: 'alert', icon: Clock, title: `Sortie overdue · ${s.destination}`, detail: `${s.lead_name ?? s.lead_personnel_id}${s.buddy_name ? ` + ${s.buddy_name}` : ''} · due ${clock(s.expected_return_time)}`, href: '/muster', action: 'Check in' });
    }
    if (storage.state === 'memory') out.push({ key: 'storage', severity: 'alert', icon: HardDrive, title: 'This tablet is not saving to disk', detail: storage.reason ?? 'On-device storage unavailable — close other POLARIS tabs and reload.', href: '/settings', action: 'Fix' });
    if (sync.link === 'key_mismatch') out.push({ key: 'key', severity: 'alert', icon: SatelliteDish, title: 'Sync key rejected by gateway', detail: 'Nothing is reaching HQ until the station key is provisioned.', href: '/comms', action: 'Provision' });
    if ((outbox?.FAILED ?? 0) > 0) out.push({ key: 'failed', severity: 'alert', icon: AlertTriangle, title: `${outbox!.FAILED} change${outbox!.FAILED > 1 ? 's' : ''} rejected by HQ`, detail: 'Review and retry or discard in Comms.', href: '/comms', action: 'Review' });

    const expiredByAsset = new Map<string, { name: string; id: string; n: number; unit: string }>();
    const expiringByAsset = new Map<string, { name: string; id: string; date: string }>();
    for (const l of lots ?? []) {
      const st = expiryStatus(l.expiry_date);
      if (st === 'expired') {
        const cur = expiredByAsset.get(l.asset_id) ?? { name: l.name, id: l.asset_id, n: 0, unit: l.unit };
        cur.n += Number(l.qty);
        expiredByAsset.set(l.asset_id, cur);
      } else if (st === 'expiring' && !expiringByAsset.has(l.asset_id)) {
        expiringByAsset.set(l.asset_id, { name: l.name, id: l.asset_id, date: l.expiry_date });
      }
    }
    for (const x of expiredByAsset.values()) out.push({ key: `ex-${x.id}`, severity: 'alert', icon: AlertTriangle, title: `Expired stock · ${x.name}`, detail: `${x.n} ${x.unit} past expiry — quarantine or write off`, onClick: () => openAsset(x.id), action: 'Open' });

    if (fc.data && fc.data.days_to_stockout < 45) {
      out.push({ key: 'fuel', severity: fc.data.days_to_stockout < 20 ? 'alert' : 'caution', icon: Fuel, title: `Diesel runs out in ~${Math.round(fc.data.days_to_stockout)} days`, detail: `${fc.data.qty} L at ${fc.data.total_per_day} L/day (HQ forecast)`, href: '/indents', action: 'Indent' });
    }
    for (const i of indents ?? []) if (i.status === 'DISPATCHED') {
      out.push({ key: `in-${i.id}`, severity: 'caution', icon: PackageCheck, title: `Inbound · ${i.qty_requested} ${i.unit ?? ''} ${i.name ?? i.asset_id}`, detail: `Dispatched by HQ${i.vessel_imo ? ` on vessel ${i.vessel_imo}` : ''} — confirm when it lands`, href: '/indents', action: 'Receive' });
    }
    for (const x of expiringByAsset.values()) out.push({ key: `es-${x.id}`, severity: 'caution', icon: Clock, title: `Expiring soon · ${x.name}`, detail: `First lot expires ${x.date} — use it first`, onClick: () => openAsset(x.id), action: 'Open' });
    if (fc.error && !fc.data) out.push({ key: 'fc', severity: 'info', icon: SatelliteDish, title: 'No HQ forecast on this tablet yet', detail: `${fc.error}. Local stock and muster are unaffected.`, action: '' });
    return out;
  }, [emergencies, sorties, storage, sync.link, outbox, lots, fc, indents, openAsset, now]);

  const onStation = (personnel ?? []).filter((p) => p.status === 'ON_STATION').length;
  const out = (personnel ?? []).filter((p) => p.status === 'FIELD_SORTIE').length;
  const alerts = items.filter((i) => i.severity === 'alert').length;
  const today = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHead eyebrow={`Shift brief · ${stationLabel} · ${today}`} title={items.length === 0 ? 'All clear.' : alerts ? <>{alerts} need{alerts === 1 ? 's' : ''} you <em className="text-flare">now</em>.</> : <>{items.length} to review.</>}>
        One list, most urgent first. Everything here comes from this tablet&apos;s records or a timestamped HQ forecast.
      </PageHead>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-label="Action queue" className="space-y-2">
          {items.length === 0 && (
            <div className="tickgrid flex items-center gap-4 border border-structure bg-surface p-6">
              <CheckCircle2 size={32} className="text-cobalt" aria-hidden />
              <div>
                <div className="font-display text-2xl text-ink">Nothing needs attention.</div>
                <p className="text-sm text-slate">No open emergencies, overdue sorties, expired stock, failed syncs or pending receipts.</p>
              </div>
            </div>
          )}
          {items.map((it) => {
            const body = (
              <>
                <span className={cn('grid w-12 shrink-0 place-items-center self-stretch border-r border-structure',
                  it.severity === 'alert' ? 'bg-flare text-white' : it.severity === 'caution' ? 'bg-caution/15 text-caution' : 'bg-canvas text-slate')}>
                  <it.icon size={20} aria-hidden />
                </span>
                <span className="min-w-0 flex-1 px-4 py-3">
                  <span className="block font-medium text-ink">{it.title}</span>
                  <span className="block truncate text-sm text-slate">{it.detail}</span>
                </span>
                {it.action && <span className="flex shrink-0 items-center gap-1 px-4 font-mono text-xs font-semibold uppercase tracking-[0.08em] text-ink">{it.action}<ArrowRight size={14} aria-hidden /></span>}
              </>
            );
            const cls = 'flex min-h-[64px] w-full items-center border border-structure bg-surface text-left transition-colors hover:border-cobalt';
            return it.href ? <Link key={it.key} href={it.href} className={cls}>{body}</Link>
              : it.onClick ? <button key={it.key} type="button" onClick={it.onClick} className={cls}>{body}</button>
              : <div key={it.key} className={cls}>{body}</div>;
          })}
        </section>

        <aside className="space-y-4">
          <Card>
            <CardHeader eyebrow="Station at a glance" />
            <CardContent className="grid grid-cols-2 gap-px bg-structure/20 p-0">
              {[
                { k: 'On station', v: personnel ? onStation : '—', icon: Users },
                { k: 'Out on sortie', v: personnel ? out : '—', icon: Users },
                { k: 'Stock lines', v: assets ? assets.length : '—', icon: PackageCheck },
                { k: 'Unsynced', v: outbox?.unsynced ?? '—', icon: SatelliteDish },
              ].map((s) => (
                <div key={s.k} className="bg-surface p-4">
                  <div className="num font-mono text-3xl font-semibold text-ink">{s.v}</div>
                  <div className="eyebrow mt-1">{s.k}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader eyebrow="HQ fuel forecast" action={fc.at ? <Badge variant="live"><Dot tone="phosphor" />{ago(fc.at, now)}</Badge> : <Badge>not received</Badge>} />
            <CardContent>
              {fc.data ? (
                <>
                  <div className="flex items-end gap-2">
                    <span className="num font-mono text-5xl font-semibold leading-none text-ink">{Math.round(fc.data.days_to_stockout)}</span>
                    <span className="pb-1 font-mono text-slate">days of diesel</span>
                  </div>
                  <p className="mt-2 text-sm text-slate">Range {fc.data.ci[0]}–{fc.data.ci[1]} days{fc.data.ci_source?.startsWith('placeholder') ? ' (illustrative ±15%, not a modelled interval)' : ''}.</p>
                  <p className="mt-1 text-sm text-slate">Burn {fc.data.total_per_day} L/day{typeof fc.data.used_model === 'string' && fc.data.used_model ? ` · ${fc.data.used_model}` : ''}</p>
                  {fc.data.tele?.source === 'assumed_default' && <p className="mt-2 border border-caution bg-caution/10 px-2 py-1 text-xs">HQ has no weather reading for this station — forecast uses nominal conditions.</p>}
                </>
              ) : (
                <p className="text-sm text-slate">{fc.error ?? 'Requesting…'} — shown here once HQ answers.</p>
              )}
            </CardContent>
          </Card>

          <button type="button" onClick={() => setSosOpen(true)} className="flex min-h-[64px] w-full items-center justify-center gap-2 border border-structure bg-flare font-mono text-base font-bold tracking-[0.1em] text-white hover:bg-ink">
            <Siren size={20} aria-hidden /> RAISE SOS
          </button>
        </aside>
      </div>
    </div>
  );
}
