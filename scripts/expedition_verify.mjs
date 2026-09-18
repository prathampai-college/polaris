#!/usr/bin/env node
// Expedition planner verify — live HQ (http://localhost:8000). Run: python -m uvicorn hq.app.main:app --port 8000 & node scripts/expedition_verify.mjs
const HQ = process.env.HQ_URL || 'http://localhost:8000';
const j = (r) => r.json();

console.log('=== Expedition Planner Verify ===');
let res = await fetch(`${HQ}/health`); if (!res.ok) throw new Error('HQ not up at ' + HQ);
console.log('✓ HQ up');

// 1. seed expeditions cover both programs
let exps = await fetch(`${HQ}/expeditions`).then(j);
if (!exps.find((e) => e.id === 'EXP-ANT-46') || !exps.find((e) => e.id === 'EXP-ARC-26')) throw new Error('seed expeditions missing');
console.log('✓ Seed ANTARCTIC + ARCTIC expeditions');

// 2. readiness covers all 3 stations
let rd = await fetch(`${HQ}/expeditions/EXP-ANT-46/readiness`).then(j);
for (const s of ['ST-BHARATI', 'ST-MAITRI', 'ST-HIMADRI']) if (!rd.stations?.[s]) throw new Error('readiness missing ' + s);
console.log('✓ Readiness all-station depth');

// 3. manifest lifecycle: create -> blocked advance -> cleared advance -> regression blocked
const mid = 'MAN-VERIFY-' + Date.now().toString(36).toUpperCase();
res = await fetch(`${HQ}/expeditions/EXP-ANT-46/manifests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: mid, destination_station: 'ST-MAITRI', description: 'verify kit', qty: 2, unit: 'pcs', labelling_code: 'VERIFY-' + Date.now() }) });
if (!res.ok) throw new Error('manifest create failed: ' + await res.text());
console.log('✓ Manifest created');
res = await fetch(`${HQ}/expeditions/EXP-ANT-46/manifests/${mid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'MUMBAI' }) });
if (res.ok) throw new Error('customs gate missing (should 400)');
console.log('✓ Customs/biosecurity gate blocks');
res = await fetch(`${HQ}/expeditions/EXP-ANT-46/manifests/${mid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'MUMBAI', customs_status: 'CLEARED' }) });
if (!res.ok) throw new Error('cleared advance failed: ' + await res.text());
res = await fetch(`${HQ}/expeditions/EXP-ANT-46/manifests/${mid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'GOA' }) });
if (res.ok) throw new Error('stage regression allowed (should 400)');
console.log('✓ Stage machine enforced');

// 4. auto-pack + mutual-aid + timeline respond
res = await fetch(`${HQ}/expeditions/EXP-ANT-46/auto-pack`, { method: 'POST' }); if (!res.ok) throw new Error('auto-pack failed');
await fetch(`${HQ}/procurement/mutual-aid`).then(j); await fetch(`${HQ}/timeline?limit=5`).then(j);
console.log('✓ auto-pack / mutual-aid / timeline OK');

console.log('Expedition verify OK — 4 groups pass');
