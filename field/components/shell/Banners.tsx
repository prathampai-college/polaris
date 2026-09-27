'use client';
import Link from 'next/link';
import { Siren } from 'lucide-react';
import { useField } from '../../lib/field-context';
import { db, useLiveQuery } from '../../lib/db/client';
import { ago } from '../../lib/utils';
import { emergencyType } from '../../lib/labels';

export function DrillBanner() {
  const { prefs, setPrefs } = useField();
  if (!prefs.drill) return null;
  return (
    <div className="flex items-stretch border-b border-structure">
      <div aria-hidden className="hazard w-10 shrink-0 sm:w-24" />
      <div className="flex flex-1 flex-wrap items-center justify-between gap-2 bg-ink px-3 py-1.5 font-mono text-xs font-semibold tracking-[0.08em] text-canvas">
        <span>DRILL MODE — simulators visible · local writes audit-tagged DRILL</span>
        <button type="button" onClick={() => setPrefs({ drill: false })} className="min-h-[32px] border border-canvas/40 px-2 hover:bg-canvas hover:text-ink">END DRILL</button>
      </div>
      <div aria-hidden className="hazard w-10 shrink-0 sm:w-24" />
    </div>
  );
}

/** Active emergency is visible from every screen until it is resolved. */
export function EmergencyBanner() {
  const { session } = useField();
  const { data } = useLiveQuery(() => db.listEmergencies(), ['emergencies'], [session?.stationId]);
  const open = (data ?? []).filter((e) => e.status !== 'RESOLVED');
  if (!open.length) return null;
  const e = open[0];
  return (
    <Link href="/muster" className="flex min-h-tap items-center gap-3 border-b border-structure bg-flare px-4 py-2 text-white hover:bg-ink">
      <Siren size={20} className="shrink-0 animate-blink" aria-hidden />
      <span className="font-mono text-sm font-bold tracking-[0.08em]">{emergencyType(e.type).label} · {e.status}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{e.location_coord ?? 'location not given'} · raised {ago(e.ts)}</span>
      {open.length > 1 && <span className="font-mono text-xs">+{open.length - 1} more</span>}
      <span className="font-mono text-xs font-semibold">TRIAGE →</span>
    </Link>
  );
}
