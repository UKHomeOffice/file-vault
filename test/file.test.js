'use strict';

/* eslint no-process-env: 0 */
/* eslint-disable no-unused-vars */


const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { mockClient } = require('aws-sdk-client-mock');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const supertest = require('supertest');
const nock = require('nock');
require('aws-sdk-client-mock-jest');

const s3Mock = mockClient(S3Client);

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const { app } = require('../app');

describe('/file', () => {
  beforeEach(() => {
    jest.resetModules();

    // delete the require cache
    delete require.cache[require.resolve('../app')];
    delete require.cache[require.resolve('config')];
    delete require.cache[require.resolve('../controllers/file')];

    process.env.NODE_CONFIG = '{"aws": {"password":"atest", "region":"eu-west-1"}}';
    process.env.NODE_CONFIG = '{"fileTypes": ""}';

    s3Mock.reset();
    getSignedUrl.mockReset();
  });

  describe('config', () => {
    test('returns an error if the default password isnt set', () => {
      process.env.NODE_CONFIG = '{"aws": {"password":""}}';

      expect(() => {
        require('../controllers/file');
      }).toThrow('please set the AWS_PASSWORD');
    });
  });

  describe('POSTing', () => {

    describe('no data', () => {
      test('returns an error', (done) => {
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

      test('returns an error when virus scanner unavailable', (done) => {
        supertest(require('../app').app)
          .post('/file')
          .attach('document', 'test/fixtures/cat.gif')
          .expect(400, {
            code: 'VirusScanFailed'
          })
          .end(done);
      });

      describe('virus scanning', () => {

        test('returns an error when virus scanner finds a virus!', (done) => {
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
        // test('returns an error when test fails to put', (done) => {
        //   // create a mock clamav rest server
        //   nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');

        //   // create a mock aws response
        //   const error = {
        //     name: 'BadRequest',
        //     message: 'Invalid request',
        //     $metadata: { httpStatusCode: 400 },
        //   };

        //   s3Mock.on(PutObjectCommand).rejects(error);

        //   supertest(app)
        //     .post('/file')
        //     .attach('document', 'test/fixtures/cat.gif')
        //     .expect(400, {
        //       code: 'S3PUTFailed'
        //     })
        //     .end((err, res) => {
        //       if (err) {
        //         done(err);
        //       }

        //       try {
        //         expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
        //           Bucket: 'testbucket',
        //           SSEKMSKeyId: 'test_kms_key',
        //           ContentType: 'image/gif',
        //           Body: expect.anything(),
        //           Key: expect.any(String),
        //           ContentLength: expect.any(Number)
        //         });

        //         done();
        //       } catch (assertionError) {
        //         done(assertionError);
        //       }
        //     });
        // });

        // test('returns an error when file extension is not in whteste-list', (done) => {
        //   process.env.NODE_CONFIG = '{"fileTypes": "jpg,jpeg,pdf,svg,txt,doc"}';

        //   supertest(require('../app').app)
        //     .post('/file')
        //     .attach('document', 'test/fixtures/cat.gif')
        //     .expect(400, {
        //       code: 'FileExtensionNotAllowed'
        //     })
        //     .end(done);
        // });

        test('returns when uppercase file extension is used', (done) => {
          process.env.NODE_CONFIG = '{"fileTypes": "jpg,jpeg,pdf,svg,txt,doc,pdf"}';
          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');

          // Setup S3 Mocks
          s3Mock.on(PutObjectCommand).resolves();

          getSignedUrl.mockResolvedValue('http://localhost/file/');

          supertest(app)
            .post('/file')
            .attach('document', 'test/fixtures/upper_case_document.PDF')
            .expect(200)
            .end((err, res) => {
              if (err) {
                console.log(err);
                return done(err);
              }

              // expect(res.body.url).toBeDefined();
              // expect(res.body.url).toContain('http://localhost/file/');

              try {

                expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
                expect(getSignedUrl).toHaveBeenCalledTimes(1);

                expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
                  Bucket: 'testbucket',
                  SSEKMSKeyId: 'test_kms_key',
                  ContentType: 'application/pdf',
                  Body: expect.anything(),
                  Key: expect.any(String),
                  ContentLength: expect.any(Number)
                });

                return done();
              } catch (assertionError) {
                return done(assertionError);
              }
            });

          // nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);
          // supertest(require('../app').app)
          //   .post('/file')
          //   .attach('document', 'test/fixtures/upper_case_document.PDF')
          //   .expect(200)
          //   .end((err, res) => {
          //     if (err) {
          //       throw err;
          //     }
          //     assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
          //     done();
          //   });
        });

        // test('returns when mixedcase file extension is used', (done) => {
        //   process.env.NODE_CONFIG = '{"fileTypes": "jpg,jpeg,pdf,svg,txt,doc,pdf"}';
        //   // create a mock clamav rest server
        //   nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
        //   // create a mock aws response
        //   nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);
        //   supertest(require('../app').app)
        //     .post('/file')
        //     .attach('document', 'test/fixtures/mixed_case_document.pDf')
        //     .expect(200)
        //     .end((err, res) => {
        //       if (err) {
        //         throw err;
        //       }
        //       assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
        //       done();
        //     });
        // });

        // test('returns a short url when test successfully puts', (done) => {
        //   // create a mock clamav rest server
        //   nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
        //   // create a mock aws response
        //   nock('https://testbucket.s3.eu-west-1.amazonaws.com').put(/.*/).reply(200);

        //   supertest(require('../app').app)
        //     .post('/file')
        //     .attach('document', 'test/fixtures/cat.gif')
        //     .expect(200)
        //     .end((err, res) => {
        //       if (err) {
        //         throw err;
        //       }
        //       assert.ok(res.body.url.indexOf('http://localhost/file/') !== -1);
        //       done();
        //     });
        // });

      });

      /* eslint-disable max-len */
      // describe('GETing a resource', () => {
      //   test('makes a AWS signedUrl', (done) => {
      //     const fileVaultUrl = '/file/821898ae17bead075c0b6480734c56c9';
      //     const dateParam = 'date=20181129T224820Z';
      //     /* eslint-disable max-len */
      //     const idParam = 'id=70078d4568a7cd716b36a2b89feb13c8adaab9a0751253115046fc7cc0708bcf2102d6f670cc56646c69a4a6338fb2e79dae049b74873adecbf96e1f563debb1';
      //     /* eslint-enable max-len */

      //     // assert the correct bucket testem gets called
      //     nock('https://testbucket.s3.eu-west-1.amazonaws.com')
      //       .get('/821898ae17bead075c0b6480734c56c9')
      //       .query({
      //         'X-Amz-Algortesthm': 'AWS4-HMAC-SHA256',
      //         'X-Amz-Credential': 'test_key_id/20181129/eu-west-1/s3/aws4_request',
      //         'X-Amz-Date': '20181129T224820Z',
      //         'X-Amz-Expires': '3600',
      //         'X-Amz-Signature': 'fb16cae894e9b2e9af74e36cf5cf456ce130f0026b6485b113ee335322de0712',
      //         'X-Amz-SignedHeaders': 'host'
      //       })
      //       .reply(200);

      //     supertest(require('../app').app)
      //       .get(`${fileVaultUrl}?${dateParam}&${idParam}`)
      //       .expect(200)
      //       .end(done);
      //   });
      // });

    });

  });

});
