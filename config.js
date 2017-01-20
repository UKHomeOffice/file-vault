'use strict';

/* eslint no-process-env: 0 */
module.exports = {
  host: process.env.HOST || 'localhost',
  port: process.env.PORT || 3000,
  clamRest: {
    host: process.env.CLAMAV_REST_HOST,
    port: process.env.CLAMAV_REST_PORT,
  },
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'eu-west-1',
    signatureVersion: process.env.AWS_SIGNATURE_VERSION || 'v4',
    bucket: process.env.AWS_BUCKET,
    expiry: process.env.AWS_EXPIRY_TIME
  },
  fileDestination: process.env.STORAGE_FILE_DESTINATION || 'uploads'
};
