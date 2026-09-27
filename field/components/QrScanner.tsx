'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { CameraOff } from 'lucide-react';
import type { Html5Qrcode } from 'html5-qrcode';
import { Badge, Dot } from './ui/badge';

type Status = { s: 'off' } | { s: 'starting' } | { s: 'live' } | { s: 'error'; msg: string };

const DEBOUNCE_MS = 2000;

/** html5-qrcode rejects with Errors, DOMExceptions or bare strings — map all of them to something a person can act on. */
function explain(e: unknown): string {
  const raw = `${(e as { name?: string })?.name ?? ''} ${(e as { message?: string })?.message ?? String(e)}`;
  if (/NotAllowed|Permission|denied/i.test(raw)) return 'Camera permission was denied. Allow camera access for this site in the browser settings, then start the camera again.';
  if (/NotFound|Overconstrained|no camera|Requested device not found/i.test(raw)) return 'No camera found on this device. Type the code below or use a hardware scanner.';
  if (/NotReadable|in use|Could not start video/i.test(raw)) return 'The camera is in use by another app. Close it and start the camera again.';
  return `Camera failed to start: ${raw.trim() || 'unknown error'}`;
}

/**
 * Camera barcode / QR reader. Camera runs only while `active`; the same code fires
 * at most once per 2 s. `onScan` is read through a ref so parent re-renders never restart the camera.
 */
export function QrScanner({ onScan, active, label }: { onScan: (text: string) => void; active: boolean; label?: string }): JSX.Element {
  const elId = `qr-${useId().replace(/:/g, '')}`;
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const last = useRef({ text: '', at: 0 });
  // Each start waits for the previous teardown, so fast toggles / StrictMode never fight over the camera.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [status, setStatus] = useState<Status>({ s: 'off' });

  useEffect(() => {
    if (!active) { setStatus({ s: 'off' }); return; }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus({ s: 'error', msg: 'Camera is unavailable: the browser only allows it over HTTPS or on localhost. Type the code below or use a hardware scanner.' });
      return;
    }
    let cancelled = false;
    let scanner: Html5Qrcode | null = null;
    setStatus({ s: 'starting' });

    const run = chain.current.then(async () => {
      if (cancelled) return;
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        scanner = new Html5Qrcode(elId, { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10 },
          (text) => {
            const now = Date.now();
            if (text === last.current.text && now - last.current.at < DEBOUNCE_MS) return;
            last.current = { text, at: now };
            onScanRef.current(text);
          },
          () => { /* per-frame "no code found" — expected */ },
        );
        if (!cancelled) setStatus({ s: 'live' });
      } catch (e) {
        if (!cancelled) setStatus({ s: 'error', msg: explain(e) });
      }
    });

    return () => {
      cancelled = true;
      chain.current = run.then(async () => {
        const sc = scanner;
        if (!sc) return;
        try { if (sc.isScanning) await sc.stop(); } catch { /* already stopped */ }
        try { sc.clear(); } catch { /* element gone */ }
      });
    };
  }, [active, elId]);

  const live = status.s === 'live';
  return (
    <figure className="m-0" aria-label={label ?? 'Camera scanner'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <figcaption className="eyebrow">{label ?? 'Camera'}</figcaption>
        {live ? <Badge variant="active"><Dot tone="cobalt" pulse />Camera live</Badge>
          : status.s === 'starting' ? <Badge>Starting…</Badge>
          : status.s === 'error' ? <Badge variant="critical">Camera error</Badge>
          : <Badge>Camera off</Badge>}
      </div>
      <div className="relative aspect-[4/3] w-full overflow-hidden tickgrid border border-structure bg-canvas [&_video]:!h-full [&_video]:!w-full [&_video]:object-cover">
        {/* html5-qrcode owns this node's children — React never renders into it. */}
        <div id={elId} className="h-full w-full" />
        <div aria-hidden className="pointer-events-none absolute inset-4">
          <span className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-cobalt" />
          <span className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-cobalt" />
          <span className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-cobalt" />
          <span className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-cobalt" />
          {live && <span className="absolute inset-x-0 top-1/2 h-0.5 animate-sweep bg-cobalt" />}
        </div>
        {!live && (
          <div role={status.s === 'error' ? 'alert' : undefined} className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm space-y-2">
              {status.s !== 'starting' && <CameraOff size={28} aria-hidden className={status.s === 'error' ? 'mx-auto text-flare' : 'mx-auto text-slate'} />}
              <p className="font-mono text-sm text-ink">
                {status.s === 'error' ? status.msg : status.s === 'starting' ? 'Starting camera…' : 'Camera off — saves battery. Start it to scan a label.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}

export default QrScanner;
