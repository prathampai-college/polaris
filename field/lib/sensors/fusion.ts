'use client';
import { fuse, Kalman1D } from '@shared/local_map.js';
import { generateScan, generateBbox } from './sim_lidar.js';
import { getDb } from '../db.js';

const kfX = new Kalman1D();
const kfY = new Kalman1D();

export async function runFusionCycle(assetId: string, stationId: string, visibilityM: number = 30): Promise<{ x:number;y:number;conf:number }> {
  const scan = generateScan({ visibilityM });
  const bboxes = generateBbox(visibilityM);
  const { x, y, conf } = fuse(scan, bboxes);
  const sx = kfX.update(x), sy = kfY.update(y);
  const db = await getDb();
  const now = new Date().toISOString();
  db.exec({
    sql: 'INSERT INTO asset_positions (asset_id, x, y, theta, conf, last_sensor_ts, station_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET x=excluded.x, y=excluded.y, theta=excluded.theta, conf=excluded.conf, last_sensor_ts=excluded.last_sensor_ts',
    bind: [assetId, sx, sy, 0, conf, now, stationId],
  });
  // also push to HQ if online
  const hqUrl = process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000';
  try {
    await fetch(`${hqUrl}/tracking/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId, x: sx, y: sy, theta: 0, conf, station_id: stationId }),
    });
  } catch {}
  return { x: sx, y: sy, conf };
}

export async function startFusionLoop(assetIds: string[], stationId: string, intervalMs=4000): Promise<()=>void> {
  const id = setInterval(async () => {
    for (const aid of assetIds.slice(0,3)) {
      // random visibility to demo whiteout resilience: occasionally 0.5m
      const vis = Math.random() < 0.15 ? 0.8 : 30;
      await runFusionCycle(aid, stationId, vis);
    }
  }, intervalMs);
  return () => clearInterval(id as any);
}
