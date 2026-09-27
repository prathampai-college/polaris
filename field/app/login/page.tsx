'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { useField } from '../../lib/field-context';
import { STATIONS, deviceId as getDeviceId, setDeviceId, enrolledStation, type Role } from '../../lib/session';
import { Button } from '../../components/ui/button';
import { Field, Input, Segmented } from '../../components/ui/field';
import { cn } from '../../lib/utils';

export default function LoginPage() {
  const { session, login, storage, secure, toast } = useField();
  const router = useRouter();
  const [station, setStation] = useState<string>('ST-BHARATI');
  const [pin, setPin] = useState('');
  const [role, setRole] = useState<Role>('FIELD_OP');
  const [device, setDevice] = useState('');
  const [enrolled, setEnrolled] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDevice(getDeviceId());
    const e = enrolledStation();
    setEnrolled(e);
    if (e) setStation(e);
  }, []);
  useEffect(() => { if (session) router.replace('/'); }, [session, router]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (device.trim()) setDeviceId(device.trim());
      const s = await login({ stationId: station, pin, role, deviceId: device.trim() || getDeviceId() });
      if (role === 'STATION_LEAD' && s.role !== 'STATION_LEAD') toast('Signed in as FIELD OP — HQ did not authorise station-lead on this device', 'alert');
      router.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="tickgrid grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <section className="flex flex-col justify-between border-b border-structure bg-ink p-8 text-canvas lg:border-b-0 lg:border-r lg:p-14">
        <div className="flex items-center gap-2 font-mono text-sm font-bold tracking-[0.2em]">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden className="text-phosphor"><path d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z" fill="currentColor" /></svg>
          POLARIS · FIELD
        </div>
        <div className="my-12 lg:my-0">
          <h1 className="font-display text-5xl leading-[0.95] tracking-[-0.02em] sm:text-7xl">Station<br /><em className="text-phosphor">logistics,</em><br />link or no link.</h1>
          <p className="mt-6 max-w-md text-canvas/70">Stock, muster and SOS are recorded on this tablet first, then carried to HQ over the satellite link — or by hand, as DTN bundles, when there isn&apos;t one.</p>
        </div>
        <dl className="grid grid-cols-3 gap-px border border-canvas/20 bg-canvas/20 font-mono text-xs">
          {[
            ['STORAGE', storage.state === 'opfs' ? 'ON-DEVICE' : storage.state === 'booting' ? '…' : 'TEMPORARY'],
            ['CONTEXT', secure ? 'SECURE' : 'INSECURE HTTP'],
            ['DEVICE', device || '…'],
          ].map(([k, v]) => (
            <div key={k} className="bg-ink p-3"><dt className="text-canvas/50">{k}</dt><dd className={cn('mt-1 truncate font-semibold', v === 'TEMPORARY' || v === 'INSECURE HTTP' ? 'text-flare' : 'text-canvas')}>{v}</dd></div>
          ))}
        </dl>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-10">
        <form onSubmit={submit} className="w-full max-w-md space-y-5 border border-structure bg-surface p-6 shadow-panel sm:p-8">
          <div>
            <div className="eyebrow">Sign in</div>
            <h2 className="mt-1 font-display text-4xl text-ink">Unlock tablet</h2>
          </div>

          <div role="radiogroup" aria-label="Station" className="grid grid-cols-3 border border-structure">
            {STATIONS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={station === s.id} onClick={() => setStation(s.id)}
                className={cn('min-h-[64px] border-r border-structure px-2 text-left last:border-r-0', station === s.id ? 'bg-ink text-canvas' : 'bg-surface text-ink hover:bg-canvas')}>
                <span className="block font-display text-xl leading-none">{s.name}</span>
                <span className={cn('mt-1 block truncate font-mono text-[0.65rem] uppercase tracking-[0.06em]', station === s.id ? 'text-canvas/70' : 'text-slate')}>{s.region.split(' · ')[0]}</span>
              </button>
            ))}
          </div>
          {enrolled && enrolled !== station && <p className="text-xs text-slate">This tablet is enrolled to {STATIONS.find((s) => s.id === enrolled)?.name}; another station needs a live link to HQ.</p>}

          <Segmented<Role> label="Role" value={role} onChange={setRole} options={[{ value: 'FIELD_OP', label: 'Field op' }, { value: 'STATION_LEAD', label: 'Station lead' }]} />

          <Field label="Station PIN" error={error}>
            {(id) => <Input id={id} type="password" autoCapitalize="characters" autoComplete="current-password" spellCheck={false} value={pin} onChange={(e) => setPin(e.target.value)} className="font-mono text-xl tracking-[0.2em]" required />}
          </Field>

          <details className="group border border-structure/30 px-3 py-2">
            <summary className="cursor-pointer font-mono text-xs font-semibold uppercase tracking-[0.08em] text-slate">Device identity</summary>
            <Field label="Device ID" className="mt-3" hint="Stable per tablet — used in HQ audit and sync. HQ grants station-lead only to authorised device ids.">
              {(id) => <Input id={id} value={device} onChange={(e) => setDevice(e.target.value.toUpperCase())} className="font-mono text-sm" />}
            </Field>
          </details>

          <Button type="submit" size="lg" className="w-full" disabled={busy || !pin}>
            <KeyRound size={18} aria-hidden /> {busy ? 'Checking…' : 'Unlock'}
          </Button>
          <p className="flex items-start gap-2 text-xs text-slate"><ShieldCheck size={14} className="mt-0.5 shrink-0" aria-hidden />First sign-in needs HQ. After that this tablet can unlock offline with the same PIN.</p>
        </form>
      </section>
    </main>
  );
}
