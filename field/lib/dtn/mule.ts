'use client';
import { createBundle, bundleToBase64, bundleFromBase64, isBundleExpired, encodeBundle } from '@shared/dtn/bundle.js';
import type { Bundle } from '@shared/dtn/bundle.js';
import { getDb } from '../db';

// BroadcastChannel sim for tablet-to-tablet in same origin (simulates BLE mesh)
let _chan: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!_chan) {
    _chan = new BroadcastChannel('polaris-mule');
    _chan.onmessage = async (ev) => {
      try {
        const b = bundleFromBase64(ev.data as string);
        if (!isBundleExpired(b)) await saveBundle(b);
      } catch {}
    };
  }
  return _chan;
}

export async function createAndSaveMuleBundle(opts: { src: string; dstStation: string; payload: Bundle['payload']; vc: Record<string,number> }): Promise<Bundle> {
  const b = createBundle(opts);
  await saveBundle(b);
  // broadcast to peers (sim BLE)
  try { getChannel()?.postMessage(bundleToBase64(b)); } catch {}
  return b;
}

export function exportBundleToQR(b: Bundle): string {
  return bundleToBase64(b);
}

export async function importBundleFromQR(b64: string): Promise<Bundle> {
  const b = bundleFromBase64(b64);
  if (isBundleExpired(b)) throw new Error('bundle expired');
  await saveBundle(b);
  return b;
}

export async function exportAllToQR(dstStation?: string): Promise<string[]> {
  const rows = await listBundles(dstStation);
  const out: string[] = [];
  for (const r of rows as any[]) {
    try {
      const bytes = r.payload as Uint8Array;
      const b = (await import('@shared/dtn/bundle.js')).decodeBundle(bytes);
      out.push(bundleToBase64(b));
    } catch {
      // fallback: row may store base64 vc
    }
  }
  return out;
}

// Push bundles to HQ when online: POST /dtn/ingest_bulk
export async function pushBundlesToHQ(hqUrl: string): Promise<{ pushed: number; results: any[] }> {
  const rows = await listBundles();
  if (!rows.length) return { pushed: 0, results: [] };
  const bundles: Bundle[] = [];
  for (const r of rows as any[]) {
    try {
      const b = (await import('@shared/dtn/bundle.js')).decodeBundle(r.payload as Uint8Array);
      if (!isBundleExpired(b)) bundles.push(b);
    } catch {}
  }
  if (!bundles.length) return { pushed: 0, results: [] };
  const res = await fetch(`${hqUrl}/dtn/ingest_bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundles }),
  });
  if (!res.ok) throw new Error(`HQ bulk ingest ${res.status}`);
  const j = await res.json();
  // on success, delete pushed bundles (custody transferred)
  for (const b of bundles) await deleteBundle(b.bundleId);
  return { pushed: bundles.length, results: j.results ?? [] };
}

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
  const n = db.selectValue("SELECT COUNT(*) FROM dtn_bundles WHERE (strftime('%s','now') - strftime('%s', created_at)) > ttl") as number;
  if (n > 0) db.exec("DELETE FROM dtn_bundles WHERE (strftime('%s','now') - strftime('%s', created_at)) > ttl");
  return n;
}

export function subscribeMule(cb: (b: Bundle) => void): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (ev: MessageEvent) => {
    try { cb(bundleFromBase64(ev.data as string)); } catch {}
  };
  ch.addEventListener('message', handler);
  return () => ch.removeEventListener('message', handler);
}
