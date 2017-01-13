'use strict';

const express = require('express');
const router = express.Router();
const multer  = require('multer');
const AWS = require('aws-sdk');
const request = require('request');
const moment = require('moment');
const fs = require('fs');

const upload = multer({ dest: 'uploads/' });
const config = require('../config');

AWS.config.update({
  accessKeyId: config.aws.accessKeyId,
  secretAccessKey: config.aws.secretAccessKey,
  region: config.aws.region,
  signatureVersion: config.aws.signatureVersion
});

const s3 = new AWS.S3();

router.post('/', upload.single('document'), clamAV, s3Upload, deleteUpload, (req, res, next) => {
  res.status(200).json({
    url: `http://${config.host}/file/${req.file.filename}`
  });
});

function clamAV (req, res, next) {
  if (req.file) {
    let fileData = {
      name: req.file.originalname,
      file: fs.createReadStream(req.file.path)
    };

    request.post({
      url: `http://${config.clamRest.host}:${config.clamRest.port}/scan`,
      formData: fileData
    }, (err, httpResponse, body) => {

      if (err) {
        err = {
          code: 'VirusScanFailed'
        };
      } else if (body.indexOf('false') !== -1) {
        err = {
          code: 'VirusFound'
        };
      }

      next(err);
    });
  } else {
    next({
      code: 'FileNotFound'
    });
  }
};

function s3Upload (req, res, next) {
  const params = {
    Bucket: config.aws.bucket,
    Key: req.file.filename,
    Body: fs.createReadStream(req.file.path),
    ServerSideEncryption: 'aws:kms',
    Expires: moment().add(config.aws.expiry, 'seconds').unix()
  };

  s3.putObject(params, (err, data) => {
    if (err) {
      err = {
        code: 'S3PUTFailed'
      };
    }
    next(err);
  });
};

function deleteUpload (req, res, next) {
  fs.unlink(req.file.path, next);
}

router.get('/:id', (req, res) => {
  s3.getObject({
    Bucket: config.aws.bucket,
    Key: req.params.id
  }).createReadStream().on('error', (err) => {
    if (err.statusCode === 404) {
      res.status(404).end();
    }
  }).pipe(res);
});

module.exports = router