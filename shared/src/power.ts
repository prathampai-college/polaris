// Phase 0 + Phase 2: Power telemetry for DTN/SNN watts pill
// ponytail: no deps, pure math. ANN baseline 8.2mW, SNN 0.8mW event-driven

export const POWER_BASE = {
  ANN_MW: 8.2,
  SNN_ACTIVE_MW: 0.82,
  SNN_IDLE_MW: 0.08,
  TX_PER_KB_MW: 0.45,
  LIDAR_PER_SCAN_MW: 1.1,
} as const;

export function estimateTxMw(wireBytes: number): number {
  return (wireBytes / 1024) * POWER_BASE.TX_PER_KB_MW;
}

export function estimateInferMw(opts: { model: 'ANN' | 'SNN'; active: boolean; ms?: number }): number {
  if (opts.model === 'ANN') return POWER_BASE.ANN_MW;
  return opts.active ? POWER_BASE.SNN_ACTIVE_MW : POWER_BASE.SNN_IDLE_MW;
}

export function savedPct(annMw: number, snnMw: number): number {
  if (annMw <= 0) return 0;
  return Math.max(0, ((annMw - snnMw) / annMw) * 100);
}

export function powerReport(opts: { wireBytes?: number; snnActive?: boolean; lidarScans?: number }) {
  const ann = POWER_BASE.ANN_MW;
  const snn = estimateInferMw({ model: 'SNN', active: !!opts.snnActive });
  const tx = opts.wireBytes ? estimateTxMw(opts.wireBytes) : 0;
  const lidar = (opts.lidarScans ?? 0) * POWER_BASE.LIDAR_PER_SCAN_MW;
  return {
    ann_mw: ann,
    snn_mw: snn,
    tx_mw: +tx.toFixed(3),
    lidar_mw: +lidar.toFixed(3),
    total_snn_mw: +(snn + tx + lidar).toFixed(3),
    total_ann_mw: +(ann + tx + lidar).toFixed(3),
    saved_pct: +savedPct(ann, snn).toFixed(1),
  };
}
