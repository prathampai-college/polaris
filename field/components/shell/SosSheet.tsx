'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Siren } from 'lucide-react';
import { EMERGENCY_TYPES } from '../../lib/labels';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { HoldButton } from '../ui/hold-button';
import { Field, Input } from '../ui/field';
import { useField } from '../../lib/field-context';
import { db, useLiveQuery } from '../../lib/db/client';
import { cn } from '../../lib/utils';

const TYPES = EMERGENCY_TYPES;

export const UNKNOWN = 'LOCATION UNKNOWN';

export function SosSheet() {
  const { sosOpen, setSosOpen, session, toast } = useField();
  const router = useRouter();
  const [type, setType] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [sortieId, setSortieId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: sorties } = useLiveQuery(() => db.listSorties(), ['field_sorties'], [session?.stationId, sosOpen]);
  const { data: map } = useLiveQuery(() => db.stationMap(), ['containers'], [session?.stationId, sosOpen]);

  // Known places only — active sortie destinations and store containers. No invented sectors.
  const places = useMemo(() => {
    const out: { label: string; sortieId?: string }[] = [];
    for (const s of sorties ?? []) if (s.safety_status === 'ACTIVE' || s.safety_status === 'OVERDUE') out.push({ label: `Sortie · ${s.destination} (${s.lead_name ?? s.lead_personnel_id})`, sortieId: s.id });
    for (const c of map?.containers ?? []) out.push({ label: `Store ${c.id} · ${c.type} · bay ${c.position_2d}` });
    return out;
  }, [sorties, map]);

  const reset = () => { setType(null); setLocation(''); setSortieId(null); setGps(null); };
  const [gps, setGps] = useState<string | null>(null);

  // A GPS fix beats any description for a rescue team. Needs a secure context and
  // sky view; whiteout or indoors may time out, so it never blocks transmitting.
  function takeGpsFix() {
    if (!('geolocation' in navigator)) { setGps('GPS not available on this device'); return; }
    setGps('Getting GPS fix…');
    navigator.geolocation.getCurrentPosition(
      ({ coords: c }) => {
        const label = `GPS ${Math.abs(c.latitude).toFixed(5)}°${c.latitude < 0 ? 'S' : 'N'} ${Math.abs(c.longitude).toFixed(5)}°${c.longitude < 0 ? 'W' : 'E'} ±${Math.round(c.accuracy)} m`;
        setLocation(label); setSortieId(null); setGps(null);
      },
      (err) => setGps(`No GPS fix (${err.message || 'denied'}) — pick a place or describe it`),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  async function transmit() {
    if (!type || !location.trim()) return;
    setBusy(true);
    try {
      await db.raiseSOS({ type, location, sortieId });
      toast('SOS logged on this tablet — transmitting to HQ and nearby units', 'alert');
      setSosOpen(false);
      reset();
      router.push('/muster');
    } catch (e) {
      toast((e as Error).message, 'alert');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={sosOpen} onOpenChange={(o) => { setSosOpen(o); if (!o) reset(); }}>
      <SheetContent side="bottom" className="mx-auto max-w-3xl border-x p-0">
        <div className="flex items-center gap-3 border-b border-structure bg-flare px-5 py-4 pr-16 text-white">
          <Siren size={24} aria-hidden />
          <div>
            <SheetTitle className="font-display text-3xl leading-none">Raise SOS</SheetTitle>
            <SheetDescription className="mt-1 text-sm text-white/90">Logged locally first — works with no link. Goes out on the next channel available.</SheetDescription>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <div>
            <div className="eyebrow mb-2">1 · What is happening</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup" aria-label="Emergency type">
              {TYPES.map(({ v, label, icon: Icon }) => (
                <button key={v} type="button" role="radio" aria-checked={type === v} onClick={() => setType(v)}
                  className={cn('flex min-h-[72px] flex-col items-center justify-center gap-1 border border-structure font-mono text-xs font-semibold uppercase tracking-[0.06em]',
                    type === v ? 'bg-flare text-white' : 'bg-surface text-ink hover:border-flare')}>
                  <Icon size={24} aria-hidden />{label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="eyebrow mb-2">2 · Where</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={takeGpsFix}
                className={cn('min-h-tap border border-cobalt px-3 font-mono text-sm font-semibold', location.startsWith('GPS ') ? 'bg-cobalt text-white' : 'bg-surface text-cobalt')}>
                {location.startsWith('GPS ') ? location : 'Use GPS fix'}
              </button>
              {places.map((p) => (
                <button key={p.label} type="button" onClick={() => { setLocation(p.label); setSortieId(p.sortieId ?? null); }}
                  className={cn('min-h-tap border border-structure px-3 text-left text-sm', location === p.label ? 'bg-ink text-canvas' : 'bg-surface text-ink hover:border-cobalt')}>
                  {p.label}
                </button>
              ))}
              <button type="button" onClick={() => { setLocation(UNKNOWN); setSortieId(null); }}
                className={cn('min-h-tap border border-dashed border-structure px-3 font-mono text-sm font-semibold', location === UNKNOWN ? 'bg-ink text-canvas' : 'bg-surface text-slate')}>
                {UNKNOWN}
              </button>
            </div>
            {gps && <p role="status" className="mt-2 text-sm text-slate">{gps}</p>}
            <Field label="Or describe it" className="mt-3" hint="Landmark, bearing/distance from base, grid ref…">
              {(id) => <Input id={id} value={location === UNKNOWN || location.startsWith('GPS ') || places.some((p) => p.label === location) ? '' : location} onChange={(e) => { setLocation(e.target.value); setSortieId(null); }} placeholder="e.g. 2 km NE of Bharati, near fuel farm" />}
            </Field>
          </div>

          <HoldButton label="Transmit SOS" onConfirm={transmit} disabled={!type || !location.trim() || busy} className="w-full min-h-[72px] text-lg">
            <Siren size={22} aria-hidden /> {!type ? 'Choose emergency type' : !location.trim() ? 'Choose a location' : 'Hold to transmit SOS'}
          </HoldButton>
        </div>
      </SheetContent>
    </Sheet>
  );
}
