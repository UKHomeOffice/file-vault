'use strict';

const config = require('config');
const { S3Client } = require('@aws-sdk/client-s3');

const s3ClientConfig = {
  region: config.get('aws.region'),
  maxAttempts: 1,
  credentials: {
    accessKeyId: config.get('aws.accessKeyId'),
    secretAccessKey: config.get('aws.secretAccessKey')
  }
};

// Allow overriding S3 host for local/dev setups (for example local-s3/localstack).
if (config.has('aws.endpoint') && config.get('aws.endpoint')) {
  s3ClientConfig.endpoint = config.get('aws.endpoint');
  s3ClientConfig.forcePathStyle = true;
}

module.exports = new S3Client(s3ClientConfig);
