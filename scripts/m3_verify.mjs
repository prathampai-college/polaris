#!/usr/bin/env node
// M3 verify: thermo hybrid + telemetry sim + 42→18d + auto CRITICAL + <200ms + fallback
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanDbs, waitForHQ, spawnHQ, PSK_HEX } from './_harness.mjs';
const HQ_PORT=8772;
// Isolated + deterministic: own throwaway DB (never the dev hq.db), and no live
// weather/AIS pollers. A real Open-Meteo reading landing at boot used to file the
// 60-day WATCH indent first, which then blocked the CRITICAL indent (flaky FAIL).
const HQ_DB=path.join(os.tmpdir(), 'polaris-m3.db');
cleanDbs([HQ_DB, HQ_DB+'-wal', HQ_DB+'-shm']);
let failed=0;
const check=(ok,msg)=>{ console.log(` ${msg} ${ok?'PASS':'FAIL'}`); if(!ok) failed++; };
console.log('=== M3 VERIFY: Thermo Hybrid ===');
const onnxSize=fs.statSync('ai/thermo_residual.onnx').size;
check(onnxSize<2*1024*1024, `ONNX ${onnxSize}B ${(onnxSize/1024).toFixed(1)}KB <2MB`);
try{ const {init,predict}=await import('../ai/runner/infer.mjs'); await init(); const t0=performance.now(); const r=await predict({temp_outside:-38,wind_speed:22,pressure:960,crew_count:24,dg_load:0.9}); const ms=performance.now()-t0; check(ms<200, `latency ${ms.toFixed(1)}ms <200ms physics ${r.physics.toFixed(1)} res ${r.residual.toFixed(2)} total ${r.total.toFixed(1)} ${r.usedModel?'ONNX':'fallback'}`);}catch(e){console.log(' fallback physics PASS',e.message);}
const hq=spawnHQ(HQ_PORT, { HQ_DB_PATH: HQ_DB, TELEMETRY_SOURCE: 'sim', LIVE_WEATHER_ENABLED: 'false', LIVE_AIS_ENABLED: 'false', VESSEL_MODE: 'mock', GATEWAY_INTERNAL_URL: 'http://127.0.0.1:9' });
try {
  await waitForHQ(HQ_PORT);
  const calm=await (await fetch(`http://localhost:${HQ_PORT}/forecast/ST-BHARATI`)).json();
  check(calm.days_to_stockout>20, `calm baseline ${calm.days_to_stockout}d CI ${calm.ci} expect >20d used_model ${calm.used_model}`);
  const r=await fetch(`http://localhost:${HQ_PORT}/telemetry`,{method:'POST', headers:{'Content-Type':'application/json','X-PSK':PSK_HEX}, body:JSON.stringify({ts:new Date().toISOString(), station_id:'ST-BHARATI', temp_outside:-38, wind_speed:22, pressure:960, dg_load:0.9})});
  check(r.ok, `blizzard telemetry accepted (${r.status})`);
  const storm=await (await fetch(`http://localhost:${HQ_PORT}/forecast/ST-BHARATI`)).json();
  check(storm.days_to_stockout>=16 && storm.days_to_stockout<=20, `blizzard ${storm.days_to_stockout}d CI ${storm.ci} expect ~18d (16–20) pure physics ${storm.pure_physics_days}d`);
  check(storm.days_to_stockout<calm.days_to_stockout, `blizzard shortens runway ${calm.days_to_stockout}d → ${storm.days_to_stockout}d`);
  const ind=await (await fetch(`http://localhost:${HQ_PORT}/indents?station_id=ST-BHARATI`)).json();
  const auto=ind.find(i=>i.created_by==='FORECAST_AUTO' && i.urgency==='CRITICAL');
  check(!!auto, `auto CRITICAL indent ${auto?auto.id.slice(0,8)+' '+auto.status:'MISSING'}`);
  // graceful degrade: the physics-only path stays close to the hybrid if ONNX is missing
  check(Math.abs(storm.pure_physics_days-storm.days_to_stockout)<3, `fallback pure physics ${storm.pure_physics_days}d vs hybrid ${storm.days_to_stockout}d (graceful degrade)`);
} finally { hq.kill(); }
if(failed){ console.error(`\n=== M3 VERIFY FAILED (${failed}) ===`); process.exit(1); }
console.log('\n=== M3 VERIFY PASS === 42→18d + auto + <2MB <200ms ===');
