/* eslint-disable no-process-env */
'use strict';

const express = require('express');
const morgan = require('morgan');
const _ = require('lodash');
const app = express();
const config = require('config');
const logger = require('./logger');
const fs = require('fs');
const http = require('http');
const https = require('https');

morgan.token('id', req => _.get(req, 'session.id', 'filevault'));

app.use(morgan('sessionId=:id ' + morgan.combined, {
  stream: logger.stream,
  skip: (req, res) => !process.env.DEBUG &&
    (
      res.statusCode >= 300 || !_.get(req, 'session.id') ||
      ['/healthz'].some(v => req.originalUrl.includes(v))
    )
}));

app.use('/file', require('./controllers/file'));

/* eslint-disable no-unused-vars */
app.use((err, req, res, next) => {
/* eslint-enable no-unused-vars */
  if (err.code) {
    res.status(400);
  } else {
    res.status(500);
  }
  res.json(err);
});

module.exports.start = () => {
  const httpServer = http.createServer(app);

  httpServer.listen(config.get('port'));

  if (config.get('https_port')) {
  const privateKey = fs.readFileSync('/certs/tls.key', 'utf8');
  const certificate = fs.readFileSync('/certs/tls.crt', 'utf8');
  const credentials = { key: privateKey, cert: certificate };

  const httpsServer = https.createServer(credentials, app);
  httpsServer.listen(config.get('https_port'), () => {
    logger.info(`Server started on port ${config.get('https_port')}`);
  });
}
  // app.listen(config.get('port'), () => {
  //   logger.info(`Server started on port ${config.get('port')}`);
  // });
};

module.exports.app = app;
