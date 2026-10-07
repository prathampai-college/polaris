#!/usr/bin/env node
// Catch-up verify: HQ changes made while a tablet is offline reach it on reconnect.
// Spawns HQ + gateway on a throwaway DB, raises an SOS at HQ with no tablet
// connected, then connects as a tablet with since_seq and expects the replay.
import os from 'node:os';
import path from 'node:path';
import { toWire, fromWire, cleanDbs, waitForHQ, spawnHQ, spawnGateway, connectWs, hqAuthHeaders } from './_harness.mjs';

const HQ_PORT = 8772, GW_PORT = 8792, HQ = `http://localhost:${HQ_PORT}`;
const HQ_DB = path.join(os.tmpdir(), 'polaris-catchup.db');
cleanDbs([HQ_DB, HQ_DB + '-wal', HQ_DB + '-shm']);
const hq = spawnHQ(HQ_PORT, { HQ_DB_PATH: HQ_DB, GATEWAY_INTERNAL_URL: `http://localhost:${GW_PORT}` });
let gw;
const fail = (m) => { console.error('FAIL', m); hq.kill(); gw?.kill(); process.exit(1); };
try {
  await waitForHQ(HQ_PORT);
  gw = await spawnGateway(GW_PORT, HQ_PORT);
  const H = await hqAuthHeaders(HQ);
  console.log('=== Catch-up Verify ===');

  // 1. tablet syncs once, records its cursor, goes offline
  const recv = async (ws, until, ms = 5000) => {
    const got = [];
    await new Promise((res) => {
      const t = setTimeout(res, ms);
      ws.on('message', (d) => { const f = fromWire(new Uint8Array(d)); got.push(f); if (until(f)) { clearTimeout(t); res(); } });
    });
    return got;
  };
  let ws = await connectWs(GW_PORT);
  ws.send(toWire({ type: 'SYNC_INIT', device_id: 'TAB-CATCHUP', station_id: 'ST-MAITRI', since_seq: 0 }));
  let frames = await recv(ws, (f) => f.type === 'SYNC_INIT_RESP');
  const resp = frames.find((f) => f.type === 'SYNC_INIT_RESP');
  if (typeof resp?.caught_up_to !== 'number') fail('SYNC_INIT_RESP missing caught_up_to');
  const cursor = resp.caught_up_to;
  ws.close();
  console.log(`✓ initial sync, cursor=${cursor}`);

  // 2. HQ acts while the tablet is away
  const sosId = 'SOS-CATCHUP-' + Date.now().toString(36).toUpperCase();
  let r = await fetch(`${HQ}/emergency/sos`, { method: 'POST', headers: H, body: JSON.stringify({ id: sosId, station_id: 'ST-MAITRI', type: 'SOS_MEDICAL', reported_by: 'HQ' }) });
  if (!r.ok) fail('sos create ' + r.status);
  r = await fetch(`${HQ}/emergency/${sosId}`, { method: 'PATCH', headers: H, body: JSON.stringify({ status: 'ACK' }) });
  if (!r.ok) fail('sos ack ' + r.status);
  await fetch(`${HQ}/emergency/sos`, { method: 'POST', headers: H, body: JSON.stringify({ id: sosId + 'X', station_id: 'ST-BHARATI', type: 'SOS_MEDICAL', reported_by: 'HQ' }) });
  console.log('✓ HQ raised + ACKed an SOS while tablet offline');

  // 3. reconnect with the cursor: both changes replay, in order, other station's not
  ws = await connectWs(GW_PORT);
  ws.send(toWire({ type: 'SYNC_INIT', device_id: 'TAB-CATCHUP', station_id: 'ST-MAITRI', since_seq: cursor }));
  frames = await recv(ws, (f) => f.type === 'SYNC_INIT_RESP');
  const replay = frames.filter((f) => f.type === 'DOWNSTREAM_DELTA' && f.replay);
  const mine = replay.filter((f) => f.entity_id === sosId);
  if (mine.length !== 2) fail(`expected 2 replayed deltas for ${sosId}, got ${mine.length}`);
  if (!(mine[0].seq < mine[1].seq) || mine[1].patch.status !== 'ACK') fail('replay out of order / missing ACK');
  if (replay.some((f) => f.entity_id === sosId + 'X')) fail('other station leaked into replay');
  const resp2 = frames.find((f) => f.type === 'SYNC_INIT_RESP');
  if (resp2.caught_up_to < mine[1].seq) fail('caught_up_to behind replayed seq');
  console.log(`✓ replayed ${replay.length} missed change(s) in seq order, station-scoped`);
  ws.close();
  console.log('Catch-up verify OK — 3 groups pass');
} catch (e) {
  fail(e.message);
}
hq.kill(); gw.kill();
process.exit(0);
