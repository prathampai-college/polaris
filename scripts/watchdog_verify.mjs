#!/usr/bin/env node
// Watchdog + triage verify — live HQ. Requires HQ up.
const HQ = process.env.HQ_URL || 'http://localhost:8000';
const j = (r) => r.json();
console.log('=== Watchdog + Triage Verify ===');

// 1. overdue sortie -> marked + auto SOS
const sid = 'SORTIE-VF-' + Date.now().toString(36).toUpperCase();
let res = await fetch(`${HQ}/sorties`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: sid, station_id: 'ST-BHARATI', lead_personnel_id: 'PER-BHA-01', destination: 'Verify Ridge', expected_return_time: '2020-01-01T01:00:00', safety_status: 'ACTIVE' }) });
if (!res.ok) throw new Error('sortie create failed');
let chk = await fetch(`${HQ}/sorties/check-overdue`, { method: 'POST' }).then(j);
if (!chk.marked_overdue?.includes(sid)) throw new Error('watchdog did not mark OVERDUE');
if (!chk.auto_sos?.length) throw new Error('watchdog did not auto-SOS');
console.log(`✓ Watchdog OVERDUE + auto-SOS ${chk.auto_sos[0]}`);

// 2. triage machine: ACTIVE->ACK->RESPONDING->RESOLVED, regression blocked
const em = chk.auto_sos[0];
res = await fetch(`${HQ}/emergency/${em}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACK' }) });
if (!res.ok) throw new Error('ACK failed');
res = await fetch(`${HQ}/emergency/${em}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' }) });
if (res.ok) throw new Error('triage regression allowed (should 400)');
res = await fetch(`${HQ}/emergency/${em}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'BOGUS' }) });
if (res.ok) throw new Error('invalid status allowed (should 400)');
await fetch(`${HQ}/emergency/${em}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RESPONDING' }) });
await fetch(`${HQ}/emergency/${em}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'RESOLVED' }) });
console.log('✓ Triage machine enforced');

// 3. override audit logged
let ovr = await fetch(`${HQ}/overrides?limit=50`).then(j);
if (!ovr.find((o) => o.ref_id === em)) throw new Error('override audit missing');
console.log('✓ Decision override audited');

console.log('Watchdog+triage verify OK — 3 groups pass');
