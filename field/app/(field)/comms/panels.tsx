'use client';
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Download, KeyRound, QrCode, ScanLine, ShieldAlert, ShieldCheck, Upload } from 'lucide-react';
import qrcode from 'qrcode-generator';
import { useField } from '../../../lib/field-context';
import { db } from '../../../lib/db/client';
import { Card, CardHeader, CardContent, Empty } from '../../../components/ui/card';
import { Badge, Dot } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Field, Input, Textarea } from '../../../components/ui/field';
import { HoldButton } from '../../../components/ui/hold-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { ago, cn } from '../../../lib/utils';
import type { SyncInfo } from '../../../lib/db/client';

// ---------------------------------------------------------------- shared bits

export type Tone = 'phosphor' | 'slate' | 'caution' | 'flare' | 'ink';
export const LINK: Record<SyncInfo['link'], { label: string; tone: Tone; pulse?: boolean; detail: string }> = {
  live: { label: 'LIVE', tone: 'phosphor', detail: 'Encrypted WebSocket to the camp gateway is open.' },
  connecting: { label: 'CONNECTING', tone: 'slate', pulse: true, detail: 'Opening the gateway socket.' },
  offline: { label: 'DOWN', tone: 'slate', detail: 'Gateway unreachable — writes go to DTN custody. Reconnect is automatic.' },
  key_mismatch: { label: 'KEY MISMATCH', tone: 'flare', pulse: true, detail: 'The gateway cannot read this tablet\'s frames. Provision the station key.' },
  cut: { label: 'CUT · DRILL', tone: 'caution', detail: 'Satellite link cut for a drill on this tablet only.' },
};

export function LinkBadge({ link }: { link: SyncInfo['link'] }) {
  const l = LINK[link];
  const variant = { phosphor: 'live', slate: 'neutral', caution: 'caution', flare: 'critical', ink: 'solid' } as const;
  return <Badge variant={variant[l.tone]}><Dot tone={l.tone === 'ink' ? 'slate' : l.tone} pulse={l.pulse} />{l.label}</Badge>;
}

type ScannerProps = { onScan: (text: string) => void; active: boolean; label?: string };
function ScannerUnavailable() {
  return <p className="border border-dashed border-structure/50 p-3 text-sm text-slate">Camera scanner unavailable on this tablet — paste the text instead.</p>;
}
// Loaded lazily so a missing camera stack never takes the screen down; paste always works.
const QrScanner = dynamic<ScannerProps>(
  () => import('../../../components/QrScanner').then((m) => m.QrScanner).catch(() => ScannerUnavailable),
  { ssr: false, loading: () => <p className="p-3 font-mono text-xs text-slate">Starting camera…</p> },
);
function Scanner(props: ScannerProps) {
  return <ErrorBoundary label="Camera scanner"><QrScanner {...props} /></ErrorBoundary>;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 border-b border-structure/20 py-2 last:border-b-0">
      <dt className="eyebrow pt-0.5">{k}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

function download(lines: string[], name: string) {
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- link & security

const HEX64 = /^[0-9a-f]{64}$/i;

export function LinkPanel({ now }: { now: number }) {
  const { sync, storage, secure, urls, outbox, toast } = useField();
  const [hex, setHex] = useState('');
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);

  const clean = hex.replace(/\s+/g, '');
  const bad = /[^0-9a-f]/i.test(clean);
  const valid = HEX64.test(clean);

  const provision = async (key: string | null) => {
    setBusy(true);
    try {
      await db.setPsk(key);
      const f = key ? key.slice(-4).toLowerCase() : null;
      setHex('');
      setScan(false);
      toast(key ? `Station key …${f} provisioned — reconnecting` : 'Reverted to the insecure dev key — reconnecting', key ? 'ok' : 'info');
    } catch (e) {
      toast((e as Error).message, 'alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader eyebrow="Link & security" action={<LinkBadge link={sync.link} />} />
      <CardContent className="py-2">
        <dl>
          <Row k="Gateway"><span className="break-all font-mono text-xs">{urls?.gatewayUrl ?? 'resolving…'}</span></Row>
          <Row k="HQ"><span className="break-all font-mono text-xs">{urls?.hqUrl ?? 'resolving…'}</span></Row>
          <Row k="Link">{LINK[sync.link].detail}</Row>
          {sync.lastError && <Row k="Last error"><span className="font-mono text-xs text-flare">{sync.lastError}</span></Row>}
          <Row k="HQ push in"><span className="font-mono text-xs">{ago(sync.lastPushAt, now)}</span></Row>
          <Row k="Last ACK"><span className="font-mono text-xs">{ago(outbox?.lastAckAt, now)}</span></Row>
          <Row k="Storage">
            {storage.state === 'opfs' && <span><Badge variant="ok">OPFS · persistent</Badge></span>}
            {storage.state === 'booting' && <span className="font-mono text-xs text-slate">starting…</span>}
            {(storage.state === 'memory' || storage.state === 'fatal') && (
              <span className="block space-y-1">
                <Badge variant="critical">{storage.state === 'memory' ? 'EPHEMERAL · lost on reload' : 'STORAGE FAILED'}</Badge>
                <span className="block text-xs text-slate">{storage.reason ?? 'On-device storage unavailable.'} Close other POLARIS tabs and reload.</span>
              </span>
            )}
          </Row>
          <Row k="Context">
            {secure ? <Badge variant="ok"><ShieldCheck size={12} aria-hidden />Secure</Badge> : (
              <span className="block space-y-1">
                <Badge variant="critical"><ShieldAlert size={12} aria-hidden />Insecure HTTP</Badge>
                <span className="block text-xs text-slate">Frame encryption (WebCrypto) and persistent offline storage need HTTPS or localhost. Load the app from the camp server&apos;s https address.</span>
              </span>
            )}
          </Row>
          <Row k="Sync key">
            {sync.devKey ? (
              <span className="block space-y-1">
                <Badge variant="caution"><KeyRound size={12} aria-hidden />Dev key</Badge>
                <span className="block text-xs text-slate">Frames use the shared development key — anyone with the source can read them. Provision the station key below.</span>
              </span>
            ) : (
              <Badge variant="ok"><KeyRound size={12} aria-hidden />Provisioned{sync.keyFp ? ` · …${sync.keyFp}` : ''}</Badge>
            )}
          </Row>
        </dl>

        <div className="mt-3 space-y-3 border-t border-structure pt-3">
          <Field
            label="Provision station key"
            error={bad ? 'Hex characters only (0–9, a–f).' : null}
            hint={clean ? `${clean.length}/64 hex${valid ? ` · fingerprint …${clean.slice(-4).toLowerCase()}` : ''}` : 'Paste the 64-hex key from the station lead, or scan its QR.'}
          >
            {(id) => (
              <Input id={id} type="password" autoComplete="off" spellCheck={false} value={hex} onChange={(e) => setHex(e.target.value)} className="font-mono text-sm" placeholder="64 hex characters" aria-invalid={bad} />
            )}
          </Field>
          {scan && <Scanner active label="Scan station key QR" onScan={(t) => { setHex(t.trim()); setScan(false); }} />}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => provision(clean)} disabled={!valid || busy}><KeyRound size={16} aria-hidden />Provision</Button>
            <Button variant="ghost" onClick={() => setScan((s) => !s)} aria-pressed={scan}><ScanLine size={16} aria-hidden />{scan ? 'Stop camera' : 'Scan QR'}</Button>
          </div>
          {!sync.devKey && (
            <HoldButton tone="flare" label="Revert to dev key" onConfirm={() => provision(null)} disabled={busy} className="w-full text-xs">
              Hold · revert to dev key
            </HoldButton>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- DTN hand-off

export interface Bundle { bundle_id: string; src: string; dst_station: string | null; created_at: string; ttl: number }

function ttlLeft(created: string, ttl: number, now: number): string {
  const ms = Date.parse(created) + Number(ttl) * 1000 - now;
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return 'expired';
  const h = Math.floor(ms / 3_600_000);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h left` : `${h}h ${Math.floor(ms / 60_000) % 60}m left`;
}

function QrView({ text }: { text: string }) {
  const svg = useMemo(() => {
    try {
      const q = qrcode(0, 'L');
      q.addData(text);
      q.make();
      return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
    } catch {
      return null; // "code length overflow" — too big for one QR
    }
  }, [text]);
  if (!svg) {
    return (
      <div role="alert" className="border border-caution bg-caution/10 p-4 text-sm text-ink">
        This bundle is too large for one QR code ({text.length} chars). Use <b>Copy all as text</b> or <b>Download .txt</b> and move it on a USB stick or paste it on the carrier tablet.
      </div>
    );
  }
  // Safe: SVG string generated locally by qrcode-generator, never user HTML.
  return <div className="mx-auto aspect-square w-full max-w-[320px] border border-structure [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function DtnPanel({ bundles, now }: { bundles: Bundle[] | undefined; now: number }) {
  const { session, toast } = useField();
  const me = session!.deviceId;
  const [exp, setExp] = useState<string[] | null>(null);
  const [i, setI] = useState(0);
  const [impOpen, setImpOpen] = useState(false);
  const [text, setText] = useState('');
  const [scanned, setScanned] = useState<string[]>([]);
  const [scan, setScan] = useState(false);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => [...new Set([...scanned, ...text.split(/\s+/).filter(Boolean)])], [scanned, text]);
  const fileName = `polaris-bundles-${me}-${new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '')}.txt`;

  const openExport = async () => {
    try {
      const list = await db.exportBundles();
      if (!list.length) return toast('No bundles from this tablet in DTN custody — nothing to hand off.', 'info');
      setExp(list);
      setI(0);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'alert');
    }
  };

  const copyAll = async (list: string[]) => {
    try {
      await navigator.clipboard.writeText(list.join('\n'));
      toast(`Copied ${list.length} bundle${list.length === 1 ? '' : 's'} as text`, 'ok');
    } catch {
      download(list, fileName);
      toast('Clipboard blocked — downloaded as a .txt instead', 'info');
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const { saved } = await db.importBundles(all);
      const rest = all.length - saved;
      toast(`Took custody of ${saved} bundle${saved === 1 ? '' : 's'}${rest ? ` · ${rest} already held, own, or unreadable` : ''}`, saved ? 'ok' : 'info');
      setText('');
      setScanned([]);
      setScan(false);
      setImpOpen(false);
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`, 'alert');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader eyebrow="DTN hand-off" action={<Badge>{bundles?.length ?? '—'} held</Badge>} />
      <CardContent className="space-y-3">
        <p className="text-sm text-slate">No link? Carry changes by hand: show your bundles as QR codes to a tablet heading to a live gateway, or take custody of someone else&apos;s. Each bundle id equals its frame id, so HQ applies it once whichever copy arrives first.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={openExport}><QrCode size={16} aria-hidden />Export mine</Button>
          <Button variant="ghost" onClick={() => setImpOpen(true)}><Upload size={16} aria-hidden />Import</Button>
        </div>

        {!bundles ? <p className="font-mono text-xs text-slate">Loading…</p> : bundles.length === 0 ? (
          <Empty title="No bundles in custody.">Bundles appear here while the link is down, or when you carry another tablet&apos;s changes. Carried bundles relay to the gateway automatically once the link is live.</Empty>
        ) : (
          <ul className="max-h-80 overflow-y-auto border border-structure scroll-thin" aria-label="Bundles held on this tablet">
            {bundles.map((b) => {
              const mine = b.src === me;
              const left = ttlLeft(b.created_at, b.ttl, now);
              return (
                <li key={b.bundle_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-structure/30 px-3 py-2 last:border-b-0">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs text-ink" title={b.bundle_id}>…{b.bundle_id.slice(-10)}</span>
                    <span className="block text-xs text-slate">{mine ? 'Mine' : `Carrying for ${b.src}`}{b.dst_station ? ` → ${b.dst_station}` : ''}</span>
                  </span>
                  <span className="text-right font-mono text-xs text-slate">
                    <span className="block">{ago(b.created_at, now)}</span>
                    <span className={cn('block', left === 'expired' && 'text-flare')}>{left}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!exp} onOpenChange={(o) => { if (!o) setExp(null); }}>
        <DialogContent>
          {exp && (
            <div className="space-y-4">
              <DialogTitle>Hand off {exp.length} bundle{exp.length === 1 ? '' : 's'}</DialogTitle>
              <DialogDescription className="text-sm text-slate">On the carrier tablet open Comms → Import → Scan QR, then page through every code here.</DialogDescription>
              <QrView text={exp[i]} />
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" size="icon" onClick={() => setI((n) => n - 1)} disabled={i === 0} aria-label="Previous bundle"><ChevronLeft size={20} /></Button>
                <span className="num font-mono text-lg font-semibold text-ink" aria-live="polite">{i + 1} / {exp.length}</span>
                <Button variant="ghost" size="icon" onClick={() => setI((n) => n + 1)} disabled={i === exp.length - 1} aria-label="Next bundle"><ChevronRight size={20} /></Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => copyAll(exp)}><Copy size={16} aria-hidden />Copy all as text</Button>
                <Button variant="outline" onClick={() => download(exp, fileName)}><Download size={16} aria-hidden />Download .txt</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={impOpen} onOpenChange={(o) => { setImpOpen(o); if (!o) setScan(false); }}>
        <DialogContent>
          <div className="space-y-4">
            <DialogTitle>Take custody</DialogTitle>
            <DialogDescription className="text-sm text-slate">Scan another tablet&apos;s bundle QR codes one after another, or paste their text (one bundle per line). Duplicates are ignored.</DialogDescription>
            {scan && <Scanner active label="Scan bundle QR" onScan={(t) => setScanned((s) => [...new Set([...s, ...t.split(/\s+/).filter(Boolean)])])} />}
            <Button variant="ghost" className="w-full" onClick={() => setScan((s) => !s)} aria-pressed={scan}><ScanLine size={16} aria-hidden />{scan ? 'Stop camera' : 'Scan QR codes'}</Button>
            <Field label="Or paste bundles">
              {(id) => <Textarea id={id} rows={5} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder="one base64 bundle per line" />}
            </Field>
            <p className="num font-mono text-sm text-ink" aria-live="polite">{all.length} distinct bundle{all.length === 1 ? '' : 's'} ready{scanned.length ? ` · ${scanned.length} scanned` : ''}</p>
            <Button className="w-full" onClick={doImport} disabled={!all.length || busy}><Upload size={16} aria-hidden />Take custody of {all.length}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
