'use client';
export function LabelSheet({ sku, lotCode, barcode, crateId, expiry, destination }: { sku: string; lotCode: string; barcode: string; crateId?: string; expiry?: string | null; destination?: string }) {
  return (
    <div className="label-sheet bg-white text-black p-4 rounded-xl border border-black/10 font-mono text-xs w-[320px] print:w-full">
      <div className="font-black text-sm">{sku}</div>
      <div className="text-[11px]">Lot: {lotCode}</div>
      <div className="text-[11px]">Crate: {crateId || '—'} {destination ? `→ ${destination}` : ''}</div>
      {expiry && <div className="text-[11px]">EXP: {expiry}</div>}
      <div className="mt-2 border-2 border-black p-2 text-center font-black tracking-widest text-base">{barcode}</div>
      <div className="text-[9px] text-black/60 mt-1 text-center">polaris • offline-first • scan at GOA → CRATE</div>
      <style>{`@media print { body * { visibility: hidden; } .label-sheet, .label-sheet * { visibility: visible; } .label-sheet { position: absolute; inset: 20px; } }`}</style>
    </div>
  );
}
export function printLabel() {
  if (typeof window !== 'undefined') window.print();
}
