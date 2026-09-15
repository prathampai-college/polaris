#!/usr/bin/env python3
"""Export trained LIF matrices from ai/snn/snn_weights.json into shared/src/snn-config.ts.

Usage: python scripts/export_snn_config.py
Keeps the field tablet's JS engine bit-consistent with the trained ONNX (see
ai/snn/train_snn.py inference contract). Re-run after every retrain.
"""
import json
import pathlib

REPO = pathlib.Path(__file__).parent.parent
W_PATH = REPO / "ai" / "snn" / "snn_weights.json"
OUT = REPO / "shared" / "src" / "snn-config.ts"


def main():
    w = json.loads(W_PATH.read_text(encoding="utf-8"))
    L = w.get("layers") or {}
    lines = [
        "// GENERATED from ai/snn/snn_weights.json -- do not hand-edit. Regen: python scripts/export_snn_config.py",
        f"// model={w.get('model')} rmse_snn={w.get('rmse_snn', 0):.3f} "
        f"rmse_lin={w.get('rmse_linear', 0):.3f} spike_activity={w.get('spike_activity', 0):.4f}",
        "export const SNN_EVENT_THRESH = 0.12;",
        f"export const SNN_MODEL = '{w.get('model', 'linear-proxy')}';",
        f"export const SNN_BETA = {L.get('beta', 0.9)};",
        f"export const SNN_T = {L.get('T', w.get('T', 20))};",
        f"export const SNN_Y_MEAN = {L.get('y_mean', 0.0)};",
        f"export const SNN_Y_STD = {L.get('y_std', 1.0)};",
        f"export const SNN_MEAN = [{', '.join(repr(float(v)) for v in w['mean'])}];",
        f"export const SNN_SCALE = [{', '.join(repr(float(v)) for v in w['scale'])}];",
        f"export const SNN_DEFAULT_WEIGHTS = [{', '.join(repr(float(v)) for v in w['weights'])}];",
    ]
    for k in ["W1", "b1", "W2", "b2", "W3", "b3"]:
        v = L.get(k)
        if v is None:
            continue
        kind = "number[]" if k.startswith("b") else "number[][]"
        lines.append(f"export const SNN_{k.upper()}: {kind} = {json.dumps(v)};")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {OUT} model={w.get('model')}")


if __name__ == "__main__":
    main()
