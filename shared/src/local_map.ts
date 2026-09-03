// Lite occupancy grid + fusion — sim-only, static 6C/12K map
// 40x40 grid covering 80m x 80m (2m per cell). Provenance: field/lib/sensors/sim_lidar.ts

export const GRID_SIZE = 40;
export const CELL_M = 2; // meters per cell
export const ORIGIN = { x: -40, y: -40 }; // center at 0,0

export type Point = { x: number; y: number; r: number; theta: number };
export type Bbox = { x: number; y: number; w: number; h: number; label: string; conf: number };

export function polarToCart(r: number, thetaDeg: number): { x: number; y: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
}

export function cartToGrid(x: number, y: number): { gx: number; gy: number } | null {
  const gx = Math.floor((x - ORIGIN.x) / CELL_M);
  const gy = Math.floor((y - ORIGIN.y) / CELL_M);
  if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) return null;
  return { gx, gy };
}

export function createGrid(): number[][] {
  return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(0));
}

export function insertPoints(grid: number[][], points: Point[]): void {
  for (const p of points) {
    const c = cartToGrid(p.x, p.y);
    if (c) grid[c.gy][c.gx] = Math.min(1, grid[c.gy][c.gx] + 0.35);
  }
}

// Lite fusion: lidar cluster centroid + bbox centroid weighted
export function fuse(lidarPoints: Point[], bboxes: Bbox[]): { x: number; y: number; conf: number } {
  if (!lidarPoints.length && !bboxes.length) return { x: 0, y: 0, conf: 0 };
  let lidarCx = 0, lidarCy = 0;
  if (lidarPoints.length) {
    for (const p of lidarPoints) { lidarCx += p.x; lidarCy += p.y; }
    lidarCx /= lidarPoints.length; lidarCy /= lidarPoints.length;
  }
  let camCx = 0, camCy = 0, camConf = 0;
  if (bboxes.length) {
    for (const b of bboxes) { camCx += b.x + b.w/2; camCy += b.y + b.h/2; camConf += b.conf; }
    camCx /= bboxes.length; camCy /= bboxes.length; camConf /= bboxes.length;
  }
  if (!lidarPoints.length) return { x: camCx, y: camCy, conf: camConf };
  if (!bboxes.length) return { x: lidarCx, y: lidarCy, conf: 0.75 };
  // 70% lidar (active) + 30% camera
  return { x: lidarCx*0.7 + camCx*0.3, y: lidarCy*0.7 + camCy*0.3, conf: 0.7*0.75 + 0.3*camConf };
}

// Simple 1D Kalman stub for smoothing
export class Kalman1D {
  x = 0; p = 1; q = 0.01; r = 0.5;
  update(z: number): number {
    this.p += this.q;
    const k = this.p / (this.p + this.r);
    this.x += k * (z - this.x);
    this.p *= (1 - k);
    return this.x;
  }
}
