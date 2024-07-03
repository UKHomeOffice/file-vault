FROM node:20-alpine3.20@sha256:df01469346db2bf1cfc1f7261aeab86b2960efa840fe2bd46d83ff339f463665


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

