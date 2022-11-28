/* eslint-disable no-process-env */
'use strict';

const express = require('express');
const morgan = require('morgan');
const _ = require('lodash');
const app = express();
const config = require('config');
const logger = require('./logger');

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
  app.listen(config.get('port'), () => {
    logger.info('Debug Test');
    logger.info(`Server started on port ${config.get('port')}`);
  });
};

module.exports.app = app;
