'use client';
import { useState } from 'react';
import { AlertTriangle, Check, HardDrive, Lock, LogOut, ScanBarcode, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useField, type Prefs } from '../../../lib/field-context';
import { db } from '../../../lib/db/client';
import { stationName } from '../../../lib/session';
import { Card, CardHeader, CardContent, PageHead } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { HoldButton } from '../../../components/ui/hold-button';
import { Toggle } from '../../../components/ui/field';
import { clock, cn } from '../../../lib/utils';

// Literal palettes: the theme vars only apply on <html>, so a tile can't preview the other theme via CSS.
const PALETTES = {
  day: { canvas: '#EEF2F6', surface: '#FFFFFF', structure: '#101928', ink: '#0B0F19', cobalt: '#0047FF' },
  night: { canvas: 'rgb(7,11,19)', surface: 'rgb(14,21,33)', structure: 'rgb(74,90,112)', ink: 'rgb(229,235,243)', cobalt: 'rgb(92,140,255)' },
} as const;

const THEMES: { value: Prefs['theme']; label: string; hint: string }[] = [
  { value: 'day', label: 'Day / Glare', hint: 'High contrast on white — readable in snow glare.' },
  { value: 'night', label: 'Polar Night', hint: 'Dark, for the 24 h dark season and dim huts.' },
];

function MiniUi({ theme }: { theme: Prefs['theme'] }) {
  const p = PALETTES[theme];
  return (
    <div aria-hidden className="space-y-1.5 p-2" style={{ background: p.canvas, border: `1px solid ${p.structure}` }}>
      <div className="h-2.5" style={{ background: p.structure }} />
      <div className="flex items-center gap-1.5 px-1.5 py-1.5" style={{ background: p.surface, border: `1px solid ${p.structure}` }}>
        <div className="h-2 w-2" style={{ background: p.ink }} />
        <div className="h-1.5 flex-1" style={{ background: p.ink, opacity: 0.7 }} />
        <div className="h-1.5 w-6" style={{ background: p.ink, opacity: 0.35 }} />
      </div>
      <div className="ml-auto h-4 w-14" style={{ background: p.cobalt, border: `1px solid ${p.structure}` }} />
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-structure/20 py-2 last:border-b-0">
      <dt className="eyebrow">{k}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-sm text-ink">{children}</dd>
    </div>
  );
}

export default function SettingsPage() {
  const { session, prefs, setPrefs, logout, storage, secure, outbox, urls, toast } = useField();
  const s = session!;
  const unsynced = outbox?.unsynced ?? 0;
  const [understood, setUnderstood] = useState(false);
  const [wiping, setWiping] = useState(false);

  const wipe = async () => {
    setWiping(true);
    try {
      await db.wipe();
      setUnderstood(false);
      toast('Local data wiped — station register reseeded', 'ok');
    } catch (e) {
      toast(`Wipe failed: ${(e as Error).message}`, 'alert');
    } finally {
      setWiping(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHead eyebrow={`Settings · ${s.deviceId}`} title="This tablet">
        Display, drill mode, sign-in and on-device storage. Display settings are kept on this tablet only.
      </PageHead>

      {/* Display */}
      <Card>
        <CardHeader eyebrow="Display" title="Theme & sizing" />
        <CardContent className="space-y-4">
          <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-2">
            {THEMES.map((t) => {
              const on = prefs.theme === t.value;
              return (
                <button
                  key={t.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setPrefs({ theme: t.value })}
                  className={cn('min-h-tap border-2 bg-surface p-3 text-left transition-colors', on ? 'border-cobalt' : 'border-structure/30 hover:border-structure')}
                >
                  <MiniUi theme={t.value} />
                  <span className="mt-3 flex items-center justify-between gap-2">
                    <span className="font-display text-2xl leading-none text-ink">{t.label}</span>
                    {on ? <Badge variant="active"><Check size={12} aria-hidden />Selected</Badge> : <Badge>Tap to use</Badge>}
                  </span>
                  <span className="mt-1 block text-xs text-slate">{t.hint}</span>
                </button>
              );
            })}
          </div>

          <div className="space-y-2">
            <Toggle checked={prefs.glove} onChange={(v) => setPrefs({ glove: v })} label="Glove mode" description="Every control grows to 56 px for gloved hands" />
            <p className="px-1 font-mono text-xs text-slate">Tap target now <span className="num font-semibold text-ink">{prefs.glove ? 56 : 44} px</span> — the switches on this page are that tall.</p>
            <Toggle checked={prefs.bigText} onChange={(v) => setPrefs({ bigText: v })} label="Larger text" description="All text 12.5% larger" />
          </div>
        </CardContent>
      </Card>

      {/* Drill */}
      <Card>
        <CardHeader
          eyebrow="Training"
          title="Drill mode"
          action={prefs.drill
            ? <span className="flex items-center gap-2"><span aria-hidden className="hazard block h-6 w-10 border border-structure" /><Badge variant="critical">Drill on</Badge></span>
            : <Badge>Off</Badge>}
        />
        <CardContent className="space-y-3">
          <Toggle checked={prefs.drill} onChange={(v) => setPrefs({ drill: v })} label="Drill mode" description="Practise emergencies and outages without touching real operations" />
          <ul className="list-inside list-disc space-y-1 text-sm text-slate">
            <li>Simulated barcode scans, so stock flows can be run without labels.</li>
            <li>Simulated LiDAR position fixes for locating assets.</li>
            <li>A simulated satellite-link cut in Comms, to rehearse store-and-forward.</li>
          </ul>
          <p className="border border-structure/30 bg-canvas px-3 py-2 text-sm text-ink">
            While on, every change written on this tablet is audit-tagged <span className="font-mono font-semibold">DRILL</span> so HQ can tell practice from real activity.
          </p>
        </CardContent>
      </Card>

      {/* Session & device */}
      <Card>
        <CardHeader eyebrow="Session & device" title={stationName(s.stationId)} />
        <CardContent className="space-y-4">
          <dl>
            <Row k="Station">{stationName(s.stationId)} <span className="text-slate">({s.stationId})</span></Row>
            <Row k="Role">{s.role === 'STATION_LEAD' ? 'Station lead' : 'Field operator'}</Row>
            <Row k="Device id">{s.deviceId}</Row>
            <Row k="Token expires">{s.exp ? clock(new Date(s.exp).toISOString()) : 'no expiry'}</Row>
            <Row k="Unlocked">{s.offlineUnlock ? 'Offline — PIN checked on this tablet' : 'Online — verified by HQ'}</Row>
            <Row k="HQ">{urls?.hqUrl ?? '—'}</Row>
            <Row k="Sync gateway">{urls?.gatewayUrl ?? '—'}</Row>
          </dl>
          <p className="text-xs text-slate">Station-lead rights are granted by HQ per device, not chosen here.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button variant="solid" size="lg" onClick={() => logout()}><Lock size={18} aria-hidden />Lock tablet</Button>
            <HoldButton label="Forget this tablet's sign-in" onConfirm={() => logout(true)}>
              <LogOut size={18} aria-hidden />Forget sign-in
            </HoldButton>
          </div>
          <p className="text-xs text-slate">
            <strong className="text-ink">Lock</strong> keeps offline unlock with your PIN. <strong className="text-ink">Forget</strong> removes it — the next sign-in on this tablet must reach HQ live.
          </p>
        </CardContent>
      </Card>

      {/* Storage */}
      <Card>
        <CardHeader eyebrow="Storage" title="Data on this tablet" />
        <CardContent className="space-y-4">
          <dl>
            <Row k="Storage">
              {storage.state === 'opfs' ? <Badge variant="ok"><HardDrive size={12} aria-hidden />On-device (OPFS) · persistent</Badge>
                : storage.state === 'booting' ? <Badge>Starting…</Badge>
                : <Badge variant="critical"><AlertTriangle size={12} aria-hidden />{storage.state === 'fatal' ? 'Failed' : 'Temporary · lost on reload'}</Badge>}
            </Row>
            <Row k="Secure context">
              {secure ? <Badge variant="ok"><ShieldCheck size={12} aria-hidden />Yes</Badge>
                : <Badge variant="caution"><ShieldAlert size={12} aria-hidden />No — offline PIN unlock unavailable</Badge>}
            </Row>
            <Row k="Unsynced changes"><span className="num font-semibold">{outbox ? unsynced : '—'}</span></Row>
          </dl>
          {(storage.state === 'memory' || storage.state === 'fatal') && (
            <p role="alert" className="border border-flare bg-flare/10 px-3 py-2 text-sm text-ink">
              <span className="font-mono font-semibold text-flare">NOT SAVING · </span>
              {storage.reason ?? 'On-device storage unavailable — close other POLARIS tabs and reload.'}
            </p>
          )}

          <div className="space-y-3 border-t border-structure pt-4">
            <div>
              <h3 className="font-mono text-sm font-semibold text-ink">Wipe local data</h3>
              <p className="text-sm text-slate">For handing this tablet to another station. Deletes every record, the outbox and the sync key on this tablet, then reloads the station register. Your sign-in is kept.</p>
            </div>
            {unsynced > 0 && (
              <>
                <p role="alert" className="border border-flare bg-flare/10 px-3 py-2 text-sm text-ink">
                  <span className="font-mono font-semibold text-flare">WARNING · </span>
                  <span className="num font-semibold">{unsynced}</span> change{unsynced === 1 ? '' : 's'} on this tablet {unsynced === 1 ? 'has' : 'have'} NOT reached HQ and will be lost.
                </p>
                <Toggle checked={understood} onChange={setUnderstood} label={`I understand ${unsynced} change${unsynced === 1 ? '' : 's'} will be lost`} />
              </>
            )}
            <HoldButton label="Wipe local data" tone="flare" className="w-full" disabled={wiping || (unsynced > 0 && !understood)} onConfirm={() => void wipe()}>
              <Trash2 size={18} aria-hidden />{wiping ? 'Wiping…' : 'Hold to wipe local data'}
            </HoldButton>
          </div>
        </CardContent>
      </Card>

      {/* About */}
      <Card>
        <CardHeader eyebrow="About" title="POLARIS Field" />
        <CardContent className="space-y-2 text-sm text-slate">
          <p>Stock, personnel, sorties, emergencies and indents for this station are kept in a SQLite database on this tablet (browser OPFS storage), so everything works with no satellite link.</p>
          <p>Changes queue in an outbox and sync to HQ through the gateway when a link is up. Sign-in and display settings live in this browser&apos;s local storage.</p>
          <p className="flex items-center gap-2 text-ink"><ScanBarcode size={16} aria-hidden />Hardware barcode scanners work on every screen.</p>
        </CardContent>
      </Card>
    </div>
  );
}
