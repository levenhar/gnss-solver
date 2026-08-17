# ---------- Stage 1: build RTKLIB rnx2rtkp + RNXCMP CRX2RNX ----------
FROM debian:bookworm-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# RTKLIB demo5 (rnx2rtkp)
RUN git clone --depth 1 https://github.com/rtklibexplorer/RTKLIB.git /src/rtklib
RUN make -C /src/rtklib/app/consapp/rnx2rtkp/gcc && \
    cp /src/rtklib/app/consapp/rnx2rtkp/gcc/rnx2rtkp /usr/local/bin/rnx2rtkp

# RNXCMP (CRX2RNX) — Hatanaka compression tool
RUN curl -fsSL https://terras.gsi.go.jp/ja/crx2rnx/RNXCMP_4.1.0_src.tar.gz -o /tmp/rnxcmp.tar.gz && \
    tar xzf /tmp/rnxcmp.tar.gz -C /tmp && \
    gcc -O2 -o /usr/local/bin/CRX2RNX /tmp/RNXCMP_*/source/crx2rnx.c

# ---------- Stage 2: runtime ----------
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends gzip && \
    rm -rf /var/lib/apt/lists/*
COPY --from=builder /usr/local/bin/rnx2rtkp /usr/local/bin/rnx2rtkp
COPY --from=builder /usr/local/bin/CRX2RNX /usr/local/bin/CRX2RNX

WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir . && \
    pip install --no-cache-dir -r requirements-api.txt

ENV DATA_DIR=/data
EXPOSE 8000
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
