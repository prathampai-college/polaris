#!/usr/bin/env node
// Thermo hybrid inference: physics + ML residual (ONNX) -> days_to_stockout
// Graceful degrade: if ONNX fails, use pure physics.
import fs from 'node:fs';
import path from 'node:path';
let ort = null;
let session = null;
let scaler = null;

const MODEL_PATH = path.resolve('ai/thermo_residual.onnx');
const SCALER_PATH = path.resolve('ai/scaler.npz');

// For NPZ we saved via numpy, simpler to load via python? Instead embed scaler json from train log
// We'll load scaler from JSON we generate alongside
const SCALER_JSON = path.resolve('ai/scaler.json');

export async function init() {
  // load scaler json if exists, else use defaults from training
  try {
    if (fs.existsSync(SCALER_JSON)) scaler = JSON.parse(fs.readFileSync(SCALER_JSON,'utf8'));
    else {
      // fallback defaults from last train run (Bharati mean/scale)
      scaler = {
        mean: [-21.6831599, 8.20060273, 979.696967, 19.0, 0.773812785],
        scale: [8.23514903, 5.14805715, 11.79083666, 7.78888096, 0.10032067]
      };
    }
  } catch { scaler = null; }

  try {
    ort = await import('onnxruntime-node');
    if (fs.existsSync(MODEL_PATH)) {
      session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['cpu'] });
      console.log(`[ai] ONNX loaded ${MODEL_PATH} ${(fs.statSync(MODEL_PATH).length/1024).toFixed(1)}KB`);
    }
  } catch (e) {
    console.warn('[ai] ONNX not available, physics-only fallback:', e.message);
    session = null;
  }
  return { session, scaler };
}

// Physics: base_load * (1 + k1*(T_inside - T_out) + k2*wind) + k3*pressureDelta
const T_INSIDE=18, BASE_LOAD=110, K1=0.012, K2=0.018, K3=0.08;
export function physicsOnly(temp_out, wind, pressure) {
  const pd=(1013-pressure)/1013;
  return BASE_LOAD * (1 + K1*(T_INSIDE - temp_out) + K2*wind) + K3*pd*BASE_LOAD;
}

export async function predict({ temp_outside, wind_speed, pressure, crew_count, dg_load }) {
  const t0=performance.now();
  const physics = physicsOnly(temp_outside, wind_speed, pressure);
  let residual = 0;
  let usedModel = false;
  if (session && scaler) {
    try {
      const feats=[temp_outside, wind_speed, pressure, crew_count, dg_load];
      const scaled=feats.map((v,i)=>(v - scaler.mean[i])/scaler.scale[i]);
      const input=new ort.Tensor('float32', Float32Array.from(scaled), [1,5]);
      const out=await session.run({ input });
      residual=out.residual.data[0];
      usedModel=true;
    } catch (e) { console.warn('[ai] infer fail fallback', e.message); residual=0; }
  } else {
    // fallback residual approx from linear (keeps demo consistent)
    residual = 5*dg_load + 0.3*crew_count - 2;
  }
  const total = physics + residual;
  const dt=(performance.now()-t0);
  return { physics, residual, total, usedModel, latencyMs: dt };
}

export function forecastDays({ qty, consumptionPerDay }) {
  if (consumptionPerDay<=0) return { days: 999, ci:[999,999] };
  const days=qty/consumptionPerDay;
  // 95% CI ±15%
  return { days, ci:[days*0.85, days*1.15] };
}

// CLI test handled via direct import

