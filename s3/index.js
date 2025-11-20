/* eslint-disable */
'use strict';

const { S3Client } = require('@aws-sdk/client-s3');
const config = require('config');

// Export a single S3 client instance configured from `config`.
const s3 = new S3Client({
  region: config.get('aws.region'),
  credentials: {
    accessKeyId: config.get('aws.accessKeyId'),
    secretAccessKey: config.get('aws.secretAccessKey')
  }
});

module.exports = s3;
