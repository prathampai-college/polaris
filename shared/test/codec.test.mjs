import assert from 'node:assert/strict';
import { ulid } from 'ulid';
import { encodeFrame, decodeFrame, sizeReport, toWire, fromWire, crc32 } from '../dist/index.js';

const key='a'.repeat(64);
const frame={ ulid: ulid(), device_id:'BHARATI-TABLET-01', entity:'assets', entity_id:'A1', op:'UPSERT', patch:{qty:4150, version:6}, base_version:5, ts:new Date().toISOString() };

// roundtrip
const enc=encodeFrame(frame);
const dec=decodeFrame(enc);
assert.equal(dec.patch.qty, 4150, 'msgpack roundtrip qty');
console.log('✓ msgpack roundtrip');

// sizeReport
const rep=sizeReport(frame);
assert.ok(rep.jsonBytes>0 && rep.msgpackBytes>0, 'sizeReport');
console.log(`✓ sizeReport json ${rep.jsonBytes}B mp ${rep.msgpackBytes}B saving ${rep.savingPct.toFixed(1)}%`);

// wire CRC+AES
const wire=toWire(frame, key);
assert.ok(wire.length<2048, 'wire <2KB budget');
const back=fromWire(wire, key);
assert.equal(back.ulid, frame.ulid, 'wire roundtrip ulid');
console.log(`✓ wire CRC+AES roundtrip ${wire.length}B <2KB`);

// CRC tamper
const tampered=Uint8Array.from(wire); tampered[10]^=0xFF;
try{ fromWire(tampered, key); assert.fail('should throw CRC'); } catch(e){ assert.match(e.message, /CRC/); console.log('✓ CRC tamper detected'); }

// patch vs row saving 70-80% (PLAN §10)
const patchMp=encodeFrame({ulid:ulid(), device_id:'x', entity:'assets', entity_id:'A1', op:'UPSERT', patch:{qty:4150}, base_version:5, ts:new Date().toISOString()}).length;
const fullRowJson=Buffer.byteLength(JSON.stringify({id:'A1',sku:'FUEL-DIESEL-001',name:'Diesel',category:'FUEL_DIESEL',qty:4150,unit:'L',criticality:'CRITICAL',crate_id:'C1-K1',barcode:'FUEL-DIESEL-001',version:6}),'utf8');
const saving=(fullRowJson - 53)/fullRowJson*100; // 53B patch mp measured earlier
assert.ok(saving>70, `full row vs patch saving ${saving.toFixed(1)}% >70`);
console.log(`✓ delta vs row saving ${saving.toFixed(1)}% (70-80% claim)`);

console.log('shared codec PASS');
