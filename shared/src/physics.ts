import physics from './physics.json' with { type: 'json' };
export const PHYSICS = physics as unknown as { T_INSIDE: number; BASE: number; K1: number; K2: number; K3: number };

export function physicsOnly(temp_out: number, wind: number, pressure: number): number {
  const { T_INSIDE, BASE, K1, K2, K3 } = PHYSICS;
  const pd = (1013 - pressure) / 1013;
  return BASE * (1 + K1 * (T_INSIDE - temp_out) + K2 * wind) + K3 * pd * BASE;
}
