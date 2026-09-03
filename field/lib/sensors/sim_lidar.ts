'use client';
import { polarToCart } from '@shared/local_map.js';
import type { Point } from '@shared/local_map.js';

const CONTAINERS: Array<{ id: string; x: number; y: number }> = [
  { id: 'C1', x: -18, y: 12 }, { id: 'C2', x: -6, y: 12 }, { id: 'C3', x: 6, y: 12 },
  { id: 'C4', x: 18, y: 12 }, { id: 'C5', x: -12, y: -10 }, { id: 'C6', x: 12, y: -10 },
];

export function generateScan(opts?: { visibilityM?: number; noise?: number; assetId?: string }): Point[] {
  const vis = opts?.visibilityM ?? 30;
  const noise = opts?.noise ?? 0.12;
  const points: Point[] = [];
  // simulate 360 points
  for (let theta=0; theta<360; theta+=4) {
    // pick nearest container as wall
    const rBase = 8 + Math.random()*18;
    const rVis = Math.min(rBase, vis + Math.random()*2);
    const r = rVis + (Math.random()-0.5)*noise*2;
    const { x, y } = polarToCart(r, theta);
    // keep only points that hit container area (simulate occupied)
    const hit = CONTAINERS.some(c => Math.hypot(x - c.x, y - c.y) < 5);
    if (!hit && Math.random() < 0.7) continue;
    points.push({ x, y, r, theta });
  }
  return points;
}

export function generateBbox(visibilityM?: number): Array<{ x: number; y: number; w: number; h: number; label: string; conf: number }> {
  const vis = visibilityM ?? 30;
  if (vis < 2) return []; // whiteout: camera fails
  const conf = Math.max(0.15, Math.min(0.95, vis/30));
  return CONTAINERS.slice(0,2).map(c => ({ x: c.x, y: c.y, w: 3, h: 3, label: 'container', conf: conf + Math.random()*0.05 }));
}
