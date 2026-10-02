# -----------------------------
# Stage 1: Builder
# -----------------------------
FROM quay.io/ukhomeofficedigital/hof-nodejs:24.21.0-alpine3.24-v5@sha256:110c8d92d27c94b5fd55a6442e884d42a835e3f59246e75dc8137afc20293414 AS builder

USER root
WORKDIR /app

COPY . /app

RUN yarn install --frozen-lockfile --production --ignore-optional --ignore-scripts

# -----------------------------
# Stage 2: Runtime
# -----------------------------
FROM quay.io/ukhomeofficedigital/hof-nodejs:24.21.0-alpine3.24-v5@sha256:110c8d92d27c94b5fd55a6442e884d42a835e3f59246e75dc8137afc20293414

USER root

RUN addgroup --system nodejs --gid 998 && \
    adduser --system nodejs --uid 999 --home /app/ && \
    chown -R 999:998 /app/

WORKDIR /app

COPY --from=builder --chown=999:998 /app/node_modules /app/node_modules
COPY --from=builder --chown=999:998 /app/. /app

USER 999

HEALTHCHECK --interval=5m --timeout=3s \
 CMD curl --fail http://localhost:8080 || exit 1

CMD yarn start

EXPOSE 8080
