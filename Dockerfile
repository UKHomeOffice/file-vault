FROM quay.io/ukhomeofficedigital/hof-nodejs:20.19.0-alpine3.21@sha256:aad584fa26cb2838739527166c8965d95d0d2d9b88cfd5e3e2d3b8647ae03101

USER root

# Update packages as a result of Anchore security vulnerability checks
RUN apk update && \
    apk add --upgrade gnutls binutils nodejs nodejs-npm apk-tools libjpeg-turbo libcurl libx11 libxml2

# Setup nodejs group & nodejs user
RUN addgroup --system nodejs --gid 998 && \
    adduser --system nodejs --uid 999 --home /app/ && \
    chown -R 999:998 /app/

USER 999

WORKDIR /app

COPY --chown=999:998 . /app

RUN yarn install --frozen-lockfile --production --ignore-optional

CMD node index.js

