'use strict';

/* eslint no-process-env: 0 */

describe('clients/s3', () => {
  const originalNodeConfig = process.env.NODE_CONFIG;

  afterEach(() => {
    jest.resetModules();
    jest.unmock('@aws-sdk/client-s3');

    if (originalNodeConfig === undefined) {
      delete process.env.NODE_CONFIG;
    } else {
      process.env.NODE_CONFIG = originalNodeConfig;
    }
  });

  it('creates an S3 client with region, credentials and one retry attempt', () => {
    const s3ClientInstance = { client: 's3' };
    const S3Client = jest.fn(() => s3ClientInstance);

    process.env.NODE_CONFIG = JSON.stringify({
      aws: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'eu-west-1',
        endpoint: ''
      }
    });

    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client }));

    const client = require('../../clients/s3');

    expect(client).toBe(s3ClientInstance);
    expect(S3Client).toHaveBeenCalledWith({
      region: 'eu-west-1',
      maxAttempts: 1,
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret'
      }
    });
  });

  it('adds endpoint and forcePathStyle when aws.endpoint is configured', () => {
    const s3ClientInstance = { client: 's3-with-endpoint' };
    const S3Client = jest.fn(() => s3ClientInstance);

    process.env.NODE_CONFIG = JSON.stringify({
      aws: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
        region: 'eu-west-2',
        endpoint: 'http://local-s3:80'
      }
    });

    jest.doMock('@aws-sdk/client-s3', () => ({ S3Client }));

    const client = require('../../clients/s3');

    expect(client).toBe(s3ClientInstance);
    expect(S3Client).toHaveBeenCalledWith({
      region: 'eu-west-2',
      maxAttempts: 1,
      credentials: {
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret'
      },
      endpoint: 'http://local-s3:80',
      forcePathStyle: true
    });
  });
});
