'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const AWS = require('aws-sdk');
const request = require('request');
const moment = require('moment');
const fs = require('fs');
const onFinished = require('on-finished');
const config = require('config');

const upload = multer({
  dest: config.get('fileDestination')
});

AWS.config.update({
  accessKeyId: config.get('aws.accessKeyId'),
  secretAccessKey: config.get('aws.secretAccessKey'),
  region: config.get('aws.region'),
  signatureVersion: config.get('aws.signatureVersion')
});

const s3 = new AWS.S3();

function deleteFileOnFinishedRequest(req, res, next) {
  if (req.file) {
    onFinished(res, () => {
      fs.unlink(req.file.path);
    });
    next();
  } else {
    next({
      code: 'FileNotFound'
    });
  }
}

function clamAV(req, res, next) {
  let fileData = {
    name: req.file.originalname,
    file: fs.createReadStream(req.file.path)
  };

  request.post({
    url: config.get('clamRest.url'),
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
}

function s3Upload(req, res, next) {
  const params = {
    Bucket: config.get('aws.bucket'),
    Key: req.file.filename,
    Body: fs.createReadStream(req.file.path),
    ServerSideEncryption: 'aws:kms',
    Expires: moment().add(config.get('aws.expiry'), 'seconds').unix()
  };

  s3.putObject(params, (err) => {
    if (err) {
      err = {
        code: 'S3PUTFailed'
      };
    }
    next(err);
  });
}

router.post('/', upload.single('document'), deleteFileOnFinishedRequest, clamAV, s3Upload, (req, res) => {
  res.status(200).json({
    url: `${config.get('file-vault-url')}/file/${req.file.filename}`
  });
});

router.get('/:id', (req, res) => {
  s3.getObject({
    Bucket: config.get('aws.bucket'),
    Key: req.params.id
  }).createReadStream().on('error', (err) => {
    if (err.statusCode === 404) {
      res.status(404).end();
    }
  }).pipe(res);
});

module.exports = router;
