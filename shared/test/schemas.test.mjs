import assert from 'node:assert/strict';
import { assetSchema, coordsSchema, deltaFrameSchema } from '../dist/index.js';
import { ulid } from 'ulid';

const validAsset={ id:'A1', sku:'FUEL-DIESEL-001', name:'Diesel', category:'FUEL_DIESEL', qty:4200, unit:'L', expiry_date:null, criticality:'CRITICAL', crate_id:'C1-K1', barcode:'FUEL-DIESEL-001' };
assert.doesNotThrow(()=>assetSchema.parse(validAsset), 'valid asset');
assert.throws(()=>assetSchema.parse({...validAsset, category:'INVALID'}), 'invalid category rejected');
console.log('✓ assetSchema zod');

assert.doesNotThrow(()=>coordsSchema.parse({x:0,y:1}), 'coords valid');
assert.throws(()=>coordsSchema.parse({x:20,y:0}), 'coords out-of-bounds rejected');
console.log('✓ coordsSchema 2D {x,y} zod');

const frame={ ulid: ulid(), device_id:'DEV-01', entity:'assets', entity_id:'A1', op:'UPSERT', patch:{qty:1}, base_version:1, ts:new Date().toISOString() };
assert.doesNotThrow(()=>deltaFrameSchema.parse(frame), 'deltaFrame valid');
assert.throws(()=>deltaFrameSchema.parse({...frame, ulid:'short'}), 'ulid length rejected');
console.log('shared schemas PASS');
