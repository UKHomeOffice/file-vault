'use strict';

/* eslint no-process-env: 0 */

const supertest = require('supertest');
const nock = require('nock');
const assert = require('assert');
const { URL } = require('url');

let warnSpy;
let emitWarningSpy;
let originalNoDeprecation;
let originalNodeEnv;
let originalDebug;

function parseFileVaultUrl(fileVaultUrl) {
  const parsedUrl = new URL(fileVaultUrl);
  return {
    objectId: parsedUrl.pathname.split('/').pop(),
    date: parsedUrl.searchParams.get('date'),
    id: parsedUrl.searchParams.get('id')
  };
}

async function uploadDocumentWithSignedUrl() {
  process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "returnOriginalSignedUrl": "yes"}';

  nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
  nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

  const uploadResponse = await supertest(require('../app').app)
    .post('/file')
    .attach('document', 'test/fixtures/cat.gif')
    .expect(200);

  return {
    uploadResponse,
    fileVaultUrl: parseFileVaultUrl(uploadResponse.body.url),
    originalSignedUrl: new URL(uploadResponse.body.originalSignedUrl)
  };
}

describe('/file', () => {
  beforeEach(() => {
    jest.resetModules();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    emitWarningSpy = jest.spyOn(process, 'emitWarning').mockImplementation(() => {});
    originalNoDeprecation = process.noDeprecation;
    originalNodeEnv = process.env.NODE_ENV;
    originalDebug = process.env.DEBUG;
    process.noDeprecation = true;
    process.env.NODE_ENV = 'test';
    delete process.env.DEBUG;
    delete process.env.AWS_PASSWORD;
    delete process.env.FILE_EXTENSION_WHITELIST;
    process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": ""}';
  });

  afterEach(() => {
    nock.abortPendingRequests();
    nock.cleanAll();
    jest.dontMock('axios');
    jest.unmock('axios');
    jest.dontMock('@aws-sdk/s3-request-presigner');
    jest.unmock('@aws-sdk/s3-request-presigner');
    warnSpy.mockRestore();
    emitWarningSpy.mockRestore();
    process.noDeprecation = originalNoDeprecation;
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
  });

  describe('app wiring', () => {
    it('starts the app on the configured port', () => {
      const appModule = require('../app');
      const listenSpy = jest.spyOn(appModule.app, 'listen').mockImplementation((port, callback) => {
        callback();
        return {};
      });

      appModule.start();

      expect(listenSpy).toHaveBeenCalledWith(3000, expect.any(Function));
      listenSpy.mockRestore();
    });

    it('skips healthz logging when the route succeeds', async () => {
      const appModule = require('../app');

      appModule.app.use((req, res, next) => {
        req.session = { id: 'healthz-session' };
        next();
      });

      appModule.app.get('/healthz', (req, res) => res.status(200).send('ok'));

      await supertest(appModule.app)
        .get('/healthz')
        .expect(200, 'ok');
    });
  });

  describe('logger', () => {
    it('logs info, debug, error and stream output when debug is enabled', () => {
      process.env.DEBUG = '1';
      process.env.NODE_ENV = 'development';

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const logger = require('../logger');

      logger.info('info-message');
      logger.debug('debug-message');
      logger.error('error-message');
      logger.stream.write('stream-message\n');

      expect(logSpy).toHaveBeenCalledWith('info-message');
      expect(logSpy).toHaveBeenCalledWith('debug-message');
      expect(logSpy).toHaveBeenCalledWith('stream-message');
      expect(errorSpy).toHaveBeenCalledWith('error-message');

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('suppresses debug output when debug is disabled', () => {
      process.env.NODE_ENV = 'development';

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const logger = require('../logger');

      logger.debug('debug-message');

      expect(logSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe('config', () => {
    it('returns an error if the default password isnt set', () => {
      process.env.NODE_CONFIG = '{"aws": {"password":""}, "fileTypes": ""}';

      expect(() => {
        jest.isolateModules(() => {
          require('../controllers/file');
        });
      }).toThrow('please set the AWS_PASSWORD');
    });
  });

  describe('POSTing', () => {

    describe('no data', () => {
      it('returns an error', async () => {
        await supertest(require('../app').app)
          .post('/file')
          .expect('Content-type', /json/)
          .expect(400, {
            code: 'FileNotFound'
          });
      });
    });

    describe('data', () => {

      it('returns an error when virus scanner unavailable', async () => {
        await supertest(require('../app').app)
          .post('/file')
          .attach('document', 'test/fixtures/cat.gif')
          .expect(400, {
            code: 'VirusScanFailed'
          });
      });

      describe('virus scanning', () => {

        it('returns an error when virus scanner finds a virus!', async () => {
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : false');

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'VirusFound'
            });
        });

        it('handles json virus scanner response payloads', async () => {
          // create a mock clamav rest server that returns json instead of a string
          nock('http://localhost:8080').post('/scan').once().reply(200, { result: 'Everything ok : true' });
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200);

          assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
        });

        it('passes configured fileSize to virus scanner request', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "fileSize": "98765"}';

          const axiosMock = jest.fn().mockResolvedValue({ data: 'Everything ok : true' });
          jest.doMock('axios', () => axiosMock);

          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200);

          expect(axiosMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'POST',
            url: 'http://localhost:8080/scan',
            fileSize: 98765
          }));
        });

        it('returns error when file exceeds fileSize in virus scanner request', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "fileSize": "100"}';

          const axiosMock = jest.fn().mockResolvedValue({ data: 'Everything ok : false' });
          jest.doMock('axios', () => axiosMock);

          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(400);

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400);

          expect(axiosMock).toHaveBeenCalledWith(expect.objectContaining({
            method: 'POST',
            url: 'http://localhost:8080/scan',
            fileSize: 100
          }));
        });

      });

      describe('putting the file into a bucket', () => {
        it('returns an error when it fails to put', async () => {
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(400);

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'S3PUTFailed'
            });
        });

        it('returns an error when file extension is not in white-list', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "jpg,jpeg,pdf,svg,txt,doc"}';

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'FileExtensionNotAllowed'
            });
        });

        it('returns when uppercase file extension is used', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "jpg,jpeg,pdf,svg,txt,doc,pdf"}';
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/upper_case_document.PDF')
            .expect(200);

          assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
        });

        it('returns when mixedcase file extension is used', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "jpg,jpeg,pdf,svg,txt,doc,pdf"}';
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/mixed_case_document.pDf')
            .expect(200);

          assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
        });

        it('returns a short url when it successfully puts', async () => {
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200);

          assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
        });

        it('returns the original signed url when configured', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "returnOriginalSignedUrl": "yes"}';

          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200);

          assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
          assert.ok(res.body.originalSignedUrl.indexOf('https://testbucket.s3.eu-west-1.amazonaws.com/') !== -1);
          assert.ok(res.body.originalSignedUrl.indexOf('X-Amz-Signature=') !== -1);
        });

      });

      describe('GETing a resource', () => {
        it('makes a AWS signedUrl', async () => {
          const { fileVaultUrl, originalSignedUrl } = await uploadDocumentWithSignedUrl();

          nock('https://testbucket.s3.eu-west-1.amazonaws.com')
            .get(`/${fileVaultUrl.objectId}`)
            .query(actualQuery => actualQuery['X-Amz-Algorithm'] === originalSignedUrl.searchParams.get('X-Amz-Algorithm')
              && actualQuery['X-Amz-Credential'] === originalSignedUrl.searchParams.get('X-Amz-Credential')
              && actualQuery['X-Amz-Date'] === originalSignedUrl.searchParams.get('X-Amz-Date')
              && actualQuery['X-Amz-Expires'] === originalSignedUrl.searchParams.get('X-Amz-Expires')
              && actualQuery['X-Amz-Signature'] === originalSignedUrl.searchParams.get('X-Amz-Signature')
              && actualQuery['X-Amz-SignedHeaders'] === originalSignedUrl.searchParams.get('X-Amz-SignedHeaders'))
            .reply(200);

          await supertest(require('../app').app)
            .get(`/file/${fileVaultUrl.objectId}?date=${fileVaultUrl.date}&id=${encodeURIComponent(fileVaultUrl.id)}`)
            .expect(200);
        });

        it('retrieves a resource using the modern encrypted id format', async () => {
          const { fileVaultUrl, originalSignedUrl } = await uploadDocumentWithSignedUrl();

          nock('https://testbucket.s3.eu-west-1.amazonaws.com')
            .get(`/${fileVaultUrl.objectId}`)
            .query(actualQuery => actualQuery['X-Amz-Algorithm'] === originalSignedUrl.searchParams.get('X-Amz-Algorithm')
              && actualQuery['X-Amz-Credential'] === originalSignedUrl.searchParams.get('X-Amz-Credential')
              && actualQuery['X-Amz-Date'] === originalSignedUrl.searchParams.get('X-Amz-Date')
              && actualQuery['X-Amz-Expires'] === originalSignedUrl.searchParams.get('X-Amz-Expires')
              && actualQuery['X-Amz-Signature'] === originalSignedUrl.searchParams.get('X-Amz-Signature')
              && actualQuery['X-Amz-SignedHeaders'] === originalSignedUrl.searchParams.get('X-Amz-SignedHeaders'))
            .reply(200, 'file-body');

          const response = await supertest(require('../app').app)
            .get(`/file/${fileVaultUrl.objectId}?date=${fileVaultUrl.date}&id=${encodeURIComponent(fileVaultUrl.id)}`)
            .expect(200);

          assert.strictEqual(response.text, 'file-body');
        });

        it('returns 500 when the downstream file request fails', async () => {
          const { fileVaultUrl } = await uploadDocumentWithSignedUrl();

          nock('https://testbucket.s3.eu-west-1.amazonaws.com')
            .get(`/${fileVaultUrl.objectId}`)
            .query(true)
            .reply(500, 'failure');

          await supertest(require('../app').app)
            .get(`/file/${fileVaultUrl.objectId}?date=${fileVaultUrl.date}&id=${encodeURIComponent(fileVaultUrl.id)}`)
            .expect(500);
        });

        it('returns 400 when GET request is missing encrypted id query parameter', async () => {
          const { fileVaultUrl } = await uploadDocumentWithSignedUrl();

          await supertest(require('../app').app)
            .get(`/file/${fileVaultUrl.objectId}?date=${fileVaultUrl.date}`)
            .expect(400, {
              code: 'FileGetInvalidRequest'
            });
        });

      });

      describe('generate-link route', () => {
        it('returns the object when generate-link is enabled', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "allowGenerateLinkRoute": "yes"}';

          nock('https://testbucket.s3.eu-west-1.amazonaws.com')
            .get('/test-document')
            .query(true)
            .reply(200, 'generated-link-body');

          const response = await supertest(require('../app').app)
            .get('/file/generate-link/test-document')
            .expect(200);

          assert.strictEqual(response.text, 'generated-link-body');
        });

        it('returns 500 when generate-link retrieval fails', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "allowGenerateLinkRoute": "yes"}';

          nock('https://testbucket.s3.eu-west-1.amazonaws.com')
            .get('/test-document')
            .query(true)
            .reply(500, 'failure');

          await supertest(require('../app').app)
            .get('/file/generate-link/test-document')
            .expect(500);
        });

        it('returns 500 when presigning fails', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "allowGenerateLinkRoute": "yes"}';

          jest.doMock('@aws-sdk/s3-request-presigner', () => ({
            getSignedUrl: jest.fn().mockRejectedValue(new Error('presign failed'))
          }));

          const app = require('../app').app;

          await supertest(app)
            .get('/file/generate-link/test-document')
            .expect(500);
        });
      });

      describe('timeout fallback', () => {
        it('uses the default timeout when timeout config is invalid', async () => {
          const { fileVaultUrl } = await uploadDocumentWithSignedUrl();

          jest.resetModules();
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "timeout": "invalid"}';

          nock('https://testbucket.s3.eu-west-1.amazonaws.com')
            .get(`/${fileVaultUrl.objectId}`)
            .query(true)
            .reply(200, 'ok');

          await supertest(require('../app').app)
            .get(`/file/${fileVaultUrl.objectId}?date=${fileVaultUrl.date}&id=${encodeURIComponent(fileVaultUrl.id)}`)
            .expect(200);
        });

        it('uses the configured timeout when timeout config is valid', async () => {
          process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": "", "timeout": "20"}';

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'VirusScanFailed'
            });
        });
      });

    });

  });

});
