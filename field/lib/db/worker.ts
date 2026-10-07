// DB + sync engine Web Worker. Owns the SQLite handle (OPFS SyncAccessHandle
// pool — persistent, needs no COOP/COEP) and the gateway WebSocket, so writes,
// the outbox and the network never race each other across threads.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { encode, decode } from '@msgpack/msgpack';
import { toWire, fromWire, MAX_WIRE_SIZE } from '@polaris/shared/codec.web';
import {
  initSchema, seedIfEmpty, kvGet, kvSet, queries, mutations, applyAck, applyDownstream, applyDownstreamDelta,
  nextFrames, markSent, bundleOffline, foreignBundles, saveForeignBundle, exportOwnBundles, dropBundle,
  type Ctx, type Sqlite, type Row,
} from './core';

export const DEV_PSK = 'a'.repeat(64);
export type Link = 'offline' | 'connecting' | 'live' | 'key_mismatch' | 'cut';
// keyFp = last 4 hex of the provisioned key (for eyeball checks); the key itself never leaves the worker.
/** Drill-only link shaping: kbps 0 = unshaped. Applied to upstream frames on this tablet. */
export interface LinkSim { kbps: number; lossPct: number; sentBytes: number; dropped: number; queuedBytes: number }
export interface SyncInfo { link: Link; devKey: boolean; keyFp: string | null; lastError: string | null; lastPushAt: string | null; sim: LinkSim }

// Typed via Worker's interface: pulling in lib.webworker clashes with the app's lib.dom.
const scope = self as unknown as Worker;
let db: Sqlite;
let session: { ctx: Ctx; gatewayUrl: string } | null = null;
const info: SyncInfo = { link: 'offline', devKey: true, keyFp: null, lastError: null, lastPushAt: null, sim: { kbps: 0, lossPct: 0, sentBytes: 0, dropped: 0, queuedBytes: 0 } };
let simBudget = 0;
let simLastTick = Date.now();
const refreshKeyInfo = () => { const k = kvGet(db, 'psk'); info.devKey = k === null; info.keyFp = k ? k.slice(-4) : null; };

const emit = (msg: Row) => scope.postMessage(msg);
const changed = (...tables: string[]) => emit({ type: 'changed', tables });
const setLink = (link: Link, err: string | null = info.lastError) => {
  info.link = link;
  info.lastError = err;
  emit({ type: 'sync', info: { ...info } });
};
const psk = () => kvGet(db, 'psk') ?? DEV_PSK;

// ---------------------------------------------------------------- boot

const ready = (async () => {
  const sqlite3 = await sqlite3InitModule();
  let storage: 'opfs' | 'memory' = 'memory';
  let reason: string | null = null;
  // Ask the browser not to evict OPFS under storage pressure (months of field data live here).
  try { await (navigator as any).storage?.persist?.(); } catch { /* unsupported: best effort */ }
  try {
    const pool = await (sqlite3 as any).installOpfsSAHPoolVfs({ name: 'polaris', initialCapacity: 6 });
    db = new pool.OpfsSAHPoolDb('/polaris.db');
    storage = 'opfs';
  } catch (e) {
    // Most common cause: the app is already open in another tab (SAH pool is exclusive).
    reason = e instanceof Error ? e.message : String(e);
    db = new sqlite3.oo1.DB(':memory:', 'c') as unknown as Sqlite;
  }
  initSchema(db);
  seedIfEmpty(db);
  refreshKeyInfo();
  emit({ type: 'ready', storage, reason });
  emit({ type: 'sync', info: { ...info } });
})().catch((e) => emit({ type: 'fatal', error: e instanceof Error ? e.message : String(e) }));

// ---------------------------------------------------------------- RPC

const TOUCH: Record<string, string[]> = {
  recordTx: ['assets', 'lots', 'transactions', 'outbox', 'audit_log'],
  createIndent: ['indents', 'outbox', 'audit_log'],
  receiveIndent: ['indents', 'assets', 'lots', 'transactions', 'outbox', 'audit_log'],
  setPersonnelStatus: ['personnel', 'outbox', 'audit_log'],
  startSortie: ['field_sorties', 'personnel', 'outbox', 'audit_log'],
  closeSortie: ['field_sorties', 'personnel', 'outbox', 'audit_log'],
  raiseSOS: ['emergencies', 'outbox', 'audit_log'],
  advanceEmergency: ['emergencies', 'outbox', 'audit_log'],
  advanceManifest: ['manifests', 'outbox', 'audit_log'],
  mergeFromHQ: ['*'],
  retryFailed: ['outbox'],
  retryOne: ['outbox'],
  discardFailed: ['outbox', 'audit_log'],
};

const extra = {
  syncInfo: (_db: Sqlite, _ctx: Ctx) => ({ ...info }),
  setPsk(_db: Sqlite, _ctx: Ctx, hex: string | null) {
    if (hex !== null && !/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('Key must be 64 hex characters');
    kvSet(db, 'psk', hex ? hex.toLowerCase() : null);
    refreshKeyInfo();
    reconnect(0);
    return { devKey: info.devKey };
  },
  /** Drill: pull the satellite plug without touching the gateway. */
  cutLink(_db: Sqlite, _ctx: Ctx, cut: boolean) {
    if (cut) { closeWs(); setLink('cut', null); } else { setLink('offline', null); reconnect(0); }
    return { link: info.link };
  },
  syncNow: (_db: Sqlite, _ctx: Ctx) => { void tick(); return true; },
  /** Drill: shape this tablet's uplink to a satellite-like bandwidth and loss. */
  simulateLink(_db: Sqlite, _ctx: Ctx, kbps: number, lossPct: number) {
    info.sim = { kbps: Math.max(0, kbps), lossPct: Math.min(90, Math.max(0, lossPct)), sentBytes: 0, dropped: 0, queuedBytes: info.sim.queuedBytes };
    simBudget = 0;
    simLastTick = Date.now();
    emit({ type: 'sync', info: { ...info } });
    return info.sim;
  },
  exportBundles: (_db: Sqlite, ctx: Ctx) => exportOwnBundles(db, ctx.deviceId).map(toB64),
  importBundles(_db: Sqlite, ctx: Ctx, list: string[]) {
    let saved = 0;
    for (const s of list) { try { if (saveForeignBundle(db, ctx.deviceId, fromB64(s))) saved++; } catch { /* skip malformed */ } }
    changed('dtn_bundles');
    return { saved };
  },
  wipe(_db: Sqlite, _ctx: Ctx) {
    const tables = db.selectObjects("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map((r) => r.name);
    db.exec('PRAGMA foreign_keys=OFF');
    for (const t of tables) db.exec(`DELETE FROM ${t}`);
    db.exec('PRAGMA foreign_keys=ON');
    seedIfEmpty(db);
    refreshKeyInfo();
    emit({ type: 'sync', info: { ...info } });
    changed('*');
    return true;
  },
};

const api: Record<string, (db: Sqlite, ctx: Ctx, ...a: any[]) => unknown> = { ...queries, ...mutations, ...extra };
export type WorkerApi = typeof queries & typeof mutations & typeof extra;

scope.onmessage = async (ev: MessageEvent<Row>) => {
  const m = ev.data;
  await ready;
  if (m.type === 'session') {
    session = m.session;
    if (session) reconnect(0); else closeWs();
    changed('*'); // queries that ran before the session arrived were scoped to no station
    return;
  }
  if (m.type !== 'call') return;
  try {
    const fn = api[m.method];
    if (!fn) throw new Error(`unknown method ${m.method}`);
    const ctx = session?.ctx ?? { stationId: '', deviceId: '', actorId: '' };
    const result = await fn(db, ctx, ...(m.args ?? []));
    emit({ type: 'result', id: m.id, ok: true, result });
    if (TOUCH[m.method]) {
      changed(...TOUCH[m.method]);
      if (m.method in mutations && info.link === 'live') void tick();
    }
  } catch (e) {
    emit({ type: 'result', id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};

// ---------------------------------------------------------------- sync engine

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoff = 3_000;
let ticking = false;
// Downstream resume cursor (HQ change_log seq, persisted in kv 'down_seq').
// It only moves on replayed deltas or after the replay finished, and freezes
// once a delta is held behind local unsynced edits, so the held change is
// replayed again (resync once the outbox drains) instead of being lost.
let replayDone = false;
let cursorFrozen = false;
let lastInboundAt = 0;
const DEAD_LINK_MS = 45_000; // frames in flight but nothing heard back: the link is dead even if the socket says open
const advanceCursor = (seq: number) => { if (seq > Number(kvGet(db, 'down_seq') ?? 0)) kvSet(db, 'down_seq', String(seq)); };

async function sendInit(sock: WebSocket) {
  if (!session) return;
  replayDone = false;
  cursorFrozen = false;
  sock.send(await toWire({ type: 'SYNC_INIT', device_id: session.ctx.deviceId, station_id: session.ctx.stationId, since_seq: Number(kvGet(db, 'down_seq') ?? 0) }, psk()));
}
const BATCH = 8; // 8 frames / 2s tick = 240/min, well under HQ's 600/min/device limit

function closeWs() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const old = ws;
  ws = null;
  try { old?.close(); } catch { /* already closed */ }
}

function reconnect(delay: number) {
  closeWs();
  if (!session || info.link === 'cut') return;
  reconnectTimer = setTimeout(connect, delay);
}

function connect() {
  if (!session || info.link === 'cut') return;
  setLink('connecting');
  let sock: WebSocket;
  try { sock = new WebSocket(session.gatewayUrl); } catch (e) { setLink('offline', String(e)); return scheduleRetry(); }
  sock.binaryType = 'arraybuffer';
  ws = sock;
  sock.onopen = async () => {
    if (ws !== sock || !session) return;
    backoff = 3_000;
    lastInboundAt = Date.now();
    await sendInit(sock);
    setLink('live', null);
    void tick();
  };
  sock.onmessage = (ev) => { if (ws === sock) void onFrame(ev.data); };
  // Stale-socket guard: a late close from a replaced socket must not flip a live link offline.
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (info.link !== 'key_mismatch' && info.link !== 'cut') setLink('offline');
    scheduleRetry();
  };
  sock.onerror = () => { /* onclose follows */ };
}

function scheduleRetry() {
  if (!session || info.link === 'cut') return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  // jitter: a fleet of tablets that lost the same link must not reconnect in lockstep
  reconnectTimer = setTimeout(connect, backoff * (0.5 + Math.random()));
  backoff = Math.min(30_000, backoff * 2);
}

async function onFrame(data: ArrayBuffer | string) {
  lastInboundAt = Date.now();
  if (typeof data === 'string') {
    try { if (JSON.parse(data).type === 'KEY_MISMATCH') setLink('key_mismatch', 'Gateway rejected this tablet\'s sync key'); } catch { /* ignore */ }
    return;
  }
  let f: Row;
  try { f = (await fromWire(new Uint8Array(data), psk())) as Row; } catch { return setLink('key_mismatch', 'Cannot decrypt gateway frames — key mismatch'); }
  if (info.link === 'key_mismatch') setLink('live', null);
  if (f.type === 'DOWNSTREAM_DELTA') {
    const seq = typeof f.seq === 'number' ? f.seq : undefined;
    const r = applyDownstreamDelta(db, String(f.entity), String(f.entity_id), f.patch ?? {}, seq);
    if (r === 'applied') {
      changed(String(f.entity));
      info.lastPushAt = new Date().toISOString();
      emit({ type: 'push', entity: f.entity, id: f.entity_id, patch: f.patch });
    }
    if (r === 'held') cursorFrozen = true;
    else if (seq != null && !cursorFrozen && (f.replay || replayDone)) advanceCursor(seq);
    return;
  }
  if (f.type === 'SYNC_INIT_RESP') {
    if (!cursorFrozen && typeof f.caught_up_to === 'number') advanceCursor(f.caught_up_to);
    replayDone = true;
    let n = 0;
    for (const r of (f.indents ?? []) as Row[]) if (applyDownstream(db, 'indents', String(r.id), r)) n++;
    if (n) changed('indents');
    return;
  }
  if (f.ulid && f.status && applyAck(db, { ulid: String(f.ulid), status: String(f.status), message: f.message })) {
    changed('outbox', 'transactions', 'dtn_bundles');
  }
}

async function tick() {
  if (ticking || !session) return;
  ticking = true;
  try {
    if (ws && ws.readyState === WebSocket.OPEN && info.link === 'live') {
      const rows = nextFrames(db, BATCH);
      // Link simulator: refill a byte budget at kbps; a frame that doesn't fit waits for the next tick.
      const t = Date.now();
      simBudget = info.sim.kbps ? Math.min(simBudget + info.sim.kbps * 125 * ((t - simLastTick) / 1000), info.sim.kbps * 125 * 4) : Infinity;
      simLastTick = t;
      for (const r of rows) {
        const frame: Row = { ulid: r.ulid, device_id: r.device_id, entity: r.entity, entity_id: r.entity_id, op: r.op, patch: r.patch, base_version: Number(r.base_version ?? 0), ts: r.created_at };
        if (r.vector_clock) frame.vector_clock = JSON.parse(r.vector_clock);
        const wire = await toWire(frame, psk());
        if (wire.length > MAX_WIRE_SIZE) { applyAck(db, { ulid: r.ulid, status: 'FAILED', message: `frame ${wire.length}B exceeds ${MAX_WIRE_SIZE}B link budget` }); continue; }
        if (wire.length > simBudget) break;
        simBudget -= wire.length;
        // simulated loss: the frame "left" but never arrives; the 15 s resend recovers it
        if (info.sim.lossPct && Math.random() * 100 < info.sim.lossPct) info.sim.dropped++;
        else ws.send(wire);
        info.sim.sentBytes += wire.length;
        markSent(db, r.ulid);
      }
      if (info.sim.kbps) {
        info.sim.queuedBytes = Number(db.selectValue("SELECT COALESCE(SUM(LENGTH(patch)) + COUNT(*) * 120, 0) FROM outbox WHERE status IN ('PENDING','SENT','BUNDLED')"));
        emit({ type: 'sync', info: { ...info } });
      }
      if (rows.length) changed('outbox');
      const inFlight = Number(db.selectValue("SELECT COUNT(*) FROM outbox WHERE status='SENT'"));
      if (inFlight > 0 && Date.now() - lastInboundAt > DEAD_LINK_MS) {
        setLink('offline', 'No reply from gateway in 45s — link presumed dead, switching to DTN store-and-forward');
        reconnect(0);
      } else if (cursorFrozen && replayDone && Number(db.selectValue("SELECT COUNT(*) FROM outbox WHERE status IN ('PENDING','SENT','BUNDLED')")) === 0) {
        await sendInit(ws); // held HQ changes can apply now that local edits are acknowledged
      }
    } else if (info.link !== 'connecting') {
      const made = bundleOffline(db, session.ctx.stationId);
      if (made.length) {
        for (const b of made) mesh?.postMessage(toB64(b));
        changed('outbox', 'dtn_bundles');
      }
    }
  } catch (e) {
    info.lastError = e instanceof Error ? e.message : String(e);
  } finally {
    ticking = false;
  }
}

// Relay bundles this tablet carried for other devices (peer / QR mule).
async function relayForeign() {
  if (!session || info.link !== 'live') return;
  const bundles = foreignBundles(db, session.ctx.deviceId);
  if (!bundles.length) return;
  try {
    const url = session.gatewayUrl.replace(/^ws/, 'http').replace(/\/$/, '') + '/dtn/exchange';
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-PSK': psk() }, body: JSON.stringify({ bundles }), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return;
    const { results = [] } = await res.json();
    for (const r of results as Row[]) if (r.status !== 'RETRY') dropBundle(db, String(r.bundleId));
    changed('dtn_bundles');
  } catch { /* keep custody, retry next round */ }
}

// Same-origin tablet mesh (stands in for BLE/UHF): peers take custody of each other's bundles.
const mesh = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('polaris-mule') : null;
if (mesh) mesh.onmessage = async (ev) => {
  await ready;
  if (session && saveForeignBundle(db, session.ctx.deviceId, fromB64(String(ev.data)))) changed('dtn_bundles');
};

setInterval(() => void tick(), 2_000);
setInterval(() => void relayForeign(), 30_000);

// ---------------------------------------------------------------- bundle transport encoding

function toB64(b: Row): string {
  let s = '';
  encode(b).forEach((x) => { s += String.fromCharCode(x); });
  return btoa(s);
}
function fromB64(s: string): Row {
  const bin = atob(s.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decode(bytes) as Row;
}
