FROM quay.io/ukhomeofficedigital/nodejs-base:v6.11.1

COPY package.json /app/package.json
RUN npm --loglevel warn install --production --no-optional
COPY . /app

USER nodejs

ENTRYPOINT ["node"]

CMD ["/app/index.js"]
