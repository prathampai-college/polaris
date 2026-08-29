#!/usr/bin/env node
// Phase 1.4 — Per-station PSK provisioning (QR: demo, PSK provision via QR at HQ)
// Usage: node scripts/provision_station.mjs ST-BHARATI [--qr] [--out provision]
// Generates 32B hex PSK_HEX (64 chars) per station. Production: do NOT expose via NEXT_PUBLIC_PSK_HEX.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const station = process.argv[2] || 'ST-BHARATI';
const wantQr = process.argv.includes('--qr');
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx !== -1 ? process.argv[outIdx + 1] : 'provision';

if (!/^ST-[A-Z]+$/.test(station)) {
  console.error(`Invalid station ${station} — use ST-BHARATI | ST-MAITRI | ST-HIMADRI`);
  process.exit(1);
}

const psk = crypto.randomBytes(32).toString('hex');
console.log(`Station: ${station}`);
console.log(`PSK_HEX=${psk}`);
console.log(`SECRET_KEY=${psk}  # set separately in production; falls back to PSK_HEX if unset`);
console.log(`\nAdd to .env:\nPSK_HEX=${psk}\nSECRET_KEY=${psk}`);

if (wantQr) {
  try {
    const QR = await import('qrcode');
    const dir = path.resolve(outDir);
    fs.mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify({ station, psk_hex: psk, issued_at: new Date().toISOString() });
    const out = path.join(dir, `${station}.png`);
    await QR.toFile(out, payload, { width: 400, margin: 2 });
    const txtOut = path.join(dir, `${station}.json`);
    fs.writeFileSync(txtOut, JSON.stringify({ station, psk_hex: psk }, null, 2));
    console.log(`\nQR written: ${out}`);
    console.log(`JSON written: ${txtOut}`);
    console.log('Scan at field tablet provisioning — do NOT commit provision/ to git.');
  } catch (e) {
    console.error('QR generation needs `npm install qrcode` (optional):', e.message);
    process.exit(0);
  }
} else {
  console.log('\nTip: add --qr to generate QR PNG (requires `npm install qrcode`), --out <dir> to change output.');
}
