'use client';
// JS LIF engine — event-driven, sim-only, no native. 5->32->16->1 simplified to linear spike-rate for now.
import { SNN_EVENT_THRESH as EVENT_THRESH } from '@shared/snn-config.js';

let _weights: number[] | null = null;
let _mean: number[] | null = null;
let _scale: number[] | null = null;
let _T = 20;

async function loadWeights(): Promise<{ w: number[]; mean: number[]; scale: number[]; T: number }> {
  if (_weights) return { w: _weights, mean: _mean!, scale: _scale!, T: _T };
  const { SNN_DEFAULT_WEIGHTS, SNN_MEAN, SNN_SCALE } = await import('@shared/snn-config.js');
  _weights = [...SNN_DEFAULT_WEIGHTS];
  _mean = [...SNN_MEAN];
  _scale = [...SNN_SCALE];
  return { w: _weights, mean: _mean, scale: _scale, T: _T };
}

function normalize(feats: number[], mean: number[], scale: number[]): number[] {
  return feats.map((v,i) => (v - mean[i]) / (scale[i] || 1));
}

function toSpikeTrain(feats: number[], mean: number[], scale: number[], T: number): number[][] {
  const norm = normalize(feats, mean, scale);
  const prob = norm.map(v => 1/(1+Math.exp(-v)));
  const spikes: number[][] = Array.from({length: T}, () => Array(feats.length).fill(0));
  for (let t=0; t<T; t++) for (let i=0; i<feats.length; i++) spikes[t][i] = Math.random() < Math.min(0.98, Math.max(0.02, prob[i])) ? 1 : 0;
  return spikes;
}

export interface SNNResult {
  residual: number;
  spikeCount: number;
  active: boolean;
  rate: number[];
}

let _lastFeats: number[] | null = null;

export async function predictSNN(feats: number[]): Promise<SNNResult> {
  // feats: [temp, wind, pressure, crew, dg_load]
  const { w, mean, scale, T } = await loadWeights();
  // event gating: skip if delta small
  if (_lastFeats) {
    const norm = normalize(feats, mean, scale);
    const lastNorm = normalize(_lastFeats, mean, scale);
    const delta = norm.reduce((a, v, i) => a + Math.abs(v - lastNorm[i]), 0) / norm.length;
    if (delta < EVENT_THRESH) {
      return { residual: 0, spikeCount: 0, active: false, rate: Array(feats.length).fill(0) };
    }
  }
  _lastFeats = [...feats];
  const spikes = toSpikeTrain(feats, mean, scale, T);
  let spikeCount = 0; spikes.forEach(row => row.forEach(v => spikeCount += v));
  const rate = spikes[0].map((_, i) => spikes.reduce((a, row) => a + row[i], 0) / T);
  // linear decode: residual = dot(rate, w) * scale factor
  let residual = 0;
  for (let i=0;i<w.length;i++) residual += rate[i] * w[i] * 12; // scale to ~ L/day
  // fallback to physics-informed
  if (!Number.isFinite(residual) || Math.abs(residual) > 50) residual = 5*feats[4] + 0.3*feats[3] - 2;
  return { residual, spikeCount, active: spikeCount > 0, rate };
}

export function resetSNN() { _lastFeats = null; }
