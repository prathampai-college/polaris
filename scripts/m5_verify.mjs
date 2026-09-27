#!/usr/bin/env node
import fs from 'node:fs';
// Artifact presence check only — behaviour is verified by m1–m4, hq/tests and field/lib/db/core.test.ts.
console.log('=== M5 VERIFY: deliverables present ===');
const checks=[
  ['HQ TrendChart', 'hq-dashboard/components/TrendChart.tsx'],
  ['HQ Dashboard overview', 'hq-dashboard/app/(dashboard)/page.tsx'],
  ['Field brief (forecast card)', 'field/app/(field)/page.tsx'],
  ['Field service worker', 'field/public/sw.js'],
  ['Cost slide', 'COST_FEASIBILITY.md'],
  ['Pitch deck', 'PITCH_DECK.md'],
  ['Fallback script', 'scripts/record_fallback.ps1'],
  ['ONNX model', 'ai/thermo_residual.onnx'],
  ['Scaler', 'ai/scaler.json'],
  ['Docker compose', 'docker-compose.yml'],
  ['Field Dockerfile', 'field/Dockerfile'],
  ['HQ Dockerfile', 'hq/Dockerfile'],
  ['Gateway Dockerfile', 'sync-gateway/Dockerfile'],
  ['HQ Dashboard Dockerfile', 'hq-dashboard/Dockerfile'],
];
let ok=true;
for(const [name, p] of checks){
  const exists=fs.existsSync(p);
  const size=exists?fs.statSync(p).size:0;
  console.log(` ${exists?'✓':'✗'} ${name} ${p} ${exists?`(${size}B)`:''}`);
  if(!exists) ok=false;
}
const deck=fs.readFileSync('PITCH_DECK.md','utf8');
console.log(` deck sections: problem=${deck.includes('Problem')?'✓':'✗'} blizzard=${deck.includes('Blizzard')?'✓':'✗'} forecast=${deck.includes('Stockout Forecast')?'✓':'✗'} architecture=${deck.includes('Architecture')?'✓':'✗'} feasibility=${deck.includes('Feasibility')?'✓':'✗'}`);
const cost=fs.readFileSync('COST_FEASIBILITY.md','utf8');
console.log(` cost hardware reuse ${cost.includes('₹0')?'PASS':'FAIL'}`);
console.log(`\n=== M5 ${ok?'PASS — all artifacts present':'FAIL — artifacts missing'} ===`);
if(!ok) process.exit(1);
