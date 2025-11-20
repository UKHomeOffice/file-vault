'use strict';

/* eslint no-process-env: 0 */

const supertest = require('supertest');
const nock = require('nock');

describe('/file', () => {

  beforeEach(() => {
    // reset module registry so `config` picks up `NODE_CONFIG` overrides
    jest.resetModules();

    process.env.NODE_CONFIG = '{"aws": {"password":"atest"}, "fileTypes": ""}';
  });

  describe('config', () => {
    test('returns an error if the default password isnt set', () => {
      process.env.NODE_CONFIG = '{"aws": {"password":""}}';

      expect(() => require('../controllers/file')).toThrow(Error);
    });
  });

  describe('POSTing', () => {

    describe('no data', () => {
      test('returns an error', async () => {
        await supertest(require('../app').app)
          .post('/file')
          .expect('Content-type', /json/)
          .expect(400, {
            code: 'FileNotFound'
          });
      });
    });

    describe('data', () => {

      test('returns an error when virus scanner unavailable', async () => {
        await supertest(require('../app').app)
          .post('/file')
          .attach('document', 'test/fixtures/cat.gif')
          .expect(400, {
            code: 'VirusScanFailed'
          });
      });

      describe('virus scanning', () => {

        test('returns an error when virus scanner finds a virus!', async () => {
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : false');

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'VirusFound'
            });
        });

      });

      describe('putting the file into a bucket', () => {
        test('returns an error when it fails to put', async () => {
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

        test('returns an error when file extension is not in white-list', async () => {
          process.env.NODE_CONFIG = '{"fileTypes": "jpg,jpeg,pdf,svg,txt,doc"}';

          await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'FileExtensionNotAllowed'
            });
        });

        test('returns when uppercase file extension is used', async () => {
          process.env.NODE_CONFIG = '{"fileTypes": "jpg,jpeg,pdf,svg,txt,doc,pdf"}';
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);
          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/upper_case_document.PDF')
            .expect(200);
          expect(res.body.url.indexOf('http://localhost/file/')).not.toBe(-1);
        });

        test('returns when mixedcase file extension is used', async () => {
          process.env.NODE_CONFIG = '{"fileTypes": "jpg,jpeg,pdf,svg,txt,doc,pdf"}';
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);
          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/mixed_case_document.pDf')
            .expect(200);
          expect(res.body.url.indexOf('http://localhost/file/')).not.toBe(-1);
        });

        test('returns a short url when it successfully puts', async () => {
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          const res = await supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200);
          expect(res.body.url.indexOf('http://localhost/file/')).not.toBe(-1);
        });

      });

      describe('GETing a resource', () => {
        test('makes a AWS signedUrl', async () => {
          const fileVaultUrl = '/file/821898ae17bead075c0b6480734c56c9';
          const dateParam = 'date=20181129T224820Z';
          /* eslint-disable max-len */
          const idParam = 'id=70078d4568a7cd716b36a2b89feb13c8adaab9a0751253115046fc7cc0708bcf2102d6f670cc56646c69a4a6338fb2e79dae049b74873adecbf96e1f563debb1';
          /* eslint-enable max-len */

          // assert the correct bucket item gets called
          nock('https://testbucket.s3.eu-west-1.amazonaws.com')
            .get('/821898ae17bead075c0b6480734c56c9')
            .query({
              'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
              'X-Amz-Credential': 'test_key_id/20181129/eu-west-1/s3/aws4_request',
              'X-Amz-Date': '20181129T224820Z',
              'X-Amz-Expires': '3600',
              'X-Amz-Signature': 'fb16cae894e9b2e9af74e36cf5cf456ce130f0026b6485b113ee335322de0712',
              'X-Amz-SignedHeaders': 'host'
            })
            .reply(200);

          await supertest(require('../app').app)
            .get(`${fileVaultUrl}?${dateParam}&${idParam}`)
            .expect(200);
        });
      });

    });

  });

});
