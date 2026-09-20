'use client';
import { fuse, Kalman1D } from '@shared/local_map.js';
import { generateScan, generateBbox } from './sim_lidar';
import { getDb } from '../db';

const assetFilters = new Map<string, { kfX: Kalman1D; kfY: Kalman1D }>();
const personnelFilters = new Map<string, { kfX: Kalman1D; kfY: Kalman1D }>();

function getFilter(map: Map<string, any>, id: string) {
  let f = map.get(id);
  if (!f) {
    f = { kfX: new Kalman1D(), kfY: new Kalman1D() };
    map.set(id, f);
  }
  return f;
}

export async function runFusionCycle(assetId: string, stationId: string, visibilityM: number = 30): Promise<{ x: number; y: number; conf: number }> {
  const scan = generateScan({ visibilityM });
  const bboxes = generateBbox(visibilityM);
  const { x, y, conf } = fuse(scan, bboxes);
  const filter = getFilter(assetFilters, assetId);
  const sx = filter.kfX.update(x), sy = filter.kfY.update(y);
  const db = await getDb();
  const now = new Date().toISOString();
  db.exec({
    sql: 'INSERT INTO asset_positions (asset_id, x, y, theta, conf, last_sensor_ts, station_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(asset_id) DO UPDATE SET x=excluded.x, y=excluded.y, theta=excluded.theta, conf=excluded.conf, last_sensor_ts=excluded.last_sensor_ts',
    bind: [assetId, sx, sy, 0, conf, now, stationId],
  });
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

export async function runPersonnelCycle(personnelId: string, stationId: string, visibilityM: number = 30): Promise<{ x: number; y: number; conf: number }> {
  const scan = generateScan({ visibilityM });
  const bboxes = generateBbox(visibilityM);
  const { x, y, conf } = fuse(scan, bboxes);
  const filter = getFilter(personnelFilters, personnelId);
  const sx = filter.kfX.update(x), sy = filter.kfY.update(y);
  const db = await getDb();
  const now = new Date().toISOString();
  db.exec({
    sql: 'INSERT INTO personnel_positions (personnel_id, x, y, theta, conf, last_sensor_ts, station_id) VALUES (?,?,?,?,?,?,?) ON CONFLICT(personnel_id) DO UPDATE SET x=excluded.x, y=excluded.y, theta=excluded.theta, conf=excluded.conf, last_sensor_ts=excluded.last_sensor_ts',
    bind: [personnelId, sx, sy, 0, conf, now, stationId],
  });
  const hqUrl = process.env.NEXT_PUBLIC_HQ_URL || 'http://localhost:8000';
  try {
    await fetch(`${hqUrl}/tracking/personnel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personnel_id: personnelId, x: sx, y: sy, theta: 0, conf, station_id: stationId }),
    });
  } catch {}
  return { x: sx, y: sy, conf };
}

export async function startFusionLoop(
  assetIds: string[],
  stationId: string,
  intervalMs = 4000,
  personnelIds: string[] = []
): Promise<() => void> {
  const id = setInterval(async () => {
    for (const aid of assetIds.slice(0, 3)) {
      const vis = Math.random() < 0.15 ? 0.8 : 30;
      await runFusionCycle(aid, stationId, vis);
    }
    for (const pid of personnelIds.slice(0, 3)) {
      const vis = Math.random() < 0.15 ? 0.8 : 30;
      await runPersonnelCycle(pid, stationId, vis);
    }
  }, intervalMs);
  return () => clearInterval(id as any);
}
