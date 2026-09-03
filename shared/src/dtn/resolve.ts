import type { VC } from './vector_clock.js';
import { compare } from './vector_clock.js';

export interface ResolveInput {
  local: { qty?: number; ts: string; vc: VC; data: Record<string, unknown> };
  remote: { qty?: number; ts: string; vc: VC; data: Record<string, unknown> };
}

// LWW-Register with VC: vector dominates else wall-clock LWW
export function resolveAsset(input: ResolveInput): { winner: 'local' | 'remote'; mergedVC: VC; reason: string } {
  const c = compare(input.local.vc, input.remote.vc);
  if (c === 'gt') return { winner: 'local', mergedVC: mergeVC(input.local.vc, input.remote.vc), reason: 'vc_gt' };
  if (c === 'lt') return { winner: 'remote', mergedVC: mergeVC(input.local.vc, input.remote.vc), reason: 'vc_lt' };
  if (c === 'equal') return { winner: 'local', mergedVC: input.local.vc, reason: 'vc_equal' };
  // concurrent
  if (input.remote.ts > input.local.ts) return { winner: 'remote', mergedVC: mergeVC(input.local.vc, input.remote.vc), reason: 'lww_remote_newer' };
  if (input.local.ts > input.remote.ts) return { winner: 'local', mergedVC: mergeVC(input.local.vc, input.remote.vc), reason: 'lww_local_newer' };
  return { winner: 'local', mergedVC: mergeVC(input.local.vc, input.remote.vc), reason: 'lww_tie_local' };
}

function mergeVC(a: VC, b: VC): VC {
  const out: VC = { ...a };
  for (const [k,v] of Object.entries(b)) out[k] = Math.max(out[k]??0, v);
  return out;
}
