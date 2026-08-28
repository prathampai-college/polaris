import pathlib, json

_physics = None
_scaler = None
_ort_sess = None

def load_physics():
    global _physics
    if _physics is not None:
        return _physics
    for p in [
        pathlib.Path(__file__).parent.parent.parent / "shared" / "physics.json",
        pathlib.Path("/app/shared/physics.json"),
        pathlib.Path(__file__).parent.parent.parent / "shared" / "src" / "physics.json",
    ]:
        if p.exists():
            _physics = json.loads(p.read_text())
            return _physics
    _physics = {"T_INSIDE": 18, "BASE": 110, "K1": 0.012, "K2": 0.018, "K3": 0.08}
    return _physics

def load_forecast_model():
    global _scaler, _ort_sess
    try:
        import numpy as np
        for sp in [
            pathlib.Path(__file__).parent.parent.parent / "ai" / "scaler.json",
            pathlib.Path("/app/ai/scaler.json"),
        ]:
            if sp.exists():
                j = json.loads(sp.read_text())
                _scaler = {"mean": np.array(j["mean"], dtype=np.float32), "scale": np.array(j["scale"], dtype=np.float32)}
                break
        import onnxruntime as ort
        for op in [
            pathlib.Path(__file__).parent.parent.parent / "ai" / "thermo_residual.onnx",
            pathlib.Path("/app/ai/thermo_residual.onnx"),
        ]:
            if op.exists():
                _ort_sess = ort.InferenceSession(str(op), providers=["CPUExecutionProvider"])
                break
    except Exception as e:
        print("[hq forecast] model fallback", e)
        _ort_sess = None

def physics_pred(temp_out, wind, pressure):
    ph = load_physics()
    pd = (1013 - pressure) / 1013
    return ph["BASE"] * (1 + ph["K1"] * (ph["T_INSIDE"] - temp_out) + ph["K2"] * wind) + ph["K3"] * pd * ph["BASE"]

def predict_total(temp_out, wind, pressure, crew, dg_load):
    phys = physics_pred(temp_out, wind, pressure)
    residual = 0
    used = False
    if _ort_sess and _scaler is not None:
        try:
            import numpy as np
            feats = np.array([[temp_out, wind, pressure, crew, dg_load]], dtype=np.float32)
            scaled = (feats[0] - _scaler["mean"]) / _scaler["scale"]
            out = _ort_sess.run(None, {"input": scaled.reshape(1, 5).astype(np.float32)})[0]
            residual = float(out[0][0])
            used = True
        except Exception:
            pass
    if not used:
        residual = 5 * dg_load + 0.3 * crew - 2
    total = phys + residual
    return phys, residual, total, used
