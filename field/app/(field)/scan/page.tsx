'use client';
import { useCallback, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Camera, CameraOff, FileText, Keyboard, RotateCcw, ScanLine, SearchX } from 'lucide-react';
import { useField } from '../../../lib/field-context';
import { db, useLiveQuery } from '../../../lib/db/client';
import { stationName } from '../../../lib/session';
import { haptic } from '../../../lib/utils';
import { QrScanner } from '../../../components/QrScanner';
import { ExpiryBadge } from '../../../components/shell/AssetSheet';
import { Card, CardHeader, CardContent, PageHead, Empty } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Field, Input } from '../../../components/ui/field';

interface Hit { code: string; id: string | null; name: string | null; at: number }

const DRILL_CODES = ['FUEL-DIESEL-001', 'O2-CYL-47L-003', 'MED-ANTIBIOTIC-005', 'MED-TRAUMA-006', 'SPARE-BRG-6205-007', 'UNKNOWN-CODE-999'];
const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function ScanPage() {
  const { session, stationLabel, openAsset, toast, prefs } = useField();
  const [camera, setCamera] = useState(false);
  const [code, setCode] = useState('');
  const [hit, setHit] = useState<Hit | null>(null);
  const [recent, setRecent] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Live: the card's qty updates the moment a quick action (or the sheet) records a movement.
  const live = useLiveQuery(() => (hit?.id ? db.getAsset(hit.id) : Promise.resolve(null)), ['assets', 'lots'], [hit?.id]);
  const a = live.data?.asset;

  const lookup = useCallback(async (raw: string) => {
    const c = raw.trim();
    if (!c) return;
    try {
      // Labels are upper-case; a lower-case hardware keyboard shouldn't cause a false "not found".
      const found = (await db.findByCode(c)) ?? (c !== c.toUpperCase() ? await db.findByCode(c.toUpperCase()) : null);
      haptic(found ? 30 : [80, 60, 80]);
      const h: Hit = { code: c, id: found?.id ?? null, name: found?.name ?? null, at: Date.now() };
      setHit(h);
      setRecent((r) => [h, ...r.filter((x) => x.code !== c)].slice(0, 8));
    } catch (e) {
      toast((e as Error).message, 'alert');
    }
  }, [toast]);

  // Explicit, literal tx type per button — never a shared "current type" that a restock could inherit.
  async function quick(type: 'CONSUME' | 'IN') {
    if (!a) return;
    setBusy(true);
    try {
      const r = await db.recordTx({ assetId: a.id, type, qty: 1 });
      haptic(30);
      toast(`${type === 'IN' ? 'Received' : 'Consumed'} 1 ${r.unit} · ${r.sku} → ${r.newQty} ${r.unit}${prefs.drill ? ' (DRILL)' : ''}`, 'ok');
    } catch (e) {
      haptic([80, 60, 80]);
      toast((e as Error).message, 'alert');
    } finally {
      setBusy(false);
    }
  }

  function tryAgain() {
    setHit(null);
    setCode('');
    inputRef.current?.focus();
  }

  const offStation = a && a.station_id && a.station_id !== session!.stationId;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHead eyebrow={`Scan · ${stationLabel}`} title="Point at a crate label">
        Camera, typed code or a hardware scanner — every lookup runs against this tablet&apos;s records, no link needed.
      </PageHead>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-label="Scanner" className="space-y-4">
          <Card>
            <CardHeader eyebrow="Camera" action={
              <Button variant={camera ? 'ghost' : 'primary'} onClick={() => setCamera((v) => !v)}>
                {camera ? <><CameraOff size={18} aria-hidden />Stop camera</> : <><Camera size={18} aria-hidden />Start camera</>}
              </Button>
            } />
            <CardContent>
              <QrScanner active={camera} onScan={lookup} label="Crate label" />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3">
              <form onSubmit={(e) => { e.preventDefault(); void lookup(code); }} className="flex items-end gap-2">
                <Field label="Barcode / SKU" className="flex-1">
                  {(id) => (
                    <Input id={id} ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. FUEL-DIESEL-001"
                      inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search" className="font-mono" />
                  )}
                </Field>
                <Button type="submit" disabled={!code.trim()}><ScanLine size={18} aria-hidden />Look up</Button>
              </form>
              <p className="flex items-center gap-2 text-xs text-slate"><Keyboard size={14} aria-hidden />Hardware scanner? Just scan — it works on every screen.</p>
            </CardContent>
          </Card>
        </section>

        <section aria-label="Scan result" aria-live="polite" className="space-y-4">
          {!hit && <Empty title="No scan yet">Point the camera at a crate label, type its code, or scan with a hardware scanner.</Empty>}

          {hit && !hit.id && (
            <div role="alert" className="border border-flare bg-surface">
              <div className="flex items-center gap-3 border-b border-structure px-4 py-3">
                <SearchX size={20} className="text-flare" aria-hidden />
                <span className="font-mono text-sm font-semibold text-flare">NOT FOUND</span>
              </div>
              <div className="space-y-3 p-4">
                <p className="text-ink">No item with this code on this tablet.</p>
                <p className="break-all border border-structure bg-canvas px-3 py-2 font-mono text-lg text-ink">{hit.code}</p>
                <p className="text-sm text-slate">Check the label is clean and the whole code was read, or type it in.</p>
                <Button variant="ghost" onClick={tryAgain}><RotateCcw size={18} aria-hidden />Try again</Button>
              </div>
            </div>
          )}

          {hit?.id && (
            <Card>
              {live.error ? <CardContent><p className="text-flare">{live.error}</p></CardContent>
                : live.data === undefined ? <CardContent><p className="font-mono text-sm text-slate">Loading…</p></CardContent>
                : !a ? <CardContent><p className="text-slate">Item {hit.code} is no longer on this tablet.</p></CardContent>
                : (
                  <>
                    <CardHeader eyebrow={<>Found · <span className="font-mono">{a.sku}</span></>} title={a.name} />
                    <CardContent className="space-y-4">
                      <div className="flex items-end gap-3">
                        <span className="num font-mono text-5xl font-semibold leading-none text-ink">{a.qty}</span>
                        <span className="pb-1 font-mono text-lg text-slate">{a.unit}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {a.criticality === 'CRITICAL' && <Badge variant="solid">Critical supply</Badge>}
                        <ExpiryBadge date={a.expiry_date} />
                        <Badge>{a.container_id ?? '—'} / {a.crate_id ?? '—'}{a.temp_zone ? ` · ${a.temp_zone}` : ''}</Badge>
                      </div>
                      {offStation && (
                        <p role="alert" className="border border-caution bg-caution/10 px-3 py-2 text-sm text-ink">
                          Registered to <b>{stationName(a.station_id)}</b> — check the label before moving stock.
                        </p>
                      )}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button variant="solid" size="lg" disabled={busy || !(a.qty > 0)} onClick={() => quick('CONSUME')}>
                          <ArrowUpFromLine size={18} aria-hidden />Consume 1 {a.unit}
                        </Button>
                        <Button variant="ghost" size="lg" disabled={busy} onClick={() => quick('IN')}>
                          <ArrowDownToLine size={18} aria-hidden />Receive 1 {a.unit}
                        </Button>
                      </div>
                      <Button size="lg" className="w-full" onClick={() => openAsset(a.id)}>
                        <FileText size={18} aria-hidden />Open full record
                      </Button>
                    </CardContent>
                  </>
                )}
            </Card>
          )}

          {recent.length > 0 && (
            <Card>
              <CardHeader eyebrow="Recent scans · this session" />
              <ul className="divide-y divide-structure/20">
                {recent.map((r) => (
                  <li key={r.code}>
                    <button type="button" onClick={() => setHit(r)} className="flex min-h-tap w-full items-center gap-3 px-4 py-2 text-left hover:bg-canvas">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-sm font-semibold text-ink">{r.code}</span>
                        <span className="block truncate text-xs text-slate">{r.name ?? 'Not found on this tablet'}</span>
                      </span>
                      {!r.id && <Badge variant="critical">Not found</Badge>}
                      <span className="num shrink-0 font-mono text-xs text-slate">{hhmm(r.at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {prefs.drill && (
            <Card className="border-dashed">
              <CardHeader eyebrow="Simulate scan" action={<Badge variant="solid">DRILL</Badge>} />
              <CardContent className="space-y-2">
                <p className="text-xs text-slate">Drill mode only — feeds a code through the same lookup as the camera.</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {DRILL_CODES.map((c) => (
                    <Button key={c} variant="outline" size="sm" className="justify-start" onClick={() => void lookup(c)}>{c}</Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
