'use client';
import { useEffect, useRef, useState } from 'react';

export function QrScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    let scanner: any = null;
    let mounted = true;
    async function start() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (!mounted || !ref.current) return;
        const id = 'qr-reader';
        ref.current.innerHTML = `<div id="${id}" style="width:100%"></div>`;
        scanner = new Html5Qrcode(id);
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded: string) => { onScan(decoded); },
          () => {}
        );
        setActive(true);
      } catch (e: any) {
        setErr(e?.message || String(e));
      }
    }
    start();
    return () => {
      mounted = false;
      if (scanner) scanner.stop().catch(() => {}).then(() => scanner.clear());
    };
  }, [onScan]);

  return (
    <div className="bg-black/40 rounded-xl p-3 border border-white/10">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-bold">QR Scanner (html5-qrcode)</span>
        <span className={`text-xs px-2 py-1 rounded ${active ? 'bg-emerald-600' : 'bg-amber-600'}`}>{active ? 'SCANNING' : err ? 'ERROR' : 'STARTING…'}</span>
        {onClose && <button onClick={onClose} className="text-xs bg-white/10 px-3 py-1 rounded">Close</button>}
      </div>
      <div ref={ref} className="rounded overflow-hidden bg-black" />
      {err && <div className="text-xs text-red-400 mt-2">{err} — use text input fallback.</div>}
      <div className="text-[11px] text-white/40 mt-1">Works offline, no network. Printed QR = SKU barcode.</div>
    </div>
  );
}
