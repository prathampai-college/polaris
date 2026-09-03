'use client';
import type { Bundle } from '@shared/dtn/bundle.js';
import { encodeBundle } from '@shared/dtn/bundle.js';
import { getDb } from '../db.js';

export async function saveBundle(b: Bundle): Promise<void> {
  const db = await getDb();
  const payloadBytes = encodeBundle(b); // store full bundle as blob
  db.exec({
    sql: 'INSERT OR IGNORE INTO dtn_bundles (bundle_id, src, dst_station, payload, vc, custody, created_at, ttl) VALUES (?,?,?,?,?,?,?,?)',
    bind: [b.bundleId, b.src, b.dstStation, payloadBytes, JSON.stringify(b.vectorClock), b.custody ? 1 : 0, b.createdAt, b.ttlSec],
  });
}

export async function listBundles(dstStation?: string): Promise<any[]> {
  const db = await getDb();
  if (dstStation) return db.selectObjects('SELECT * FROM dtn_bundles WHERE dst_station=? ORDER BY created_at', [dstStation]);
  return db.selectObjects('SELECT * FROM dtn_bundles ORDER BY created_at');
}

export async function countBundles(): Promise<number> {
  const db = await getDb();
  return db.selectValue('SELECT COUNT(*) FROM dtn_bundles') as number;
}

export async function deleteBundle(bundleId: string): Promise<void> {
  const db = await getDb();
  db.exec({ sql: 'DELETE FROM dtn_bundles WHERE bundle_id=?', bind: [bundleId] });
}

export async function clearExpired(): Promise<number> {
  const db = await getDb();
  const rows = db.selectObjects('SELECT bundle_id, created_at, ttl FROM dtn_bundles');
  let n = 0;
  const now = Date.now();
  for (const r of rows as any[]) {
    const t = Date.parse(r.created_at);
    if (now - t > (r.ttl as number) * 1000) { db.exec({ sql: 'DELETE FROM dtn_bundles WHERE bundle_id=?', bind: [r.bundle_id] }); n++; }
  }
  return n;
}
