# syntax=docker/dockerfile:1
FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && apt-get clean
COPY hq/requirements.txt ./requirements.txt
# Runtime-only pinned deps (torch/snntorch/onnx intentionally excluded — see hq/requirements.txt).
# Training uses ai/requirements.txt outside this image. The pip cache mount
# speeds local rebuilds; the pins keep the layer reusable across builds.
# Keep pip verbose (no -q) so long downloads are visible instead of looking hung.
RUN --mount=type=cache,target=/root/.cache/pip pip install --no-cache-dir -r requirements.txt
COPY hq/app ./app
COPY shared/sql ./shared/sql
COPY shared/seed.json shared/physics.json shared/vessel_schedule.json ./shared/
# Runtime AI artifacts only (forecast.py + snn_forecast.py read exactly these):
# the rest of ai/ (runner/, snn/train_*, training/) would bust this layer on
# every AI edit and bloat the image for no runtime benefit.
COPY ai/thermo_residual.onnx ai/scaler.json ./ai/
COPY ai/snn/snn_weights.json ./ai/snn/snn_weights.json
EXPOSE 8000
RUN useradd -u 10001 -m appuser && chown -R appuser:appuser /app
USER appuser
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=10 CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
