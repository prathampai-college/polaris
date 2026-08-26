#!/usr/bin/env node
// Telemetry simulator: feeds AWS-like telemetry into SQLite telemetry table + HQ via API
// Same schema used live via serial/MQTT; here replayed for demo (PLAN §4 telemetry source)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
const FIELD_DB=process.env.FIELD_DB || 'C:\\Users\\prath\\AppData\\Local\\Temp\\polaris-field-m3.db';

export function makeTelemetry({ station_id='ST-BHARATI', temp_outside=-15, wind_speed=5, pressure=1013, dg_load=0.7 }){
  return { ts: new Date().toISOString(), station_id, temp_outside, wind_speed, pressure, dg_load };
}

export function insertLocal(dbPath, tele){
  const db=new DatabaseSync(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS telemetry (ts TEXT, station_id TEXT, temp_outside REAL, wind_speed REAL, pressure REAL, dg_load REAL)');
  db.prepare('INSERT INTO telemetry VALUES (?,?,?,?,?,?)').run(tele.ts, tele.station_id, tele.temp_outside, tele.wind_speed, tele.pressure, tele.dg_load);
  db.close();
}

export const CALM={ station_id:'ST-BHARATI', temp_outside:-15, wind_speed:5, pressure:1013, dg_load:0.7 };
export const BLIZZARD={ station_id:'ST-BHARATI', temp_outside:-38, wind_speed:22, pressure:960, dg_load:0.9 };

// CLI: node telemetry_sim.mjs --mode calm|blizzard --hq http://localhost:8000
if (process.argv[1].endsWith('telemetry_sim.mjs')){
  const mode=process.argv.includes('--blizzard')?'blizzard':'calm';
  const tele=mode==='blizzard'?makeTelemetry(BLIZZARD):makeTelemetry(CALM);
  console.log(`[${mode}]`, tele);
  // try local DB
  try{ insertLocal(FIELD_DB, tele); console.log(' inserted local', FIELD_DB);}catch(e){console.warn(e.message);}
  const hq=process.argv[process.argv.indexOf('--hq')+1] || 'http://localhost:8000';
  fetch(`${hq}/telemetry`,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(tele)}).then(r=>r.json()).then(j=>console.log('HQ ack',j)).catch(e=>console.warn('HQ post fail',e.message));
}
