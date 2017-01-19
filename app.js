'use strict';

const express = require('express');
const churchill = require('churchill');
const logger = require('hof-logger')();
const app = express();

app.use(churchill(logger));

const config = require('./config');

app.use('/file', require('./controllers/file'));

app.use((err, req, res, next) => {
  if (err.code) {
    res.status(400);
  } else {
    res.status(500);
  }
  res.json(err);
});


module.exports.start = () => {
  app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
  });
}

module.exports.app = app;
