// Physics + forecast math (mirrors hq/app/forecast.py intent, standalone)
export function thermoHybrid(tempC: number, windMs: number, snnActive: boolean, qtyL = 4150) {
  const BASE = 110, K1 = 0.012, K2 = 0.9, T_INSIDE = 18;
  const physics = BASE + K1 * Math.pow(T_INSIDE - tempC, 2) + K2 * windMs;
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
    pts.push(110 + 0.012 * Math.pow(18 - t, 2) + 0.9 * w + 12 + w * 0.35);
  }
  return pts;
}

export const fmt = (n: number, d = 1) => n.toFixed(d);
