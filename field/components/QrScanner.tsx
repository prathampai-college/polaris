'use client';
import React, { useEffect, useRef, useState } from 'react';

const PRESET_BARCODES = [
  { sku: 'FUEL-DIESEL-001', name: 'Winter Grade Diesel (4200L)', category: 'FUEL' },
  { sku: 'O2-CYL-47L-003', name: 'Oxygen Cylinder 47L', category: 'OXYGEN' },
  { sku: 'MED-ANTIBIOTIC-005', name: 'Antibiotic Kit (Amoxicillin)', category: 'MEDICAL' },
  { sku: 'MED-TRAUMA-006', name: 'Trauma Kit (Type A)', category: 'MEDICAL' },
  { sku: 'SPARE-BRG-6205-007', name: 'DG Bearing 6205-2RS', category: 'SPARES' },
  { sku: 'RATION-FD-30D-004', name: 'Freeze-Dried Rations (30-day pack)', category: 'FOOD' },
  { sku: 'SPARE-FILTER-FUEL-008', name: 'DG Fuel Filter (Fleetguard)', category: 'SPARES' },
  { sku: 'SCI-ICE-CORE-010', name: 'Ice Core Drill Bit', category: 'SCIENTIFIC' },
];

export function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (text: string) => void;
  onClose?: () => void;
}) {
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
        ref.current.innerHTML = `<div id="${id}" style="width:100%; border-radius: 12px; overflow: hidden;"></div>`;
        scanner = new Html5Qrcode(id);
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 12, qrbox: { width: 220, height: 220 } },
          (decoded: string) => {
            onScan(decoded);
          },
          () => {}
        );
        if (mounted) setActive(true);
      } catch (e: any) {
        if (mounted) setErr(e?.message || 'Camera permission denied or not available');
      }
    }

    start();

    return () => {
      mounted = false;
      if (scanner) {
        scanner
          .stop()
          .catch(() => {})
          .then(() => {
            try {
              scanner.clear();
            } catch {}
          });
      }
    };
  }, [onScan]);

  return (
    <div className="bg-slate-950/90 rounded-2xl p-4 border border-blue-500/30 shadow-2xl flex flex-col gap-3">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping" />
          <span className="text-sm font-bold text-white">QR / Barcode Scanner</span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              active
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                : err
                ? 'bg-red-500/20 text-red-300 border-red-500/30'
                : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
            }`}
          >
            {active ? 'CAMERA ACTIVE' : err ? 'CAMERA FALLBACK' : 'STARTING…'}
          </span>
          {onClose && (
            <button
              onClick={onClose}
              className="text-xs bg-white/10 hover:bg-white/20 text-white/80 px-2.5 py-1 rounded-lg"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Viewfinder Frame */}
      <div className="relative rounded-xl overflow-hidden bg-black/60 min-h-[180px] flex items-center justify-center border border-white/10">
        <div ref={ref} className="w-full" />
        {err && (
          <div className="p-4 text-center">
            <div className="text-xs text-amber-400 font-medium">{err}</div>
            <div className="text-[11px] text-white/40 mt-1">
              Select a barcode preset below or type in the SKU field.
            </div>
          </div>
        )}
      </div>

      {/* Quick Test / Demo Barcodes */}
      <div className="pt-2 border-t border-white/10">
        <div className="text-[11px] text-white/50 mb-2 font-medium flex items-center justify-between">
          <span>⚡ Instant SKU Barcode Simulators</span>
          <span className="text-[10px] text-blue-400">Click to scan</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {PRESET_BARCODES.map((item) => (
            <button
              key={item.sku}
              onClick={() => onScan(item.sku)}
              className="p-2 rounded-xl bg-white/5 hover:bg-blue-600/30 border border-white/5 hover:border-blue-500/40 text-left transition group"
            >
              <div className="font-mono text-[11px] font-bold text-white group-hover:text-blue-300 truncate">
                {item.sku}
              </div>
              <div className="text-[10px] text-white/40 truncate mt-0.5">{item.name}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
