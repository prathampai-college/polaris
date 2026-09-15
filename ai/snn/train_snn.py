"""SNN trainer — LIF 5->32->16->1 via snnTorch (BPTT, surrogate gradients).
Sim-only, no hardware. Produces ai/snn/thermo_snn.onnx + scaler_snn.json + snn_weights.json

Phase 3. Usage:
  python ai/snn/train_snn.py [--epochs 150] [--linear-baseline]
  --linear-baseline forces the legacy lstsq proxy (CI comparison only).
"""
import argparse
import pathlib
import json
import csv
import sys

import numpy as np

# ponytail: force UTF-8 stdout so torch.onnx logs don't crash Windows cp1252 consoles
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

T_STEPS = 20
BETA = 0.9
OUT_ONNX = pathlib.Path(__file__).parent / "thermo_snn.onnx"
OUT_SCALER = pathlib.Path(__file__).parent / "scaler_snn.json"
OUT_WEIGHTS = pathlib.Path(__file__).parent / "snn_weights.json"
REPO_ROOT = pathlib.Path(__file__).parent.parent.parent
DATA_CSV = REPO_ROOT / "ai" / "training" / "weather_fuel_history.csv"


def load_data():
    if DATA_CSV.exists():
        rows = []
        with open(DATA_CSV) as f:
            r = csv.DictReader(f)
            for row in r:
                rows.append([float(row.get("temp_outside") or row.get("temp") or -15),
                             float(row.get("wind_speed") or row.get("wind") or 5),
                             float(row.get("pressure") or 1013),
                             float(row.get("crew_count") or row.get("crew") or 24),
                             float(row.get("dg_load") or 0.7),
                             float(row.get("residual") or row.get("fuel_burn") or 0)])
        return np.array(rows, dtype=np.float32)
    # synth fallback (pre-training only — fine-tune on live burn when available)
    rng = np.random.default_rng(42)
    N = 1095
    temps = -15 + 10 * np.sin(np.linspace(0, 4 * np.pi, N)) + rng.normal(0, 3, N)
    winds = 5 + 3 * rng.random(N)
    pressures = 1013 + rng.normal(0, 5, N)
    crews = np.full(N, 24)
    dgs = 0.7 + 0.2 * rng.random(N)
    residuals = 5 * dgs + 0.3 * crews - 2 + rng.normal(0, 0.5, N)
    return np.column_stack([temps, winds, pressures, crews, dgs, residuals]).astype(np.float32)


def time_split(Xn, y, test_frac=0.15, seed=42):
    rng = np.random.default_rng(seed)
    idx = np.arange(len(Xn))
    rng.shuffle(idx)
    n_test = max(1, int(len(Xn) * test_frac))
    te, tr = idx[:n_test], idx[n_test:]
    return Xn[tr], y[tr], Xn[te], y[te]


def train_linear_baseline(Xn_tr, y_tr, Xn_te, y_te):
    W = np.linalg.lstsq(Xn_tr, y_tr, rcond=None)[0]  # 5x1
    pred = Xn_te @ W
    rmse = float(np.sqrt(np.mean((pred - y_te) ** 2)))
    return W.astype(np.float32), rmse


def train_lif(Xn_tr, y_tr, Xn_te, y_te, epochs=300, lr=2e-3, steps_per_epoch=4):
    import torch
    import torch.nn as nn
    import snntorch as snn
    from snntorch import surrogate

    spike_grad = surrogate.atan()

    class ThermoSNN(nn.Module):
        """LIF 5->32->16->1, beta=0.9. Input repeated over T steps; rate-decoded output.

        Inference contract (hq/app/snn_forecast.py + field/lib/snn/engine.ts mirror this
        exactly): snnTorch 1.0 Leaky default reset_delay=True gives one-step-delayed
        subtract reset — reset=(mem_old>=1); mem=beta*mem_old+cur-reset; spk=(mem>=1).
        Do NOT change Leaky defaults without updating both mirrors (verify diff <1e-3).
        """

        def __init__(self):
            super().__init__()
            self.fc1 = nn.Linear(5, 32)
            self.lif1 = snn.Leaky(beta=BETA, spike_grad=spike_grad, init_hidden=False)
            self.fc2 = nn.Linear(32, 16)
            self.lif2 = snn.Leaky(beta=BETA, spike_grad=spike_grad, init_hidden=False)
            self.fc3 = nn.Linear(16, 1)

        def forward(self, x):
            # explicit zero-state (NOT init_leaky(): empty-tensor init silently skips reset)
            mem1 = torch.zeros(x.size(0), 32, device=x.device, dtype=x.dtype)
            mem2 = torch.zeros(x.size(0), 16, device=x.device, dtype=x.dtype)
            out_sum = 0
            for _ in range(T_STEPS):
                cur1 = self.fc1(x)
                spk1, mem1 = self.lif1(cur1, mem1)
                cur2 = self.fc2(spk1)
                spk2, mem2 = self.lif2(cur2, mem2)
                out_sum = out_sum + self.fc3(spk2)
            return out_sum / T_STEPS

    # standardize targets (residuals ~7 with std ~6); un-scale at export
    y_mean = float(y_tr.mean())
    y_std = float(y_tr.std() + 1e-6)

    device = torch.device("cpu")
    net = ThermoSNN().to(device)
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    loss_fn = nn.MSELoss()
    Xtr = torch.from_numpy(Xn_tr)
    ytr = torch.from_numpy(((y_tr - y_mean) / y_std).astype(np.float32))
    Xte = torch.from_numpy(Xn_te)
    yte_raw = torch.from_numpy(y_te)

    net.train()
    for epoch in range(epochs):
        for _ in range(steps_per_epoch):
            idx = torch.randint(0, len(Xtr), (256,))
            xb, yb = Xtr[idx].to(device), ytr[idx].to(device)
            opt.zero_grad()
            pred = net(xb)
            loss = loss_fn(pred, yb)
            loss.backward()
            opt.step()
        if epoch % 50 == 0 or epoch == epochs - 1:
            net.eval()
            with torch.no_grad():
                te_pred_raw = net(Xte.to(device)) * y_std + y_mean
                te_loss = loss_fn(te_pred_raw, yte_raw.to(device)).item()
            print(f"[snn] epoch {epoch} train {loss.item():.3f} test-raw-mse {te_loss:.3f}")
            net.train()

    net.eval()
    with torch.no_grad():
        te_pred_raw = net(Xte.to(device)) * y_std + y_mean
        rmse = float(torch.sqrt(loss_fn(te_pred_raw, yte_raw.to(device))).item())
        # mean spike activity on holdout (energy proxy)
        m1 = torch.zeros(len(Xte), 32)
        m2 = torch.zeros(len(Xte), 16)
        spikes = 0
        tot = 0
        for _ in range(T_STEPS):
            s1, m1 = net.lif1(net.fc1(Xte.to(device)), m1)
            s2, m2 = net.lif2(net.fc2(s1), m2)
            spikes += int(s1.sum().item() + s2.sum().item())
            tot += s1.numel() + s2.numel()
        activity = spikes / max(1, tot)
    print(f"[snn] LIF holdout RMSE {rmse:.3f}, mean spike activity {activity:.4f}")
    return net, rmse, activity, y_mean, y_std


def export_onnx(net, y_mean, y_std):
    import torch
    import torch.nn as nn
    import onnx

    # bake target un-scaling into the graph so ONNX I/O stays raw residual
    class ScaledSNN(nn.Module):
        def __init__(self, core):
            super().__init__()
            self.core = core

        def forward(self, x):
            return self.core(x) * y_std + y_mean

    wrapped = ScaledSNN(net)
    wrapped.eval()
    dummy = torch.randn(1, 5)
    torch.onnx.export(wrapped, dummy, str(OUT_ONNX), input_names=["input"], output_names=["output"],
                      dynamic_axes={"input": {0: "batch"}, "output": {0: "batch"}}, opset_version=18)
    # re-embed external weights into a single file
    try:
        from onnx.external_data_helper import load_external_data_for_model as _load_ext
        _m = onnx.load(str(OUT_ONNX))
        try:
            _load_ext(_m, str(OUT_ONNX.parent))
        except Exception:
            pass
        onnx.save_model(_m, str(OUT_ONNX), save_as_external_data=False)
        for _ext in [pathlib.Path(str(OUT_ONNX) + ".data"), OUT_ONNX.with_suffix(".data")]:
            try:
                if _ext.exists() and _ext.resolve() != OUT_ONNX.resolve():
                    _ext.unlink()
            except Exception:
                pass
    except Exception as e:
        print(f"[snn] single-file embed skipped ({e})")
    onnx.load(str(OUT_ONNX))  # validates
    print(f"[snn] ONNX -> {OUT_ONNX} bytes={OUT_ONNX.stat().st_size}")


def main():
    ap = argparse.ArgumentParser(description="Train LIF SNN residual corrector")
    ap.add_argument("--epochs", type=int, default=300)
    ap.add_argument("--linear-baseline", action="store_true", help="force legacy lstsq proxy")
    args = ap.parse_args()

    data = load_data()
    X = data[:, :5]
    y = data[:, 5:]
    mean = X.mean(axis=0).astype(np.float32)
    scale = (X.std(axis=0) + 1e-6).astype(np.float32)
    Xn = ((X - mean) / scale).astype(np.float32)
    y = y.astype(np.float32)
    OUT_SCALER.write_text(json.dumps({"mean": mean.tolist(), "scale": scale.tolist(), "T": T_STEPS}))
    Xn_tr, y_tr, Xn_te, y_te = time_split(Xn, y)

    W_lin, rmse_lin = train_linear_baseline(Xn_tr, y_tr, Xn_te, y_te)
    print(f"[snn] linear baseline holdout RMSE {rmse_lin:.3f}")

    # Provisional weights so downstream never breaks mid-train
    OUT_WEIGHTS.write_text(json.dumps({"weights": W_lin.flatten().tolist(), "mean": mean.tolist(),
                                       "scale": scale.tolist(), "T": T_STEPS, "linear_proxy": True,
                                       "model": "linear-proxy", "rmse_linear": rmse_lin}))

    if args.linear_baseline:
        print("[snn] --linear-baseline forced; exporting linear ONNX only")
        import torch
        import torch.nn as nn
        lin = nn.Linear(5, 1)
        with torch.no_grad():
            lin.weight.copy_(torch.from_numpy(W_lin.T))
            lin.bias.zero_()
        lin.eval()
        torch.onnx.export(lin, torch.randn(1, 5), str(OUT_ONNX), input_names=["input"], output_names=["output"])
        print(f"[snn] linear ONNX -> {OUT_ONNX} bytes={OUT_ONNX.stat().st_size}")
        return

    try:
        net, rmse_snn, activity, y_mean, y_std = train_lif(Xn_tr, y_tr, Xn_te, y_te, epochs=args.epochs)
    except ImportError as e:
        print(f"[snn] snnTorch missing ({e}); keeping linear-proxy weights")
        return

    import torch
    with torch.no_grad():
        layers = {"W1": net.fc1.weight.cpu().numpy().tolist(), "b1": net.fc1.bias.cpu().numpy().tolist(),
                  "W2": net.fc2.weight.cpu().numpy().tolist(), "b2": net.fc2.bias.cpu().numpy().tolist(),
                  "W3": net.fc3.weight.cpu().numpy().tolist(), "b3": net.fc3.bias.cpu().numpy().tolist(),
                  "beta": BETA, "T": T_STEPS, "y_mean": y_mean, "y_std": y_std}
    OUT_WEIGHTS.write_text(json.dumps({"weights": W_lin.flatten().tolist(), "mean": mean.tolist(),
                                       "scale": scale.tolist(), "T": T_STEPS, "linear_proxy": False,
                                       "model": "lif-5-32-16-1", "layers": layers,
                                       "rmse_linear": rmse_lin, "rmse_snn": rmse_snn,
                                       "spike_activity": activity}))
    print(f"[snn] weights -> {OUT_WEIGHTS} model=lif-5-32-16-1 rmse_snn={rmse_snn:.3f} vs rmse_lin={rmse_lin:.3f}")
    try:
        export_onnx(net, y_mean, y_std)
    except Exception as e:
        print(f"[snn] ONNX export skipped: {e}")


if __name__ == "__main__":
    main()
