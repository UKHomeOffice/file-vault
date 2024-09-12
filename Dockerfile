FROM node:20-alpine@sha256:2d07db07a2df6830718ae2a47db6fedce6745f5bcd174c398f2acdda90a11c03

USER root

# Update packages as a result of Anchore security vulnerability checks
RUN apk update && \
    apk add --upgrade gnutls binutils nodejs apk-tools libjpeg-turbo libcurl libx11 libxml2  libcrypto3 libssl3

# Setup nodejs group & nodejs user
RUN addgroup --system nodejs --gid 998 && \
    adduser --system nodejs --uid 999 --home /app/ && \
    chown -R 999:998 /app/

USER 999

WORKDIR /app

COPY --chown=999:998 . /app

RUN yarn install --frozen-lockfile --production --ignore-optional

CMD node index.js

