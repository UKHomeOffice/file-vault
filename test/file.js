'use strict';

/* eslint no-process-env: 0 */

const supertest = require('supertest');
const nock = require('nock');
const assert = require('assert');

describe('/file', () => {

  describe('POSTing', () => {

    describe('no data', () => {
      it('returns an error', (done) => {
        supertest(require('../app').app)
          .post('/file')
          .expect('Content-type', /json/)
          .expect(400, {
            code: 'FileNotFound'
          })
          .end(done);
      });
    });

    describe('data', () => {

      it('returns an error when virus scanner unavailable', (done) => {
        supertest(require('../app').app)
          .post('/file')
          .attach('document', 'test/fixtures/cat.gif')
          .expect(400, {
            code: 'VirusScanFailed'
          })
          .end(done);
      });

      describe('virus scanning', () => {

        it('returns an error when virus scanner finds a virus!', (done) => {
          // delete the require cache
          delete require.cache[require.resolve('../app')];
          delete require.cache[require.resolve('config')];
          delete require.cache[require.resolve('../controllers/file')];

          // set some env vars for the clamav server
          process.env.CLAMAV_REST_URL = 'http://localhost:8080/scan';

          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : false');

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'VirusFound'
            })
            .end(done);
        });

      });

      describe('putting the file into a bucket', () => {
        it('returns an error when it fails to put', (done) => {
          // delete the require cache
          delete require.cache[require.resolve('../app')];
          delete require.cache[require.resolve('config')];
          delete require.cache[require.resolve('../controllers/file')];

          // set some env vars for the clamav server
          process.env.CLAMAV_REST_URL = 'http://localhost:8080/scan';
          process.env.AWS_BUCKET = 'testbucket';
          process.env.AWS_ACCESS_KEY_ID = 'test_key_id';
          process.env.AWS_SECRET_ACCESS_KEY = 'test_secret_key';
          process.env.AWS_KMS_KEY_ID = 'test_kms_key';
          process.env.AWS_REGION = 'eu-west-1';
          process.env.AWS_SIGNATURE_VERSION = 'v4';

          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.amazonaws.com').put(/.*/).reply(400);

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'S3PUTFailed'
            })
            .end(done);
        });

        it('returns an error when file extension is not in white-list', (done) => {
          // delete the require cache
          delete require.cache[require.resolve('../app')];
          delete require.cache[require.resolve('config')];
          delete require.cache[require.resolve('../controllers/file')];

          process.env.FILE_EXTENSION_WHITELIST = 'jpg,jpeg,pdf,svg,txt,doc';

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'FileExtensionNotAllowed'
            })
            .end(done);
        });

        it('returns a short url when it successfully puts', (done) => {
          // delete the require cache
          delete require.cache[require.resolve('../app')];
          delete require.cache[require.resolve('config')];
          delete require.cache[require.resolve('../controllers/file')];

          // set some env vars for the clamav server
          process.env.CLAMAV_REST_URL = 'http://localhost:8080/scan';
          process.env.AWS_BUCKET = 'testbucket';
          process.env.AWS_ACCESS_KEY_ID = 'test_key_id';
          process.env.AWS_SECRET_ACCESS_KEY = 'test_secret_key';
          process.env.AWS_KMS_KEY_ID = 'test_kms_key';
          process.env.AWS_REGION = 'eu-west-1';
          process.env.AWS_SIGNATURE_VERSION = 'v4';
          process.env.FILE_VAULT_URL = 'https://myfile-vault-url';
          process.env.FILE_EXTENSION_WHITELIST = 'gif';

          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.amazonaws.com').put(/.*/).reply(200);

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200)
            .end((err, res) => {
              if (err) {
                throw err;
              }
              assert.ok(res.body.url.indexOf('https://myfile-vault-url/file/') !== -1);
              done();
            });
        });
      });

    });

  });

});
