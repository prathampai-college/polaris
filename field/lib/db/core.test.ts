// Run: node field/lib/db/core.test.ts   (Node ≥22.18 strips types natively)
import assert from 'node:assert/strict';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { initSchema, seedIfEmpty, mutations, queries, applyAck, applyDownstream, bundleOffline, nextFrames, markSent, type Sqlite } from './core.ts';

const sqlite3 = await sqlite3InitModule();
const db = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Sqlite;
initSchema(db);
assert.equal(seedIfEmpty(db), true);
assert.equal(seedIfEmpty(db), false, 'seed is idempotent');
const ctx = { stationId: 'ST-BHARATI', deviceId: 'TAB-TEST', actorId: 'FIELD_OP_TEST' };
const qty = (id: string) => Number(db.selectValue('SELECT qty FROM assets WHERE id=?', [id]));

// FEFO consume works on seeded stock (was: "insufficient lot stock … have 0")
assert.equal(mutations.recordTx(db, ctx, { assetId: 'A1', type: 'CONSUME', qty: 5 }).newQty, 4195);
// Restock adds to the total (was: 4195 + 5 → 5)
assert.equal(mutations.recordTx(db, ctx, { assetId: 'A1', type: 'IN', qty: 5 }).newQty, 4200);
assert.equal(mutations.recordTx(db, ctx, { assetId: 'A1', type: 'ADJUST', qty: -20 }).newQty, 4180);
assert.throws(() => mutations.recordTx(db, ctx, { assetId: 'A1', type: 'OUT', qty: 99999 }), /Insufficient/);

// Expired stock is gated for CONSUME only, override unlocks it
db.exec({ sql: "UPDATE lots SET expiry_date='2020-01-01' WHERE asset_sku='MED-ANTIBIOTIC-005'" });
assert.throws(() => mutations.recordTx(db, ctx, { assetId: 'A5', type: 'CONSUME', qty: 1 }), /EXPIRED/);
assert.equal(mutations.recordTx(db, ctx, { assetId: 'A5', type: 'CONSUME', qty: 1, overrideExpired: true }).newQty, 11);
assert.equal(mutations.recordTx(db, ctx, { assetId: 'A5', type: 'OUT', qty: 1 }).newQty, 10, 'OUT may move expired stock');

// Every asset write queues an asset frame carrying the absolute qty + lot frames
const frames = db.selectObjects("SELECT entity, op FROM outbox WHERE entity_id='A1' OR entity='lots'");
assert.ok(frames.some((f) => f.entity === 'assets' && f.op === 'CONSUME'));
assert.ok(frames.some((f) => f.entity === 'lots'));

// ACK state machine: ACKED is terminal, RETRY backs off, FAILED is visible
const [f1] = nextFrames(db, 1);
markSent(db, f1.ulid);
assert.equal(applyAck(db, { ulid: f1.ulid, status: 'APPLIED' }), true);
assert.equal(applyAck(db, { ulid: f1.ulid, status: 'FAILED' }), false, 'late FAILED must not downgrade ACKED');
const [f2] = nextFrames(db, 1);
applyAck(db, { ulid: f2.ulid, status: 'RETRY', message: 'HQ 503' });
assert.equal(db.selectValue('SELECT status FROM outbox WHERE ulid=?', [f2.ulid]), 'PENDING');
assert.ok(!nextFrames(db, 100).some((r) => r.ulid === f2.ulid), 'RETRY row waits for its backoff');

// Downstream: local unsynced writes win; status-only patch never renames
mutations.setPersonnelStatus(db, ctx, { id: 'PER-BHA-03', status: 'IN_TRANSIT' });
assert.equal(applyDownstream(db, 'personnel', 'PER-BHA-03', { status: 'ON_STATION' }), false);
db.exec("UPDATE outbox SET status='ACKED' WHERE entity='personnel'");
assert.equal(applyDownstream(db, 'personnel', 'PER-BHA-03', { status: 'EVACUATED' }), true);
assert.deepEqual({ ...db.selectObjects("SELECT name, status FROM personnel WHERE id='PER-BHA-03'")[0] }, { name: 'Dr. Ananya Sen', status: 'EVACUATED' });

// HQ stock-take keeps lots summing to the asset qty
db.exec("UPDATE outbox SET status='ACKED' WHERE entity_id='A2'");
assert.equal(applyDownstream(db, 'assets', 'A2', { qty: 1500 }), true);
assert.equal(qty('A2'), 1500);
assert.equal(Number(db.selectValue("SELECT SUM(qty) FROM lots WHERE asset_sku='FUEL-KERO-JP8-002'")), 1500);

// Offline custody: bundle id is the outbox ULID (HQ dedupes WS vs DTN)
const bundles = bundleOffline(db, 'ST-BHARATI');
assert.ok(bundles.length > 0);
assert.equal(db.selectValue('SELECT status FROM outbox WHERE ulid=?', [bundles[0].bundleId]), 'BUNDLED');

// Station scoping: Maitri sees none of Bharati's stock
assert.equal(queries.listAssets(db, { ...ctx, stationId: 'ST-MAITRI' }).length, 0);
assert.equal(queries.listAssets(db, ctx).length, 10);

// Buddy rule + solo override requires STATION_LEAD
const later = new Date(Date.now() + 3600_000).toISOString();
assert.throws(() => mutations.startSortie(db, ctx, { leadId: 'PER-BHA-01', destination: 'Larsemann', expectedReturn: later }), /Buddy required/);
assert.throws(() => mutations.startSortie(db, ctx, { leadId: 'PER-BHA-01', destination: 'Larsemann', expectedReturn: later, soloOverride: true, role: 'FIELD_OP' }), /STATION_LEAD/);
mutations.startSortie(db, ctx, { leadId: 'PER-BHA-01', buddyId: 'PER-BHA-02', destination: 'Larsemann', expectedReturn: later });
assert.throws(() => mutations.setPersonnelStatus(db, ctx, { id: 'PER-BHA-01', status: 'ON_STATION' }), /sortie/);

// SOS never invents a location
assert.throws(() => mutations.raiseSOS(db, ctx, { type: 'SOS_MEDICAL', location: '  ' }), /Location required/);
const sos = mutations.raiseSOS(db, ctx, { type: 'SOS_MEDICAL', location: 'LOCATION UNKNOWN' });
assert.equal(mutations.advanceEmergency(db, ctx, { id: sos.id, assignee: 'PER-BHA-03' }).status, 'ACK');
assert.equal(mutations.advanceEmergency(db, ctx, { id: sos.id }).status, 'RESPONDING');
assert.equal(mutations.advanceEmergency(db, ctx, { id: sos.id }).status, 'RESOLVED');

console.log('field db core PASS');
