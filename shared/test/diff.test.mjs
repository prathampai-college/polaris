import assert from 'node:assert/strict';
import { diff, applyPatch, isEmptyPatch } from '../dist/index.js';

const oldA={qty:4200, unit:'L', version:5};
const newA={qty:4150, unit:'L', version:6};
const patch=diff(oldA, newA);
assert.deepEqual(patch, {qty:4150, version:6}, 'diff field-level');
assert.ok(!isEmptyPatch(patch));
assert.deepEqual(applyPatch(oldA, patch), newA, 'applyPatch');
assert.ok(isEmptyPatch(diff(oldA, oldA)), 'empty patch');
console.log('✓ diff field-level + applyPatch + isEmptyPatch');

const oldB={qty:5, criticality:'CRITICAL'};
const newB={qty:5, criticality:'CRITICAL'};
assert.ok(isEmptyPatch(diff(oldB,newB)), 'no change → empty');
console.log('shared diff PASS');
