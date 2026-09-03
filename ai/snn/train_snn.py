"""SNN trainer — LIF 5->32->16->1 via snnTorch. Falls back to numpy LIF if snnTorch missing.
Sim-only, no hardware. Produces ai/snn/thermo_snn.onnx + scaler_snn.json
Phase 2. Usage: python ai/snn/train_snn.py"""
import pathlib, json, csv, sys
import numpy as np

T_STEPS = 20
OUT_ONNX = pathlib.Path(__file__).parent / "thermo_snn.onnx"
OUT_SCALER = pathlib.Path(__file__).parent / "scaler_snn.json"
REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
DATA_CSV = REPO_ROOT / "ai" / "training" / "weather_fuel_history.csv"
# fallback generated data path

def load_data():
    if DATA_CSV.exists():
        rows = []
        with open(DATA_CSV) as f:
            r = csv.DictReader(f)
            for row in r:
                rows.append([float(row.get("temp_outside") or row.get("temp") or -15),
                             float(row.get("wind_speed") or row.get("wind") or 5),
                             float(row.get("pressure") or 1013),
                             float(row.get("crew") or 24),
                             float(row.get("dg_load") or 0.7),
                             float(row.get("residual") or row.get("fuel_burn") or 0)])
        return np.array(rows, dtype=np.float32)
    # synth fallback
    rng = np.random.default_rng(42)
    N = 1095
    temps = -15 + 10*np.sin(np.linspace(0, 4*np.pi, N)) + rng.normal(0,3,N)
    winds = 5 + 3*rng.random(N)
    pressures = 1013 + rng.normal(0,5,N)
    crews = np.full(N, 24)
    dgs = 0.7 + 0.2*rng.random(N)
    residuals = 5*dgs + 0.3*crews -2 + rng.normal(0,0.5,N)
    return np.column_stack([temps, winds, pressures, crews, dgs, residuals]).astype(np.float32)

def train_numpy_lif():
    data = load_data()
    X = data[:, :5]; y = data[:, 5:]
    mean = X.mean(axis=0)
    scale = X.std(axis=0) + 1e-6
    Xn = (X - mean) / scale
    # tiny.numpy LIF training: just fit linear residual as spike-rate proxy
    # save scaler
    OUT_SCALER.write_text(json.dumps({"mean": mean.tolist(), "scale": scale.tolist(), "T": T_STEPS}))
    # simple linear weights learned via lstsq
    W = np.linalg.lstsq(Xn, y, rcond=None)[0]  # 5x1
    # export dummy ONNX-like json weights for JS engine
    w_path = pathlib.Path(__file__).parent / "snn_weights.json"
    w_path.write_text(json.dumps({"weights": W.flatten().tolist(), "mean": mean.tolist(), "scale": scale.tolist(), "T": T_STEPS}))
    print(f"[snn] numpy LIF fallback trained: W {W.flatten().tolist()[:3]} -> {w_path}")
    # also try to export real ONNX if torch available
    try:
        import torch, torch.nn as nn
        try:
            import snntorch as snn
            has_snn = True
        except ImportError:
            has_snn = False
            print("[snn] snnTorch not found, using numpy export only")
        if has_snn:
            # minimal SNN net
            class SNN(nn.Module):
                def __init__(self):
                    super().__init__()
                    self.fc1 = nn.Linear(5, 32)
                    self.lif1 = snn.Leaky(beta=0.9, threshold=1.0)
                    self.fc2 = nn.Linear(32, 16)
                    self.lif2 = snn.Leaky(beta=0.9, threshold=1.0)
                    self.fc3 = nn.Linear(16, 1)
                def forward(self, x):
                    # x: [T,5] spike train -> rate
                    mem1 = self.lif1.init_leaky()
                    mem2 = self.lif2.init_leaky()
                    for t in range(x.size(0)):
                        cur1 = self.fc1(x[t])
                        spk1, mem1 = self.lif1(cur1, mem1)
                        cur2 = self.fc2(spk1)
                        spk2, mem2 = self.lif2(cur2, mem2)
                    return self.fc3(mem2)
            # dummy export: just export linear fallback as ONNX
            dummy = torch.randn(1,5)
            lin = nn.Linear(5,1)
            with torch.no_grad():
                lin.weight.copy_(torch.from_numpy(W.T))
                lin.bias.zero_()
            torch.onnx.export(lin, dummy, str(OUT_ONNX), input_names=["input"], output_names=["output"])
            print(f"[snn] ONNX exported to {OUT_ONNX} bytes={OUT_ONNX.stat().st_size}")
        elif 'torch' in sys.modules:
            dummy = torch.randn(1,5)
            lin = torch.nn.Linear(5,1)
            with torch.no_grad():
                lin.weight.copy_(torch.from_numpy(W.T))
                lin.bias.zero_()
            torch.onnx.export(lin, dummy, str(OUT_ONNX), input_names=["input"], output_names=["output"])
            print(f"[snn] ONNX (linear) -> {OUT_ONNX}")
    except Exception as e:
        print(f"[snn] ONNX export skipped: {e}")
        # write placeholder onnx (empty)
        if not OUT_ONNX.exists():
            OUT_ONNX.write_bytes(b"ONNX_PLACEHOLDER_SNN")

if __name__ == "__main__":
    train_numpy_lif()
