'use strict';

/* eslint no-process-env: 0 */

const supertest = require('supertest');
const nock = require('nock');
const assert = require('assert');

describe('/file', () => {

  beforeEach(() => {
    // delete the require cache
    delete require.cache[require.resolve('../app')];
    delete require.cache[require.resolve('config')];
    delete require.cache[require.resolve('../controllers/file')];

    process.env.NODE_CONFIG = '{"aws": {"password":"atest"}}';
    process.env.NODE_CONFIG = '{"fileTypes": ""}';
  });

  describe('config', () => {
    it('returns an error if the default password isnt set', () => {
      process.env.NODE_CONFIG = '{"aws": {"password":""}}';

      assert.throws(() => require('../controllers/file'), Error, 'please set the AWS_PASSWORD');
    });
  });

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
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(400);

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'S3PUTFailed'
            })
            .end(done);
        });

        it('returns an error when file extension is not in white-list', (done) => {
          process.env.NODE_CONFIG = '{"fileTypes": "jpg,jpeg,pdf,svg,txt,doc"}';

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code: 'FileExtensionNotAllowed'
            })
            .end(done);
        });

        it('returns a short url when it successfully puts', (done) => {
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200)
            .end((err, res) => {
              if (err) {
                throw err;
              }
              assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
              done();
            });
        });

      });

      describe('GETing a resource', () => {
        it('makes a AWS signedUrl', (done) => {
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
              'X-Amz-Credential': 'test_secret_key/20181129/eu-west-1/s3/aws4_request',
              'X-Amz-Date': '20181129T224820Z',
              'X-Amz-Expires': '3600',
              'X-Amz-Signature': 'fb16cae894e9b2e9af74e36cf5cf456ce130f0026b6485b113ee335322de0712',
              'X-Amz-SignedHeaders': 'host'
            })
            .reply(200);

          supertest(require('../app').app)
            .get(`${fileVaultUrl}?${dateParam}&${idParam}`)
            .expect(200)
            .end(done);
        });
      });

    });

  });

});
