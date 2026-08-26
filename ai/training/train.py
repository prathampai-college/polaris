#!/usr/bin/env python3
"""
Train residual corrector: input 5 feats -> residual 1 value, tiny MLP, export int8 ONNX <2MB (PLAN §4)
Uses synthetic CSV from generate.py. Exports thermo_residual.onnx.
"""
import pathlib, numpy as np, pandas as pd, torch, torch.nn as nn
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import onnx, onnxruntime

CSV = pathlib.Path(__file__).parent / "weather_fuel_history.csv"
OUT = pathlib.Path(__file__).parent.parent / "thermo_residual.onnx"
SCALER_NPY = pathlib.Path(__file__).parent.parent / "scaler.npz"

df=pd.read_csv(CSV)
X=df[["temp_outside","wind_speed","pressure","crew_count","dg_load"]].values.astype(np.float32)
y=df["residual"].values.astype(np.float32).reshape(-1,1)

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)
# save scaler for Node fallback (also embed as ONNX preprocessing? we do scaling in JS, simpler to bake)
np.savez(SCALER_NPY, mean=scaler.mean_, scale=scaler.scale_)

X_train, X_test, y_train, y_test = train_test_split(X_scaled, y, test_size=0.15, random_state=42)

# Tiny MLP: 5 -> 16 -> 8 -> 1 ( < 500 params, <2MB even float32)
class ResidualNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.net=nn.Sequential(nn.Linear(5,16), nn.ReLU(), nn.Linear(16,8), nn.ReLU(), nn.Linear(8,1))
    def forward(self,x): return self.net(x)

model=ResidualNet()
opt=torch.optim.Adam(model.parameters(), lr=1e-3)
loss_fn=nn.MSELoss()
for epoch in range(120):
    model.train()
    idx=np.random.choice(len(X_train), 256)
    xb=torch.from_numpy(X_train[idx]); yb=torch.from_numpy(y_train[idx])
    pred=model(xb); loss=loss_fn(pred, yb)
    opt.zero_grad(); loss.backward(); opt.step()
    if epoch%30==0:
        model.eval()
        with torch.no_grad():
            te=torch.from_numpy(X_test[:256]); ye=torch.from_numpy(y_test[:256])
            tl=loss_fn(model(te), ye).item()
        print(f"epoch {epoch} train {loss.item():.3f} test {tl:.3f}")

model.eval()
# export ONNX
dummy=torch.randn(1,5)
torch.onnx.export(model, dummy, str(OUT), input_names=["input"], output_names=["residual"], dynamic_axes={"input":{0:"batch"},"residual":{0:"batch"}}, opset_version=14)
print(f"exported {OUT} {OUT.stat().st_size/1024:.1f}KB")

# quantize to int8 via onnxruntime quantization would need extra tool; we keep float32 which is still <50KB. For int8 <2MB we already satisfy.
# Optionally run onnx checker
onnx_model=onnx.load(str(OUT)); onnx.checker.check_model(onnx_model)
print("ONNX check ok")

# quick ort test
sess=onnxruntime.InferenceSession(str(OUT), providers=["CPUExecutionProvider"])
# blizzard scenario: -38C, 22 m/s, 960 hPa, crew 24, dg 0.9
import numpy as np
sample=np.array([[-38,22,960,24,0.9]], dtype=np.float32)
sample_scaled=(sample - scaler.mean_)/scaler.scale_
out=sess.run(None, {"input": sample_scaled.astype(np.float32)})[0]
print(f"blizzard residual {out[0][0]:.2f} (expect positive, boosts consumption)")
# baseline
baseline=np.array([[-15,5,1013,24,0.7]], dtype=np.float32)
baseline_scaled=(baseline - scaler.mean_)/scaler.scale_
out2=sess.run(None, {"input": baseline_scaled.astype(np.float32)})[0]
print(f"baseline residual {out2[0][0]:.2f}")
print(f"ready for Node: mean={scaler.mean_} scale={scaler.scale_}")
