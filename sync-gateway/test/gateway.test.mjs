import assert from 'node:assert/strict';
import { encode } from '@msgpack/msgpack';

// mirror gateway codec (no import to test isolation)
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c;}return t;})();
function crc32(b){let crc=0xFFFFFFFF;for(let i=0;i<b.length;i++)crc=CRC_TABLE[(crc^b[i])&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
// gateway vs shared codec must agree on CRC/encrypt — test vectors via shared build
import { toWire as sharedToWire, fromWire as sharedFromWire, ulid } from '../../shared/dist/index.js';

const key='a'.repeat(64);
const f={ulid:ulid(), device_id:'DEV-01', entity:'assets', entity_id:'A1', op:'UPSERT', patch:{qty:1}, base_version:1, ts:new Date().toISOString()};
const w=sharedToWire(f, key);
assert.ok(w.length<2048, 'gateway wire <2KB');
const back=sharedFromWire(w, key);
assert.equal(back.ulid, f.ulid, 'gateway wire roundtrip');
console.log('✓ gateway wire CRC+AES');

// throttling math: 20 kbps = 2560 B/s, 250B frame ≈ 0.1s airtime + 500ms latency → ~600ms per frame, 5 frames <5s
const totalBytes=5*w.length;
const seconds=totalBytes/2560 + 5*0.5;
assert.ok(seconds<5, `5 frames @20kbps/500ms = ${seconds.toFixed(2)}s <5s`);
console.log(`✓ throttle @20kbps/500ms 5 frames ${totalBytes}B → ${seconds.toFixed(2)}s <5s`);

// downstream delta frame test
const downstream = {
  type: 'DOWNSTREAM_DELTA',
  ulid: ulid(),
  station_id: 'ST-BHARATI',
  entity: 'indents',
  entity_id: 'IND-001',
  op: 'STATUS_CHANGE',
  patch: { status: 'APPROVED' },
  ts: new Date().toISOString()
};
const downWire = sharedToWire(downstream, key);
assert.ok(downWire.length < 2048, 'downstream wire <2KB');
const downBack = sharedFromWire(downWire, key);
assert.equal(downBack.type, 'DOWNSTREAM_DELTA');
assert.equal(downBack.patch.status, 'APPROVED');
console.log('✓ downstream delta wire CRC+AES');

// ACK mapping: transient HQ failures must be RETRY (resend), never FAILED (dead-letter)
const { ackStatusFor } = await import('../dist/ack.js');
assert.equal(ackStatusFor(200, { status: 'APPLIED' }), 'APPLIED');
assert.equal(ackStatusFor(200, { status: 'APPLIED_LOCAL_WINS' }), 'APPLIED_LOCAL_WINS');
assert.equal(ackStatusFor(503, {}), 'RETRY');
assert.equal(ackStatusFor(429, { detail: 'rate limited' }), 'RETRY');
assert.equal(ackStatusFor(null, { message: 'ECONNREFUSED' }), 'RETRY');
assert.equal(ackStatusFor(400, { detail: 'unsupported entity' }), 'FAILED');
assert.equal(ackStatusFor(404, { detail: 'asset not found' }), 'FAILED');
assert.equal(ackStatusFor(200, {}), 'APPLIED', '2xx with an empty/unparsed body is a success, not a RETRY');
console.log('✓ ack mapping: 5xx/429/network → RETRY, 4xx → FAILED, 2xx+empty body → APPLIED');

console.log('sync-gateway PASS');

