import { fuse, Kalman1D } from '@polaris/shared/local_map';
import { generateScan, generateBbox } from './sim_lidar';

// SIMULATED LiDAR + camera fusion (no real sensor on the tablet). One Kalman pair
// per tracked id smooths the noisy fix. Callers label the output SIM.
const filters = new Map<string, { kx: Kalman1D; ky: Kalman1D }>();

export interface Fix { id: string; x: number; y: number; conf: number; visibilityM: number; ts: string }

export function fusionStep(id: string, visibilityM: number): Fix {
  const { x, y, conf } = fuse(generateScan({ visibilityM }), generateBbox(visibilityM));
  let f = filters.get(id);
  if (!f) { f = { kx: new Kalman1D(), ky: new Kalman1D() }; filters.set(id, f); }
  return { id, x: f.kx.update(x), y: f.ky.update(y), conf, visibilityM, ts: new Date().toISOString() };
}
