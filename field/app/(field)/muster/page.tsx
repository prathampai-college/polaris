'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Ambulance, Check, Footprints, House, MountainSnow, Plane, RefreshCw, Siren, UserPlus,
} from 'lucide-react';
import { useField } from '../../../lib/field-context';
import { db, useLiveQuery } from '../../../lib/db/client';
import { hq, ApiError } from '../../../lib/api';
import { Card, CardHeader, CardContent, PageHead, Empty, ErrorNote } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { HoldButton } from '../../../components/ui/hold-button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../../components/ui/dialog';
import { Field, Input, Select, Toggle } from '../../../components/ui/field';
import { ago, clock, cn, haptic } from '../../../lib/utils';
import { emergencyType } from '../../../lib/labels';

type Row = Record<string, any>;

// ---------- pure helpers ----------

const typeOf = emergencyType;

const FLOW = ['ACTIVE', 'ACK', 'RESPONDING', 'RESOLVED'] as const;
const STEP_LABEL: Record<string, string> = { ACTIVE: 'Active', ACK: 'Acknowledged', RESPONDING: 'Responding', RESOLVED: 'Resolved' };

const STATUS: Record<string, { label: string; icon: typeof House; variant: 'ok' | 'active' | 'neutral' | 'solid' }> = {
  ON_STATION: { label: 'On station', icon: House, variant: 'ok' },
  FIELD_SORTIE: { label: 'On sortie', icon: MountainSnow, variant: 'active' },
  IN_TRANSIT: { label: 'In transit', icon: Plane, variant: 'neutral' },
  EVACUATED: { label: 'Evacuated', icon: Ambulance, variant: 'solid' },
};

/** "1h 20m" / "35m" / "2d 3h". */
function dur(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(m / 60);
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** datetime-local value (local wall time, minute precision). */
function toLocalInput(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const isOpenSortie = (s: Row) => s.safety_status === 'ACTIVE' || s.safety_status === 'OVERDUE' || s.safety_status === 'EMERGENCY';
const isOverdue = (s: Row, now: number) => s.safety_status === 'OVERDUE' || (isOpenSortie(s) && Date.parse(s.expected_return_time) < now);

/** Mutation wrapper: toast + haptic on both outcomes, busy flag for the caller's buttons. */
function useAct() {
  const { toast } = useField();
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, ok: string): Promise<boolean> => {
    setBusy(true);
    try {
      await fn();
      haptic(30);
      toast(ok, 'ok');
      return true;
    } catch (e) {
      haptic([80, 60, 80]);
      toast((e as Error).message, 'alert');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

// ---------- page ----------

export default function MusterPage() {
  const { session, stationLabel, setSosOpen, toast } = useField();
  const station = session!.stationId;
  const personnel = useLiveQuery(() => db.listPersonnel(), ['personnel'], [station]).data;
  const sorties = useLiveQuery(() => db.listSorties(), ['field_sorties', 'personnel'], [station]).data;
  const emergencies = useLiveQuery(() => db.listEmergencies(), ['emergencies', 'personnel', 'outbox'], [station]).data;

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);

  const [sortieOpen, setSortieOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const openEm = (emergencies ?? []).filter((e) => e.status !== 'RESOLVED');
  const resolvedEm = (emergencies ?? []).filter((e) => e.status === 'RESOLVED');
  const openSorties = useMemo(() => (sorties ?? []).filter(isOpenSortie)
    .sort((a, b) => Date.parse(a.expected_return_time) - Date.parse(b.expected_return_time)), [sorties]);
  const sortieById = useMemo(() => new Map((sorties ?? []).map((s) => [s.id as string, s])), [sorties]);
  const sortieByPerson = useMemo(() => {
    const m = new Map<string, Row>();
    for (const s of openSorties) for (const pid of [s.lead_personnel_id, s.buddy_personnel_id]) if (pid) m.set(pid, s);
    return m;
  }, [openSorties]);
  const onStation = (personnel ?? []).filter((p) => p.status === 'ON_STATION');
  const overdueCount = openSorties.filter((s) => isOverdue(s, now)).length;
  const count = (st: string) => (personnel ? personnel.filter((p) => p.status === st).length : '—');

  async function refreshRoster() {
    setRefreshing(true);
    try {
      const rows = await hq<Row[]>(`/personnel?station_id=${encodeURIComponent(station)}`);
      const r = await db.mergeFromHQ({ entity: 'personnel', rows });
      haptic(30);
      toast(`Roster refreshed from HQ — ${r.applied} updated${r.skipped ? `, ${r.skipped} kept (unsynced changes on this tablet)` : ''}`, 'ok');
    } catch (e) {
      haptic([80, 60, 80]);
      toast(e instanceof ApiError && e.offline ? "HQ unreachable — showing this tablet's roster" : (e as Error).message, 'alert');
    } finally {
      setRefreshing(false);
    }
  }

  const title = openEm.length
    ? <><em className="text-flare">{openEm.length}</em> emergenc{openEm.length === 1 ? 'y' : 'ies'} open.</>
    : overdueCount
      ? <><em className="text-flare">{overdueCount}</em> sortie{overdueCount === 1 ? '' : 's'} overdue.</>
      : personnel ? <>{onStation.length} of {personnel.length} on station.</> : <>Muster.</>;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <PageHead
        eyebrow={`Muster · ${stationLabel}`}
        title={title}
        action={<Button variant="danger" size="lg" onClick={() => setSosOpen(true)}><Siren size={18} aria-hidden /> Raise SOS</Button>}
      >
        Emergencies first, then people outside the wire, then everyone else. All from this tablet&apos;s records — works with no link.
      </PageHead>

      {/* 1 · Emergencies */}
      {(openEm.length > 0 || resolvedEm.length > 0) && (
        <section aria-labelledby="em-h" className="space-y-3">
          <h2 id="em-h" className="eyebrow">Emergencies · {openEm.length} open</h2>
          {openEm.map((e) => (
            <EmergencyCard key={e.id} e={e} now={now} responders={(personnel ?? []).filter((p) => p.status === 'ON_STATION' || p.status === 'FIELD_SORTIE')} sortie={e.sortie_id ? sortieById.get(e.sortie_id) : undefined} />
          ))}
          {resolvedEm.length > 0 && (
            <details className="border border-structure bg-surface">
              <summary className="flex min-h-tap cursor-pointer items-center px-4 font-mono text-sm font-semibold text-ink">Resolved ({resolvedEm.length})</summary>
              <ul className="divide-y divide-structure/30 border-t border-structure">
                {resolvedEm.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2 text-sm">
                    <span className="font-medium text-ink">{typeOf(e.type).label}</span>
                    <span className="text-slate">{e.location_coord ?? '—'}</span>
                    <span className="font-mono text-xs text-slate">raised {clock(e.ts)} · resolved {clock(e.status_entered_ts)}</span>
                    <span className="font-mono text-xs text-slate">lead {e.assignee_name ?? e.assignee ?? '—'}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* 2 · Sorties */}
      <section aria-labelledby="so-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="so-h" className="eyebrow">Field sorties · {openSorties.length} out{overdueCount ? ` · ${overdueCount} overdue` : ''}</h2>
          <Button onClick={() => setSortieOpen(true)}><UserPlus size={16} aria-hidden /> Start sortie</Button>
        </div>
        {sorties && openSorties.length === 0 && <Empty title="No one is out on a sortie.">Start a sortie before anyone leaves the station perimeter.</Empty>}
        <div className="grid gap-3 lg:grid-cols-2">
          {openSorties.map((s) => <SortieCard key={s.id} s={s} now={now} />)}
        </div>
      </section>

      {/* 3 · Muster board */}
      <section aria-labelledby="mu-h" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="mu-h" className="eyebrow">Muster board · {personnel ? personnel.length : '—'} on roll</h2>
          <Button variant="outline" onClick={refreshRoster} disabled={refreshing}>
            <RefreshCw size={16} aria-hidden className={cn(refreshing && 'animate-spin')} /> Refresh roster from HQ
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-px border border-structure bg-structure sm:grid-cols-4">
          {(['ON_STATION', 'FIELD_SORTIE', 'IN_TRANSIT', 'EVACUATED'] as const).map((st) => {
            const { label, icon: Icon } = STATUS[st];
            return (
              <div key={st} className="bg-surface p-4">
                <div className="num font-mono text-3xl font-semibold text-ink">{count(st)}</div>
                <div className="eyebrow mt-1 flex items-center gap-1.5"><Icon size={14} aria-hidden />{label}</div>
              </div>
            );
          })}
        </div>
        {personnel && personnel.length === 0 && <Empty title="No personnel on this tablet.">Refresh the roster from HQ when a link is available.</Empty>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(personnel ?? []).map((p) => <PersonCard key={p.id} p={p} sortie={sortieByPerson.get(p.id)} now={now} />)}
        </div>
      </section>

      <StartSortieDialog open={sortieOpen} onOpenChange={setSortieOpen} people={onStation} now={now} />
    </div>
  );
}

// ---------- emergencies ----------

function EmergencyCard({ e, now, responders, sortie }: { e: Row; now: number; responders: Row[]; sortie?: Row }) {
  const { busy, act } = useAct();
  const [assignee, setAssignee] = useState('');
  const { label, icon: Icon } = typeOf(e.type);
  const idx = FLOW.indexOf(e.status);
  const inStatus = e.status_entered_ts ? dur(now - Date.parse(e.status_entered_ts)) : '—';

  return (
    <Card className="flex border-flare">
      <div className="grid w-14 shrink-0 place-items-center border-r border-structure bg-flare text-white"><Icon size={26} aria-hidden /></div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-structure px-4 py-3">
          <div className="min-w-0">
            <div className="font-display text-2xl leading-tight text-ink">{label}</div>
            <div className="text-sm text-slate">{e.location_coord ?? '—'}{sortie ? ` · sortie to ${sortie.destination ?? 'unrecorded destination'}` : ''}</div>
            {/* Did HQ actually get it? The person who raised it needs to know whether to keep trying other channels. */}
            <div role="status" className={cn('mt-1 font-mono text-xs font-semibold', Number(e.hq_pending) > 0 ? 'text-flare' : 'text-cobalt')}>
              {Number(e.hq_pending) > 0
                ? 'NOT YET AT HQ — queued; goes out on the next link or DTN hand-off'
                : e.hq_received_at
                  ? `HQ RECEIVED ${ago(e.hq_received_at, now)}`
                  : 'RAISED BY HQ'}
            </div>
          </div>
          <Badge variant="critical"><Siren size={12} aria-hidden />{e.status}</Badge>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
          {[
            ['Raised', ago(e.ts, now)],
            [`In ${STEP_LABEL[e.status]?.toLowerCase() ?? 'status'}`, inStatus],
            ['Assigned to', e.assignee_name ?? e.assignee ?? '—'],
            ['Reported by', e.reported_by ?? '—'],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="eyebrow">{k}</dt>
              <dd className="num truncate font-mono text-ink">{v}</dd>
            </div>
          ))}
        </dl>

        <ol aria-label="Triage progress" className="grid grid-cols-4 border-y border-structure">
          {FLOW.map((st, i) => {
            const done = i < idx;
            const cur = i === idx;
            return (
              <li key={st} aria-current={cur ? 'step' : undefined}
                className={cn('flex min-h-tap items-center justify-center gap-1.5 border-r border-structure px-1 text-center font-mono text-xs font-semibold uppercase tracking-[0.04em] last:border-r-0',
                  done ? 'bg-ink text-canvas' : cur ? 'bg-flare text-white' : 'bg-surface text-slate')}>
                {done ? <Check size={14} aria-hidden /> : <span aria-hidden>{i + 1}</span>}
                <span className="truncate">{STEP_LABEL[st]}</span>
                {done && <span className="sr-only">(done)</span>}
                {cur && <span className="sr-only">(current)</span>}
              </li>
            );
          })}
        </ol>

        <div className="p-4">
          {e.status === 'ACTIVE' && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <Field label="Response lead" className="flex-1" error={responders.length ? null : 'No one is marked on station — update the muster board below.'}>
                {(id) => (
                  <Select id={id} value={assignee} onChange={(ev) => setAssignee(ev.target.value)}>
                    <option value="">Choose who takes this…</option>
                    {responders.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role ?? '—'}</option>)}
                  </Select>
                )}
              </Field>
              <Button variant="danger" size="lg" disabled={!assignee || busy}
                onClick={() => act(() => db.advanceEmergency({ id: e.id, assignee }), `${label} emergency acknowledged`)}>
                Acknowledge
              </Button>
            </div>
          )}
          {e.status === 'ACK' && (
            <Button size="lg" className="w-full" disabled={busy}
              onClick={() => act(() => db.advanceEmergency({ id: e.id }), `${label} emergency — response under way`)}>
              Mark responding
            </Button>
          )}
          {e.status === 'RESPONDING' && (
            <HoldButton tone="cobalt" label="Mark resolved" className="w-full" disabled={busy}
              onConfirm={() => void act(() => db.advanceEmergency({ id: e.id }), `${label} emergency resolved`)}>
              <Check size={18} aria-hidden /> Hold to mark resolved
            </HoldButton>
          )}
        </div>
      </div>
    </Card>
  );
}

// ---------- sorties ----------

function SortieCard({ s, now }: { s: Row; now: number }) {
  const { busy, act } = useAct();
  const due = Date.parse(s.expected_return_time);
  const late = isOverdue(s, now);
  const soon = !late && due - now < 30 * 60_000;
  const dueLabel = Number.isNaN(due) ? 'due —' : late ? `OVERDUE ${dur(now - due)}` : `due in ${dur(due - now)}`;

  return (
    <Card className={cn(late && 'border-flare')}>
      <CardHeader
        eyebrow={`Sortie · departed ${clock(s.departure_time)}`}
        title={s.destination ?? '—'}
        action={late ? <Badge variant="critical"><Siren size={12} aria-hidden />{dueLabel}</Badge>
          : <Badge variant={soon ? 'caution' : 'ok'}>{dueLabel}</Badge>}
      />
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="eyebrow">Lead</dt><dd className="font-display text-lg text-ink">{s.lead_name ?? s.lead_personnel_id ?? '—'}</dd></div>
          <div>
            <dt className="eyebrow">Buddy</dt>
            <dd className="font-display text-lg text-ink">{s.buddy_name ?? s.buddy_personnel_id ?? <span className="font-mono text-sm text-flare">SOLO (lead override)</span>}</dd>
          </div>
          <div><dt className="eyebrow">Due back</dt><dd className="num font-mono text-ink">{clock(s.expected_return_time)}</dd></div>
          <div><dt className="eyebrow">Status</dt><dd className="font-mono text-ink">{s.safety_status}</dd></div>
        </dl>
        <HoldButton tone="cobalt" label="Check in — returned" className="w-full" disabled={busy}
          onConfirm={() => void act(() => db.closeSortie({ id: s.id }), `${s.destination} sortie closed — team checked in`)}>
          <Footprints size={18} aria-hidden /> Hold to check in — returned
        </HoldButton>
      </CardContent>
    </Card>
  );
}

function StartSortieDialog({ open, onOpenChange, people, now }: { open: boolean; onOpenChange: (o: boolean) => void; people: Row[]; now: number }) {
  const { session, toast } = useField();
  const isLead = session?.role === 'STATION_LEAD';
  const [lead, setLead] = useState('');
  const [buddy, setBuddy] = useState('');
  const [dest, setDest] = useState('');
  const [ret, setRet] = useState('');
  const [solo, setSolo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setLead(''); setBuddy(''); setDest(''); setRet(''); setSolo(false); setError(null); } }, [open]);

  const retMs = ret ? Date.parse(ret) : NaN;
  const retIso = Number.isNaN(retMs) ? null : new Date(retMs).toISOString();
  const ready = lead && dest.trim() && retIso && (buddy || (solo && isLead));

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await db.startSortie({ leadId: lead, buddyId: solo ? null : buddy, destination: dest, expectedReturn: retIso!, soloOverride: solo, role: session!.role });
      haptic(30);
      toast(`Sortie to ${dest.trim()} started${solo ? ' — SOLO override logged' : ''}`, 'ok');
      onOpenChange(false);
    } catch (e) {
      haptic([80, 60, 80]);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Start sortie</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-slate">Only people marked on station can go out. Both are checked back in together.</DialogDescription>
        <form className="mt-5 space-y-4" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
          <Field label="Lead">
            {(id) => (
              <Select id={id} value={lead} onChange={(ev) => { setLead(ev.target.value); if (ev.target.value === buddy) setBuddy(''); }}>
                <option value="">Choose lead…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role ?? '—'}</option>)}
              </Select>
            )}
          </Field>

          {!solo && (
            <Field label="Buddy" hint={people.length < 2 ? 'Fewer than two people on station — a buddy sortie is not possible.' : undefined}>
              {(id) => (
                <Select id={id} value={buddy} onChange={(ev) => setBuddy(ev.target.value)}>
                  <option value="">Choose buddy…</option>
                  {people.filter((p) => p.id !== lead).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.role ?? '—'}</option>)}
                </Select>
              )}
            </Field>
          )}

          {isLead ? (
            <div className="space-y-2">
              <Toggle checked={solo} onChange={(v) => { setSolo(v); if (v) setBuddy(''); }} label="Solo sortie (lead override)" description="Waives the two-person rule for this sortie." />
              {solo && <p role="alert" className="border border-caution bg-caution/10 px-3 py-2 text-sm text-ink">Solo sorties are audited as a Station Lead override and reported to HQ on next sync.</p>}
            </div>
          ) : (
            <p className="border border-structure/40 bg-canvas px-3 py-2 text-sm text-slate">Two-person rule: every sortie needs a buddy. Only a Station Lead session can authorise a solo sortie.</p>
          )}

          <Field label="Destination">
            {(id) => <Input id={id} value={dest} onChange={(ev) => setDest(ev.target.value)} placeholder="e.g. Ice core site B, weather mast 3" />}
          </Field>

          <Field label="Expected return" hint={retIso ? `Due back ${clock(retIso)}` : 'Pick a quick time or set it exactly.'}>
            {(id) => (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 4, 8].map((h) => (
                    <Button key={h} variant="outline" onClick={() => setRet(toLocalInput(Date.now() + h * 3_600_000))}>+{h}h</Button>
                  ))}
                </div>
                <Input id={id} type="datetime-local" value={ret} min={toLocalInput(now)} onChange={(ev) => setRet(ev.target.value)} className="font-mono" />
              </div>
            )}
          </Field>

          {error && <ErrorNote>{error}</ErrorNote>}

          <Button type="submit" size="lg" className="w-full" disabled={!ready || busy}>
            {!lead ? 'Choose a lead' : !solo && !buddy ? 'Choose a buddy' : !dest.trim() ? 'Enter destination' : !retIso ? 'Set expected return' : 'Start sortie'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- muster board ----------

function PersonCard({ p, sortie, now }: { p: Row; sortie?: Row; now: number }) {
  const { busy, act } = useAct();
  const st = STATUS[p.status] ?? { label: String(p.status ?? '—'), icon: House, variant: 'neutral' as const };
  const late = sortie ? isOverdue(sortie, now) : false;
  const set = (status: 'ON_STATION' | 'IN_TRANSIT' | 'EVACUATED') =>
    act(() => db.setPersonnelStatus({ id: p.id, status }), `${p.name} → ${STATUS[status].label.toLowerCase()}`);

  return (
    <Card className={cn('flex flex-col', late && 'border-flare')}>
      <div className="flex items-start justify-between gap-2 border-b border-structure px-4 py-3">
        <div className="min-w-0">
          <div className="truncate font-display text-xl leading-tight text-ink">{p.name ?? '—'}</div>
          <div className="text-sm text-slate">{p.role ?? '—'}</div>
        </div>
        {late ? <Badge variant="critical"><Siren size={12} aria-hidden />Overdue</Badge>
          : <Badge variant={st.variant}><st.icon size={12} aria-hidden />{st.label}</Badge>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 px-4 py-3 text-sm">
        <dt className="eyebrow self-center">Blood</dt><dd className="font-mono text-ink">{p.blood_group || '—'}</dd>
        <dt className="eyebrow self-center">Contact</dt><dd className="truncate font-mono text-ink">{p.emergency_contact || '—'}</dd>
      </dl>
      <div className="mt-auto flex gap-2 border-t border-structure p-3">
        {p.status === 'ON_STATION' && <>
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => set('IN_TRANSIT')}><Plane size={14} aria-hidden />In transit</Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => set('EVACUATED')}><Ambulance size={14} aria-hidden />Evacuated</Button>
        </>}
        {(p.status === 'IN_TRANSIT' || p.status === 'EVACUATED') && (
          <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => set('ON_STATION')}><House size={14} aria-hidden />Back on station</Button>
        )}
        {p.status === 'FIELD_SORTIE' && (
          // ponytail: no direct check-in here on purpose — returning is done by closing the sortie above.
          <p className="flex min-h-tap items-center gap-1.5 font-mono text-xs text-slate">
            <MountainSnow size={14} aria-hidden />
            {sortie ? <>On sortie → <span className="text-ink">{sortie.destination ?? "—"}</span> · check in via the sortie</> : 'On sortie → — · no open sortie on this tablet; refresh from HQ'}
          </p>
        )}
      </div>
    </Card>
  );
}
