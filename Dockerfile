ARG UBUNTU_VERSION=24.04
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS node-runtime

FROM ubuntu:${UBUNTU_VERSION} AS tsreplace-builder

ARG DEBIAN_FRONTEND=noninteractive
ARG TSREPLACE_REF=98d6739180c858927a52c0d70ab20a45b4a9e39e

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        git \
        libavcodec-dev \
        libavfilter-dev \
        libavformat-dev \
        libavutil-dev \
        libswresample-dev \
        pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --filter=blob:none --recursive https://github.com/rigaya/tsreplace.git \
    && cd tsreplace \
    && git checkout --detach "${TSREPLACE_REF}" \
    && git submodule update --init --recursive

WORKDIR /src/tsreplace
COPY patches/tsreplace-wait-for-complete-pmt.patch /tmp/tsreplace-wait-for-complete-pmt.patch
COPY patches/tsreplace-low-latency-output-probe.patch /tmp/tsreplace-low-latency-output-probe.patch
RUN git apply --check --ignore-space-change /tmp/tsreplace-wait-for-complete-pmt.patch \
    && git apply --ignore-space-change /tmp/tsreplace-wait-for-complete-pmt.patch \
    && git apply --check --ignore-space-change /tmp/tsreplace-low-latency-output-probe.patch \
    && git apply --ignore-space-change /tmp/tsreplace-low-latency-output-probe.patch \
    && ./configure --prefix=/opt/tsreplace \
    && make -j"$(nproc)" \
    && make install

FROM ubuntu:${UBUNTU_VERSION}

ARG DEBIAN_FRONTEND=noninteractive
ARG TARGETARCH
ARG QSVENC_VERSION=8.26
ARG QSVENC_SHA256=3b8c9ea9801e6563a8efc62acea2ab86404cf01503d134b6cf013a186f4f1b7a

RUN test "${TARGETARCH}" = "amd64" \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        intel-media-va-driver-non-free \
        libavcodec60 \
        libavfilter9 \
        libavformat60 \
        libavutil58 \
        libswresample4 \
        libstdc++6 \
        tini \
        vainfo \
    && curl --fail --location --show-error \
        "https://github.com/rigaya/QSVEnc/releases/download/${QSVENC_VERSION}/qsvencc_${QSVENC_VERSION}_amd64.deb" \
        --output /tmp/qsvencc.deb \
    && echo "${QSVENC_SHA256}  /tmp/qsvencc.deb" | sha256sum --check --strict \
    && apt-get install -y --no-install-recommends /tmp/qsvencc.deb \
    && rm -f /tmp/qsvencc.deb \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin app

COPY --from=tsreplace-builder /opt/tsreplace/bin/tsreplace /usr/local/bin/tsreplace
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/LICENSE /usr/local/share/doc/node/LICENSE

WORKDIR /app
COPY --chown=app:app package.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app LICENSE THIRD_PARTY_NOTICES.md ./
COPY --chown=app:app third_party ./third_party

ENV NODE_ENV=production \
    PORT=40773 \
    LIBVA_DRIVER_NAME=iHD

USER app
EXPOSE 40773

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD curl --fail --silent --show-error http://127.0.0.1:40773/healthz >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
