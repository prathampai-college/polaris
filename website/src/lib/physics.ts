// Physics + forecast math. Mirrors hq/app/forecast.py::physics_pred exactly, using
// the same constants as shared/physics.json (no pressure input on this page, so the
// K3 pressure-delta term is omitted — equivalent to pressure_delta=0 server-side).
const BASE = 110, K1 = 0.012, K2 = 0.018, T_INSIDE = 18;

function physicsBurn(tempC: number, windMs: number): number {
  return BASE * (1 + K1 * (T_INSIDE - tempC) + K2 * windMs);
}

export function thermoHybrid(tempC: number, windMs: number, snnActive: boolean, qtyL = 4150) {
  const physics = physicsBurn(tempC, windMs);
  const residual = snnActive ? 12 + windMs * 0.35 : 0;
  const total = physics + residual;
  const days = total > 0 ? qtyL / total : 99;
  const pure = qtyL / physics;
  const lo = days * 0.9, hi = days * 1.12;
  return { physics, residual, total, days, pure, lo, hi };
}

export function burnSeries(tempC: number, windMs: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 24; i++) {
    const t = tempC + Math.sin(i / 3.2) * 2.5;
    const w = Math.max(1, windMs + Math.cos(i / 2.4) * 2);
    pts.push(physicsBurn(t, w) + 12 + w * 0.35);
  }
  return pts;
}

export const fmt = (n: number, d = 1) => n.toFixed(d);
