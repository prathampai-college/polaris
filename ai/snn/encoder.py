"""Spike train encoder — rate coding for SNN (snnTorch). Phase 2."""
import json, pathlib
import numpy as np

def load_scaler():
    for p in [pathlib.Path(__file__).parent.parent / "scaler.json", pathlib.Path("/app/ai/scaler.json")]:
        if p.exists():
            j = json.loads(p.read_text())
            return np.array(j["mean"], dtype=np.float32), np.array(j["scale"], dtype=np.float32)
    # fallback from training scaler
    return np.array([-15, 5, 1013, 24, 0.7], dtype=np.float32), np.array([10, 5, 15, 5, 0.3], dtype=np.float32)

MEAN, SCALE = load_scaler()
T_STEPS = 20

def normalize(feats: np.ndarray) -> np.ndarray:
    """feats: [temp, wind, pressure, crew, dg_load] -> normalized"""
    return (feats - MEAN) / SCALE

def to_spike_train(feats: np.ndarray, T: int = T_STEPS, seed: int = 0) -> np.ndarray:
    """Rate coding: norm -> [0,1] prob -> Poisson spikes [T, 5]"""
    norm = normalize(feats)
    # squash to [0,1] via sigmoid
    prob = 1 / (1 + np.exp(-norm))
    prob = np.clip(prob, 0.02, 0.98)
    rng = np.random.default_rng(seed)
    spikes = (rng.random((T, feats.shape[0])) < prob).astype(np.float32)
    return spikes

def from_spike_rate(spikes: np.ndarray) -> np.ndarray:
    return spikes.mean(axis=0)

if __name__ == "__main__":
    feats = np.array([-38, 22, 1005, 24, 0.95], dtype=np.float32)
    spikes = to_spike_train(feats)
    print("spikes", spikes.shape, "rate", from_spike_rate(spikes))
    # roundtrip sanity
    rate = from_spike_rate(spikes)
    print("rate", rate)
