'use strict';

const supertest = require('supertest');
const should = require('should');
const nock = require('nock');

describe('/file',() => {

  describe('POSTing', () => {

    describe('no data', () => {
      it('returns an error',(done) => {
        supertest(require('../app').app)
          .post('/file')
          .expect('Content-type', /json/)
          .expect(400, {
            code:'FileNotFound'
          }, done);
      });
    });

    describe('data', () => {

      it('returns an error when virus scanner unavailable',(done) => {
        supertest(require('../app').app)
          .post('/file')
          .attach('document', 'test/fixtures/cat.gif')
          .expect(400, {
            code:'VirusScanFailed'
          }, done);
      });

      describe('virus scanning', () => {

        it('returns an error when virus scanner finds a virus!',(done) => {
          // delete the require cache
          delete require.cache[require.resolve('../app')];
          delete require.cache[require.resolve('../config')];
          delete require.cache[require.resolve('../controllers/file')];

          // set some env vars for the clamav server
          process.env.CLAMAV_REST_HOST = 'localhost';
          process.env.CLAMAV_REST_PORT = 8080;

          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : false');

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(400, {
              code:'VirusFound'
            }, done);
        });

      });

      describe('putting the file into a bucket', () => {
        it('returns an error when it fails to put',(done) => {
          // delete the require cache
          delete require.cache[require.resolve('../app')];
          delete require.cache[require.resolve('../config')];
          delete require.cache[require.resolve('../controllers/file')];

          // set some env vars for the clamav server
          process.env.CLAMAV_REST_HOST = 'localhost';
          process.env.CLAMAV_REST_PORT = 8080;
          process.env.AWS_BUCKET = 'testbucket';
          process.env.AWS_ACCESS_KEY_ID = 'test';
          process.env.AWS_SECRET_ACCESS_KEY = 'test';
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
              code:'S3PUTFailed'
            }, done);
        });

        it('returns a short url when it successfully puts',(done) => {
          // delete the require cache
          delete require.cache[require.resolve('../app')];
          delete require.cache[require.resolve('../config')];
          delete require.cache[require.resolve('../controllers/file')];

          // set some env vars for the clamav server
          process.env.CLAMAV_REST_HOST = 'localhost';
          process.env.CLAMAV_REST_PORT = 8080;
          process.env.AWS_BUCKET = 'testbucket';
          process.env.AWS_ACCESS_KEY_ID = 'test';
          process.env.AWS_SECRET_ACCESS_KEY = 'test';
          process.env.AWS_REGION = 'eu-west-1';
          process.env.AWS_SIGNATURE_VERSION = 'v4';

          // create a mock clamav rest server
          nock('http://localhost:8080').post('/scan').once().reply(200, 'Everything ok : true');
          // create a mock aws response
          nock('https://testbucket.s3.amazonaws.com').put(/.*/).reply(200);

          supertest(require('../app').app)
            .post('/file')
            .attach('document', 'test/fixtures/cat.gif')
            .expect(200)
            .end((err, res) => {
              res.body.url.should.startWith('http://localhost/file/');
              done();
            });
        });
      });

    });

  });

});