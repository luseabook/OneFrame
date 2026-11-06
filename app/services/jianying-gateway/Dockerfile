FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/app/data

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY run.py ./

# 非 root 运行（H-4）：专用用户，数据目录归它所有
RUN mkdir -p /app/data/files /app/data/uploads \
 && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin gateway \
 && chown -R gateway:gateway /app/data
VOLUME ["/app/data"]
EXPOSE 8788

USER gateway

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8788/healthz',timeout=4)"

CMD ["python", "run.py"]