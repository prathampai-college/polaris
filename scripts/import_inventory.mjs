#!/usr/bin/env node
// Phase 2.1 — Bulk inventory importer scaffold
// Usage: node scripts/import_inventory.mjs [--file scripts/template_inventory.csv] [--hq http://localhost:8000] [--pin BHARATI-2024]
// Reads CSV with header sku,name,category,qty,unit,expiry_date,criticality,crate_id,barcode and POSTs to /assets/bulk

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const file = getArg('--file', 'scripts/template_inventory.csv');
const hq = getArg('--hq', process.env.HQ_URL || 'http://localhost:8000');
const pin = getArg('--pin', 'BHARATI-2024');
const station = getArg('--station', 'ST-BHARATI');

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new Error('CSV needs header + at least 1 row');
  const header = lines[0].split(',').map(s => s.trim());
  const required = ['sku','name','category','qty','unit','criticality','crate_id'];
  for (const r of required) if (!header.includes(r)) throw new Error(`missing required column ${r}`);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(s => s.trim());
    const obj = {};
    header.forEach((h, idx) => obj[h] = cols[idx] ?? '');
    // normalize
    obj.qty = Number(obj.qty);
    if (isNaN(obj.qty)) throw new Error(`row ${i}: qty must be numeric`);
    obj.expiry_date = obj.expiry_date || null;
    obj.barcode = obj.barcode || obj.sku;
    if (!obj.criticality) obj.criticality = 'LOW';
    rows.push(obj);
  }
  return rows;
}

async function login() {
  const res = await fetch(`${hq}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: `IMPORT-ADMIN-${Date.now().toString().slice(-4)}`, pin, station_id: station, role: 'NCPOR_ADMIN' }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status} ${await res.text()}`);
  const j = await res.json();
  return j.token;
}

async function main() {
  const csvPath = path.resolve(file);
  if (!fs.existsSync(csvPath)) {
    console.error(`File not found: ${csvPath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(text);
  console.log(`Parsed ${rows.length} rows from ${file}`);
  const token = await login();
  console.log(`Authenticated as NCPOR_ADMIN`);
  const res = await fetch(`${hq}/assets/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ rows }),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`Bulk import failed ${res.status}: ${body}`);
    process.exit(1);
  }
  console.log(`Bulk import ok: ${body}`);
  // also verify template endpoint
  const tmpl = await fetch(`${hq}/assets/bulk/template`);
  console.log(`Template endpoint: ${tmpl.status} ${tmpl.headers.get('content-type')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
