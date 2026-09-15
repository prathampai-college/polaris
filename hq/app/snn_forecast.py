import pathlib, json
import numpy as np

_SCALER_SNN = None
_W = None
_T = 20
_SNN_MODEL = "linear-proxy"
_LAYERS = None  # lif-5-32-16-1 matrices when trained
_BETA = 0.9
_Y_MEAN = 0.0
_Y_STD = 1.0


def _load_snn():
    global _SCALER_SNN, _W, _T, _SNN_MODEL, _LAYERS, _BETA, _Y_MEAN, _Y_STD
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
            _SNN_MODEL = j.get("model", "linear-proxy" if j.get("linear_proxy") else "lif-5-32-16-1")
            if isinstance(j.get("layers"), dict):
                L = j["layers"]
                _LAYERS = {k: np.array(v, dtype=np.float32) for k, v in L.items() if isinstance(v, list)}
                _BETA = float(L.get("beta", 0.9))
                _Y_MEAN = float(L.get("y_mean", 0.0))
                _Y_STD = float(L.get("y_std", 1.0))
            return
    # fallback to scaler.json
    for p in [pathlib.Path(__file__).parent.parent.parent / "ai" / "scaler.json",
              pathlib.Path("/app/ai/scaler.json")]:
        if p.exists():
            j = json.loads(p.read_text())
            _SCALER_SNN = {"mean": np.array(j["mean"], dtype=np.float32), "scale": np.array(j["scale"], dtype=np.float32)}
            _W = np.array([0.02, 0.01, 0.005, 0.3, 5.0], dtype=np.float32)
            return
    _SCALER_SNN = {"mean": np.array([-15, 5, 1013, 24, 0.7], dtype=np.float32), "scale": np.array([10, 5, 15, 5, 0.3], dtype=np.float32)}
    _W = np.array([0.02, 0.01, 0.005, 0.3, 5.0], dtype=np.float32)
    _SNN_MODEL = "linear-proxy"


def _lif_forward(xn):
    """Numpy mirror of train_snn.ThermoSNN — bit-consistent with exported ONNX.

    Exact snnTorch 1.0 Leaky dynamics (reset_delay=True default):
      reset = (mem_old >= 1); mem_new = beta*mem_old + cur - reset*threshold; spk = (mem_new >= 1)
    i.e. one-step-delayed subtract reset. Verified step-by-step vs torch + ONNX.
    xn: normalized [5] -> (residual_raw, spike_count). Deterministic.
    """
    W1, b1 = _LAYERS["W1"], _LAYERS["b1"]  # 32x5, 32
    W2, b2 = _LAYERS["W2"], _LAYERS["b2"]  # 16x32, 16
    W3, b3 = _LAYERS["W3"], _LAYERS["b3"]  # 1x16, 1
    mem1 = np.zeros(32, dtype=np.float32)
    mem2 = np.zeros(16, dtype=np.float32)
    out_sum = 0.0
    spikes = 0
    for _ in range(_T):
        reset1 = (mem1 >= 1.0).astype(np.float32)
        mem1 = _BETA * mem1 + (W1 @ xn + b1) - reset1 * 1.0
        spk1 = (mem1 >= 1.0).astype(np.float32)
        reset2 = (mem2 >= 1.0).astype(np.float32)
        mem2 = _BETA * mem2 + (W2 @ spk1 + b2) - reset2 * 1.0
        spk2 = (mem2 >= 1.0).astype(np.float32)
        out_sum += float(W3 @ spk2 + b3)
        spikes += int(spk1.sum() + spk2.sum())
    return float(out_sum / _T * _Y_STD + _Y_MEAN), spikes


def _linear_proxy_residual(rate, dg_load, crew):
    residual = float(np.dot(rate, _W) * 12)
    if not np.isfinite(residual) or abs(residual) > 50:
        residual = 5 * dg_load + 0.3 * crew - 2
    return residual


_last_feats = None
_last_residual = None
_EVENT_THRESH = 0.12


def predict_snn_total(temp_out, wind, pressure, crew, dg_load, station_id=None):
    global _last_feats, _last_residual
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
        cached = _last_residual if _last_residual is not None else 0.0
        return phys, cached, phys + cached, False, 0
    if _LAYERS is not None:
        residual, spike_count = _lif_forward(norm.astype(np.float32))
        if not np.isfinite(residual) or abs(residual) > 50:
            residual = 5 * dg_load + 0.3 * crew - 2
            spike_count = 0
    else:
        # legacy linear-proxy rate coding via sigmoid
        prob = 1 / (1 + np.exp(-norm))
        prob = np.clip(prob, 0.02, 0.98)
        rng = np.random.default_rng(int(abs(temp_out * 100)) % 9999)
        spikes = (rng.random((20, 5)) < prob).astype(np.float32)
        rate = spikes.mean(axis=0)
        residual = _linear_proxy_residual(rate, dg_load, crew)
        spike_count = int(spikes.sum())
    _last_residual = residual
    total = phys + residual
    return phys, residual, total, True, spike_count


def snn_energy_stats(spike_count, active):
    """Spike-proportional energy estimate (sim-only): SNN accumulate ops scale with spikes,
    dense ANN MACs scale with full fan-out. Returns (saved_pct, source_label)."""
    if not active:
        return 99.0, "event-gated idle"
    dense_ops = _T * (32 + 16)  # one MAC per LIF neuron per step in the dense equivalent
    saved = max(0.0, min(99.0, (1.0 - spike_count / dense_ops) * 100.0))
    return round(saved, 1), "spike-proportional estimate"


def reset_snn():
    global _last_feats, _last_residual
    _last_feats = None
    _last_residual = None
