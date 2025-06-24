FROM quay.io/ukhomeofficedigital/hof-nodejs:20.19.0-alpine3.21@sha256:aad584fa26cb2838739527166c8965d95d0d2d9b88cfd5e3e2d3b8647ae03101

USER root
# Update packages as a result of Trivy security vulnerability checks
RUN apk update && apk upgrade --no-cache

# Fixes ajv, shelljs, tough-cookie vulnerabilities in package.json in the final image by installing latest version.
RUN yarn upgrade

# Setup nodejs group & nodejs user
RUN addgroup --system nodejs --gid 998 && \
    adduser --system nodejs --uid 999 --home /app/ && \
    chown -R 999:998 /app/

USER 999

WORKDIR /app

COPY --chown=999:998 . /app

RUN yarn install --frozen-lockfile --production --ignore-optional --ignore-scripts

HEALTHCHECK --interval=5m --timeout=3s \
 CMD curl --fail http://localhost:8080 || exit 1

CMD yarn start

