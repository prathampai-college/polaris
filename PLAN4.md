# PLAN 4: Expand Edge AI with Acoustic Prognostics

## Objective
Expand the AI capabilities by adding a second modality: Acoustic Prognostics for predictive maintenance (e.g., detecting diesel generator bearing failure).

## Current State
- The project currently runs a single 1.3KB ONNX model (`thermo_residual.onnx`) that predicts fuel consumption based on weather telemetry.
- The pitch deck's "Future (§11)" roadmap mentions "acoustic prognostics". 

## Actionable Steps
1. **Synthetic Data Generation:**
   - Create a Python script in `ai/training/` to generate synthetic audio features (e.g., Mel-frequency cepstral coefficients - MFCCs) representing normal generator hum vs. failing bearing whine.
2. **Model Training:**
   - Train a small classification model (e.g., a tiny CNN or MLP) using PyTorch.
   - Export the model to `ai/acoustic_anomaly.onnx` ensuring it remains under 5MB for fast edge loading.
3. **Edge Inference:**
   - Update `ai/runner/infer.mjs` to load the new acoustic model using `onnxruntime-node`.
   - Expose a new endpoint or function to pass audio feature data into the model.
4. **Integration:**
   - In the telemetry pipeline, include a simulated audio feature vector.
   - If the model detects an anomaly (probability > 90%), auto-generate a CRITICAL indent for the specific spare part (e.g., `SPARE-BRG-6205-007` DG Bearing).
5. **Dashboard Updates:**
   - Display an "Acoustic Health" indicator on the HQ Dashboard and Field PWA to show real-time maintenance status.

## Impact
Proves the edge architecture is extensible to multi-modal AI. Detecting mechanical failures before they happen in a -40°C environment directly solves a life-critical problem and makes the AI story much stronger.
