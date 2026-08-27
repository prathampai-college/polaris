FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/* && apt-get clean
COPY hq/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY hq/app ./app
COPY shared ./shared
COPY ai ./ai
EXPOSE 8000
RUN useradd -u 10001 -m appuser && chown -R appuser:appuser /app
USER appuser
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 CMD curl -f http://localhost:8000/health || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]

