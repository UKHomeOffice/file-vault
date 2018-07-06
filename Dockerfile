FROM quay.io/ukhomeofficedigital/nodejs-base:v8

COPY package.json /app/package.json
RUN npm --loglevel warn install --production --no-optional
COPY . /app

USER nodejs

ENTRYPOINT ["node"]

CMD ["/app/index.js"]
