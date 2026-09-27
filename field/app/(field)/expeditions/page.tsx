'use client';
import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { AlertTriangle, ArrowRight, Check, Clock, Lock, Printer, RefreshCw, Snowflake, Thermometer } from 'lucide-react';
import { useField } from '../../../lib/field-context';
import { db, useLiveQuery } from '../../../lib/db/client';
import type { Row } from '../../../lib/db/core';
import { MANIFEST_STAGES } from '../../../lib/labels';
import { hq, ApiError } from '../../../lib/api';
import { PageHead, Empty, ErrorNote } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { HoldButton } from '../../../components/ui/hold-button';
import { Segmented } from '../../../components/ui/field';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { cn } from '../../../lib/utils';

const FINAL = MANIFEST_STAGES[MANIFEST_STAGES.length - 1];
/** Field confirms these two by hand; earlier hops normally arrive already confirmed from HQ. */
const FIELD_STAGES = new Set(['STATION', 'CRATE']);
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const stageIdx = (s: unknown) => MANIFEST_STAGES.indexOf(String(s));
// Closest to arrival first (needs hands soonest), crated last.
const rank = (m: Row) => (m.stage === FINAL ? 99 : MANIFEST_STAGES.length - stageIdx(m.stage));

export default function CargoPage() {
  const { session, stationLabel, toast } = useField();
  const station = session!.stationId;
  const manifests = useLiveQuery(() => db.listManifests(), ['manifests', 'expeditions'], [station]);
  const expeditions = useLiveQuery(() => db.listExpeditions(), ['expeditions'], [station]).data;
  const [exp, setExp] = useState('ALL');
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState<Row | null>(null);

  const all = manifests.data;
  const expOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const m of all ?? []) if (!seen.has(m.expedition_id)) seen.set(m.expedition_id, m.expedition_name ?? m.expedition_id);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [all]);
  const active = expOptions.some((o) => o.value === exp) ? exp : 'ALL';
  const shown = useMemo(
    () => (all ?? []).filter((m) => active === 'ALL' || m.expedition_id === active).sort((a, b) => rank(a) - rank(b)),
    [all, active],
  );
  const season = useMemo(() => new Map((expeditions ?? []).map((e) => [e.id, e.season])), [expeditions]);

  const count = (s: string) => (all ?? []).filter((m) => m.stage === s).length;
  const inbound = all ? all.filter((m) => m.stage !== FINAL).length : null;

  const syncFromHQ = async () => {
    setSyncing(true);
    try {
      const exps = await hq<Row[]>('/expeditions');
      const e = await db.mergeFromHQ({ entity: 'expeditions', rows: exps });
      const res = await Promise.allSettled(exps.map((x) =>
        hq<Row[]>(`/expeditions/${encodeURIComponent(x.id)}/manifests?destination_station=${encodeURIComponent(station)}`)));
      const rows = res.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      const failed = res.filter((r) => r.status === 'rejected').length;
      const m = await db.mergeFromHQ({ entity: 'manifests', rows });
      toast(
        `Synced ${e.applied} expedition${e.applied === 1 ? '' : 's'}, ${m.applied} manifest${m.applied === 1 ? '' : 's'}`
          + (m.skipped ? ` · ${m.skipped} kept local (unsynced edits)` : '')
          + (failed ? ` · ${failed} expedition${failed === 1 ? '' : 's'} failed to load` : ''),
        failed ? 'alert' : 'ok',
      );
    } catch (err) {
      toast(err instanceof ApiError && err.offline ? "HQ unreachable — showing this tablet's copy" : (err as Error).message, 'alert');
    } finally {
      setSyncing(false);
    }
  };

  const advance = async (m: Row) => {
    setBusy(m.id);
    try {
      const r = await db.advanceManifest({ id: m.id });
      toast(`${dash(m.labelling_code)} confirmed at ${r.stage}`, 'ok');
    } catch (err) {
      toast((err as Error).message, 'alert');
    } finally {
      setBusy(null);
    }
  };

  const syncButton = (
    <Button variant="ghost" onClick={syncFromHQ} disabled={syncing}>
      <RefreshCw size={16} aria-hidden className={cn(syncing && 'animate-spin')} />
      {syncing ? 'Syncing…' : 'Sync plans from HQ'}
    </Button>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHead
        eyebrow={`Cargo · ${stationLabel}`}
        title={inbound === null ? 'Cargo' : `${inbound} consignment${inbound === 1 ? '' : 's'} inbound`}
        action={syncButton}
      >
        {all && all.length > 0
          ? `${count('VESSEL')} on the vessel · ${count('STATION')} landed, awaiting crating · ${count(FINAL)} crated. Hold to confirm each hand-over; it syncs to HQ.`
          : 'Expedition manifests routed to this station, with chain of custody from Goa to crate.'}
      </PageHead>

      {manifests.error && <ErrorNote>{manifests.error}</ErrorNote>}

      {expOptions.length > 1 && (
        <div className="overflow-x-auto scroll-thin">
          <Segmented label="Expedition" value={active} onChange={setExp} options={[{ value: 'ALL', label: 'All' }, ...expOptions]} />
        </div>
      )}

      {all && all.length === 0 && (
        <Empty title="No manifests for this station on this tablet" action={syncButton}>
          Expeditions and their cargo manifests are planned at HQ. Sync while the link is up to pull every consignment
          addressed to {stationLabel}; after that the custody track works fully offline.
        </Empty>
      )}

      <section aria-label="Manifests" className="space-y-3">
        {shown.map((m) => <ManifestCard key={m.id} m={m} busy={busy === m.id} onAdvance={() => advance(m)} onLabel={() => setLabel(m)} />)}
      </section>

      <Dialog open={!!label} onOpenChange={(o) => { if (!o) setLabel(null); }}>
        {/* Print: pin the dialog to the page corner so the label lands at 100×70mm top-left. */}
        <DialogContent className="print:left-0 print:top-0 print:max-h-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:border-0 print:p-0 print:shadow-none">
          <DialogTitle>Crate label</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate">Only the label prints. Set the printer to 100 × 70 mm stock or scale to fit.</DialogDescription>
          {label && <CrateLabel m={label} station={stationLabel} season={season.get(label.expedition_id)} />}
          <Button className="mt-4 w-full" onClick={() => window.print()}><Printer size={16} aria-hidden />Print label</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ManifestCard({ m, busy, onAdvance, onLabel }: { m: Row; busy: boolean; onAdvance: () => void; onLabel: () => void }) {
  const next = MANIFEST_STAGES[stageIdx(m.stage) + 1];
  const done = m.stage === FINAL;
  const prominent = next && FIELD_STAGES.has(next);
  return (
    <article className={cn('border bg-surface', prominent ? 'border-cobalt' : 'border-structure')} aria-label={`${dash(m.description)}, ${dash(m.labelling_code)}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-structure px-4 py-3">
        <div className="min-w-0">
          <div className="font-mono text-sm font-semibold text-ink">{dash(m.labelling_code)}</div>
          <h2 className="font-display text-2xl leading-tight text-ink">{dash(m.description)}</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ZoneBadge zone={m.temp_zone} hazmat={m.hazmat_class} />
          <ClearBadge what="Customs" status={m.customs_status} />
          <ClearBadge what="Biosecurity" status={m.biosecurity_status} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px border-b border-structure bg-structure/20 sm:grid-cols-4">
        {[
          ['Expedition', dash(m.expedition_name ?? m.expedition_id)],
          ['Owner · project', `${dash(m.owner_org)} · ${dash(m.project_code)}`],
          ['Quantity', m.qty == null ? '—' : `${m.qty} ${m.unit ?? ''}`],
          ['Weight', m.weight_kg == null ? '—' : `${m.weight_kg} kg`],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 bg-surface px-4 py-2">
            <dt className="eyebrow">{k}</dt>
            <dd className="num truncate font-mono text-sm text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4 pb-3 pt-4">
        <CustodyTrack stage={String(m.stage)} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-structure px-4 py-3">
        <Button variant="outline" onClick={onLabel} aria-label={`Print crate label for ${dash(m.labelling_code)}`}>
          <Printer size={16} aria-hidden />Label
        </Button>
        {done ? (
          <Badge variant="solid" className="min-h-tap px-4 text-sm"><Lock size={14} aria-hidden />In crate {dash(m.crate_id)}</Badge>
        ) : next && (
          <HoldButton
            tone="cobalt"
            holdMs={900}
            disabled={busy}
            label={`Confirm ${dash(m.labelling_code)} at ${next}`}
            onConfirm={onAdvance}
            className={cn('min-w-[220px] text-sm', prominent ? 'border-cobalt text-cobalt' : 'border-structure/40 text-xs text-slate')}
          >
            Confirm <ArrowRight size={14} aria-hidden /> {next}
          </HoldButton>
        )}
      </div>
    </article>
  );
}

/** GOA → … → CRATE as a line with stop ticks: passed = ink, current = cobalt, ahead = hollow. */
function CustodyTrack({ stage }: { stage: string }) {
  const cur = stageIdx(stage);
  return (
    <ol className="grid grid-cols-6" aria-label={`Custody: ${cur < 0 ? `unknown stage ${stage}` : `at ${stage}, stop ${cur + 1} of ${MANIFEST_STAGES.length}`}`}>
      {MANIFEST_STAGES.map((s, i) => {
        const state = i < cur ? 'passed' : i === cur ? 'current' : 'ahead';
        return (
          <li key={s} className="relative flex flex-col items-center" aria-current={state === 'current' ? 'step' : undefined}>
            {i < MANIFEST_STAGES.length - 1 && (
              <span aria-hidden className={cn('absolute left-1/2 top-[7px] w-full', i < cur ? 'h-0.5 bg-ink' : 'border-t border-dashed border-structure/50')} />
            )}
            <span aria-hidden className={cn('relative z-10 h-4 w-4 border-2',
              state === 'passed' && 'border-ink bg-ink',
              state === 'current' && 'border-cobalt bg-cobalt outline outline-2 outline-offset-2 outline-cobalt',
              state === 'ahead' && 'border-structure/60 bg-surface')} />
            <span className={cn('mt-2 font-mono text-xs uppercase tracking-[0.04em]',
              state === 'current' ? 'font-bold text-cobalt' : state === 'passed' ? 'text-ink' : 'text-slate')}>
              {s}
            </span>
            <span className="font-mono text-xs text-slate">
              {state === 'current' ? 'now' : state === 'passed' ? <><Check size={12} aria-hidden className="inline" /><span className="sr-only">passed</span></> : <span className="sr-only">ahead</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ZoneBadge({ zone, hazmat }: { zone: unknown; hazmat: unknown }) {
  if (zone === 'HAZMAT' || hazmat) return <Badge variant="critical"><AlertTriangle size={12} aria-hidden />Hazmat {dash(hazmat)}</Badge>;
  if (zone === 'COLD') return <Badge variant="active"><Snowflake size={12} aria-hidden />Cold chain</Badge>;
  return <Badge><Thermometer size={12} aria-hidden />{dash(zone)}</Badge>;
}

function ClearBadge({ what, status }: { what: string; status: unknown }) {
  if (status === 'CLEARED') return <Badge variant="ok"><Check size={12} aria-hidden />{what} cleared</Badge>;
  if (status === 'PENDING') return <Badge variant="caution"><Clock size={12} aria-hidden />{what} pending</Badge>;
  return <Badge>{what} {dash(status)}</Badge>;
}

function Qr({ text }: { text: string }) {
  // Our own generated SVG from a local string — safe to inject.
  const svg = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div role="img" aria-label={`QR code: ${text}`} className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Paper label: forced black on white so it prints the same from Day or Polar Night. */
function CrateLabel({ m, station, season }: { m: Row; station: string; season: unknown }) {
  const code = m.labelling_code ? String(m.labelling_code) : null;
  const hazmat = m.temp_zone === 'HAZMAT' || m.hazmat_class;
  return (
    <div className="print-area mt-4">
      <div className="flex aspect-[10/7] w-full flex-col border-2 border-current bg-white p-3 text-black print:aspect-auto print:h-[70mm] print:w-[100mm]">
        <div className="flex items-baseline justify-between gap-2 border-b-2 border-current pb-1 font-mono text-xs font-bold uppercase tracking-[0.1em]">
          <span className="truncate">Polaris · {dash(m.expedition_name ?? m.expedition_id)}</span>
          <span className="shrink-0">{dash(season)}</span>
        </div>
        <div className="flex min-h-0 flex-1 items-center gap-3 pt-2">
          <div className="w-[38%] shrink-0">
            {code ? <Qr text={code} /> : <div className="grid aspect-square place-items-center border-2 border-dashed border-current font-mono text-xs">No code</div>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col self-stretch">
            <div className="font-mono text-xs font-bold uppercase tracking-[0.1em]">Deliver to</div>
            <div className="font-display text-2xl leading-none">{station}</div>
            <div className="mt-2 break-all font-mono text-2xl font-bold leading-tight">{code ?? '—'}</div>
            <div className="mt-1 line-clamp-2 text-sm leading-snug">{dash(m.description)}</div>
            <div className="mt-auto flex flex-wrap items-center gap-1 pt-1 font-mono text-xs font-bold uppercase">
              {hazmat
                ? <span className="bg-black px-1 text-white">Hazmat {dash(m.hazmat_class)}</span>
                : <span className="border-2 border-current px-1">{dash(m.temp_zone)}</span>}
              <span>{m.qty == null ? '—' : `${m.qty} ${m.unit ?? ''}`} · {m.weight_kg == null ? '—' : `${m.weight_kg} kg`}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
