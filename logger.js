/* eslint-disable no-process-env */
'use strict';

const loglevel = process.env.DEBUG ? 'debug' : 'info';
const levels = {
  error: 0,
  info: 1,
  debug: 2
};

function shouldLog(level) {
  return levels[level] <= levels[loglevel];
}

function write(level, args) {
  if (process.env.NODE_ENV === 'test' && !process.env.DEBUG) {
    return;
  }

  if (!shouldLog(level)) {
    return;
  }

  const method = level === 'error' ? 'error' : 'log';
  console[method](...args);
}

module.exports = {
  log(level, ...args) {
    write(level, args);
  },
  info(...args) {
    write('info', args);
  },
  debug(...args) {
    write('debug', args);
  },
  error(...args) {
    write('error', args);
  },
  stream: {
    write(message) {
      write('info', [message.trim()]);
    }
  }
};
