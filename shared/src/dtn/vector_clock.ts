// LWW with Vector Clock — deterministic conflict resolution
// Pure TS, no deps. Used by field and HQ.

export type VC = Record<string, number>;

export function increment(vc: VC, nodeId: string): VC {
  const next = { ...vc };
  next[nodeId] = (next[nodeId] ?? 0) + 1;
  return next;
}

export function merge(a: VC, b: VC): VC {
  const out: VC = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
  return out;
}

export type CompareResult = 'equal' | 'gt' | 'lt' | 'concurrent';

export function compare(a: VC, b: VC): CompareResult {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let aGt = false, bGt = false;
  for (const k of keys) {
    const av = a[k] ?? 0; const bv = b[k] ?? 0;
    if (av > bv) aGt = true;
    if (bv > av) bGt = true;
  }
  if (!aGt && !bGt) return 'equal';
  if (aGt && !bGt) return 'gt';
  if (!aGt && bGt) return 'lt';
  return 'concurrent';
}

export function serialize(vc: VC): string { return JSON.stringify(vc); }
export function deserialize(s: string | null | undefined): VC {
  if (!s) return {};
  try { const v = JSON.parse(s); return typeof v === 'object' && v !== null ? v as VC : {}; } catch { return {}; }
}

