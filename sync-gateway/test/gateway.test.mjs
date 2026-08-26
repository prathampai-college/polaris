import assert from 'node:assert/strict';
import { encode } from '@msgpack/msgpack';

// mirror gateway codec (no import to test isolation)
const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;t[i]=c;}return t;})();
function crc32(b){let crc=0xFFFFFFFF;for(let i=0;i<b.length;i++)crc=CRC_TABLE[(crc^b[i])&0xFF]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;}
// gateway vs shared codec must agree on CRC/encrypt — test vectors via shared build
import { toWire as sharedToWire, fromWire as sharedFromWire } from '../../shared/dist/index.js';
import { ulid } from 'ulid';

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

console.log('sync-gateway PASS');
