import pathlib, json
import numpy as np

_SCALER_SNN = None
_W = None
_T = 20

def _load_snn():
    global _SCALER_SNN, _W, _T
    if _W is not None:
        return
    # try snn weights
    for p in [pathlib.Path(__file__).parent.parent.parent / "ai" / "snn" / "snn_weights.json",
              pathlib.Path(__file__).parent.parent / "snn_weights.json",
              pathlib.Path("/app/ai/snn/snn_weights.json")]:
        if p.exists():
            j = json.loads(p.read_text())
            _W = np.array(j["weights"], dtype=np.float32)
            _SCALER_SNN = {"mean": np.array(j["mean"], dtype=np.float32), "scale": np.array(j["scale"], dtype=np.float32)}
            _T = j.get("T", 20)
            return
    # fallback to scaler.json
    for p in [pathlib.Path(__file__).parent.parent.parent / "ai" / "scaler.json",
              pathlib.Path("/app/ai/scaler.json")]:
        if p.exists():
            j = json.loads(p.read_text())
            _SCALER_SNN = {"mean": np.array(j["mean"], dtype=np.float32), "scale": np.array(j["scale"], dtype=np.float32)}
            _W = np.array([0.02, 0.01, 0.005, 0.3, 5.0], dtype=np.float32)
            return
    _SCALER_SNN = {"mean": np.array([-15,5,1013,24,0.7], dtype=np.float32), "scale": np.array([10,5,15,5,0.3], dtype=np.float32)}
    _W = np.array([0.02, 0.01, 0.005, 0.3, 5.0], dtype=np.float32)

_last_feats = None
_EVENT_THRESH = 0.12

def predict_snn_total(temp_out, wind, pressure, crew, dg_load, station_id=None):
    global _last_feats
    _load_snn()
    feats = np.array([temp_out, wind, pressure, crew, dg_load], dtype=np.float32)
    mean = _SCALER_SNN["mean"]; scale = _SCALER_SNN["scale"]
    norm = (feats - mean) / scale
    # event gating
    active = True
    if _last_feats is not None:
        last_norm = (_last_feats - mean) / scale
        delta = float(np.mean(np.abs(norm - last_norm)))
        if delta < _EVENT_THRESH:
            active = False
    _last_feats = feats.copy()
    # physics
    from .forecast import physics_pred
    phys = physics_pred(temp_out, wind, pressure, station_id)
    if not active:
        return phys, 0.0, phys, False, 0
    # spike rate coding via sigmoid
    prob = 1/(1+np.exp(-norm))
    prob = np.clip(prob, 0.02, 0.98)
    rng = np.random.default_rng(int(abs(temp_out*100)) % 9999)
    spikes = (rng.random((20, 5)) < prob).astype(np.float32)
    rate = spikes.mean(axis=0)
    residual = float(np.dot(rate, _W) * 12)
    if not np.isfinite(residual) or abs(residual) > 50:
        residual = 5*dg_load + 0.3*crew - 2
    total = phys + residual
    spike_count = int(spikes.sum())
    return phys, residual, total, True, spike_count

def reset_snn():
    global _last_feats
    _last_feats = None
