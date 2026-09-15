'use client';
// JS LIF engine — event-driven, sim-only, no native.
// Uses trained lif-5-32-16-1 matrices from @shared/snn-config.js when present,
// with the exact delayed-reset dynamics of the exported ONNX
// (reset=(mem>=1); mem=beta*mem+cur-reset; spk=(mem>=1) — verified diff <1e-6).
// Falls back to linear-proxy rate coding only if layers are absent.
import { SNN_EVENT_THRESH as EVENT_THRESH } from '@shared/snn-config.js';
import {
  SNN_MODEL as TRAINED_MODEL,
  SNN_BETA, SNN_T, SNN_Y_MEAN, SNN_Y_STD,
  SNN_MEAN, SNN_SCALE, SNN_DEFAULT_WEIGHTS,
  SNN_W1, SNN_B1, SNN_W2, SNN_B2, SNN_W3, SNN_B3,
} from '@shared/snn-config.js';

const HAS_LAYERS = Array.isArray(SNN_W1) && SNN_W1.length === 32;

function normalize(feats: number[], mean: readonly number[], scale: readonly number[]): number[] {
  return feats.map((v, i) => (v - mean[i]) / (scale[i] || 1));
}

function matVec(W: number[][], x: number[], b: number[]): number[] {
  const out = new Array(W.length);
  for (let r = 0; r < W.length; r++) {
    let s = b[r];
    const row = W[r];
    for (let c = 0; c < row.length; c++) s += row[c] * x[c];
    out[r] = s;
  }
  return out;
}

function lifForward(xn: number[]): { residual: number; spikeCount: number } {
  const beta = SNN_BETA, T = SNN_T;
  const mem1 = new Array(32).fill(0);
  const mem2 = new Array(16).fill(0);
  let outSum = 0;
  let spikes = 0;
  for (let t = 0; t < T; t++) {
    const cur1 = matVec(SNN_W1, xn, SNN_B1);
    const spk1 = new Array(32);
    for (let i = 0; i < 32; i++) {
      const reset = mem1[i] >= 1 ? 1 : 0;
      mem1[i] = beta * mem1[i] + cur1[i] - reset;
      spk1[i] = mem1[i] >= 1 ? 1 : 0;
      spikes += spk1[i];
    }
    const cur2 = matVec(SNN_W2, spk1, SNN_B2);
    const spk2 = new Array(16);
    for (let i = 0; i < 16; i++) {
      const reset = mem2[i] >= 1 ? 1 : 0;
      mem2[i] = beta * mem2[i] + cur2[i] - reset;
      spk2[i] = mem2[i] >= 1 ? 1 : 0;
      spikes += spk2[i];
    }
    const out = matVec(SNN_W3, spk2, SNN_B3);
    outSum += out[0];
  }
  return { residual: (outSum / T) * SNN_Y_STD + SNN_Y_MEAN, spikeCount: spikes };
}

export interface SNNResult {
  residual: number;
  spikeCount: number;
  active: boolean;
  rate: number[];
  model: string;
}

let _lastFeats: number[] | null = null;
let _lastResidual = 0; // ponytail: cached residual keeps calm-weather burn continuous when event-gated

export async function predictSNN(feats: number[]): Promise<SNNResult> {
  // feats: [temp, wind, pressure, crew, dg_load]
  const model = HAS_LAYERS ? TRAINED_MODEL : 'linear-proxy';
  // event gating: skip if delta small
  if (_lastFeats) {
    const norm = normalize(feats, SNN_MEAN, SNN_SCALE);
    const lastNorm = normalize(_lastFeats, SNN_MEAN, SNN_SCALE);
    const delta = norm.reduce((a, v, i) => a + Math.abs(v - lastNorm[i]), 0) / norm.length;
    if (delta < EVENT_THRESH) {
      return { residual: _lastResidual, spikeCount: 0, active: false, rate: Array(feats.length).fill(0), model };
    }
  }
  _lastFeats = [...feats];
  if (HAS_LAYERS) {
    const xn = normalize(feats, SNN_MEAN, SNN_SCALE);
    let { residual, spikeCount } = lifForward(xn);
    if (!Number.isFinite(residual) || Math.abs(residual) > 50) {
      residual = 5 * feats[4] + 0.3 * feats[3] - 2;
      spikeCount = 0;
    }
    _lastResidual = residual;
    return { residual, spikeCount, active: spikeCount > 0, rate: [], model };
  }
  // legacy linear-proxy rate coding (only when layers absent)
  const norm = normalize(feats, SNN_MEAN, SNN_SCALE);
  const prob = norm.map((v) => 1 / (1 + Math.exp(-v)));
  const T = SNN_T;
  let spikeCount = 0;
  const counts = new Array(feats.length).fill(0);
  for (let t = 0; t < T; t++) {
    for (let i = 0; i < feats.length; i++) {
      if (Math.random() < Math.min(0.98, Math.max(0.02, prob[i]))) {
        spikeCount++;
        counts[i]++;
      }
    }
  }
  const rate = counts.map((c) => c / T);
  let residual = 0;
  const w = SNN_DEFAULT_WEIGHTS as readonly number[];
  for (let i = 0; i < w.length; i++) residual += rate[i] * w[i] * 12;
  if (!Number.isFinite(residual) || Math.abs(residual) > 50) residual = 5 * feats[4] + 0.3 * feats[3] - 2;
  _lastResidual = residual;
  return { residual, spikeCount, active: spikeCount > 0, rate, model };
}

export function resetSNN() { _lastFeats = null; _lastResidual = 0; }
