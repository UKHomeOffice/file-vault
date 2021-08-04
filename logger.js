/* eslint-disable no-process-env */
'use strict';

const config = require('config');
const logger = require('hof/lib/logger');
const loglevel = process.env.DEBUG ? 'debug' : 'info';

module.exports = logger({
  env: config.util.getEnv('NODE_ENV'),
  loglevel
});
