'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const AWS = require('aws-sdk');
const request = require('request');
const fs = require('fs');
const onFinished = require('on-finished');
const config = require('config');
const path = require('path');

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

function logError(req, err) {
  if (req.logger && req.logger.error) {
    req.logger.error(err);
  }
}

function checkExtension(req, res, next) {
  const fileTypes = config.get('fileTypes');

  if (fileTypes) {
    const uploadedFileExtension = path.extname(req.file.originalname).replace('.', '');
    const fileAllowed = fileTypes.split(',')
      .find((allowedExtension) => uploadedFileExtension === allowedExtension);
    if (fileAllowed) {
      next();
    } else {
      next({
        code: 'FileExtensionNotAllowed'
      });
    }
  } else {
    next();
  }
}

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
    formData: fileData,
    timeout: config.get('timeout') * 1000
  }, (err, httpResponse, body) => {
    if (err) {
      logError(req, err);
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
    Key: req.file.filename
  };

  s3.putObject(Object.assign({}, params, {
    Body: fs.createReadStream(req.file.path),
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: config.get('aws.kmsKeyId'),
    ContentType: req.file.mimetype
  }), (err) => {
    if (err) {
      logError(req, err);
      err = {
        code: 'S3PUTFailed'
      };
    } else {
      req.s3Path = s3.getSignedUrl('getObject', Object.assign({}, params, {
        Expires: config.get('aws.expiry')
      })).split('.com/').pop();
    }
    next(err);
  });
}

router.post('/', [
  upload.single('document'),
  checkExtension,
  deleteFileOnFinishedRequest,
  clamAV,
  s3Upload,
  (req, res) => {
    res.status(200).json({
      url: `${config.get('file-vault-url')}/file/${req.s3Path}`
    });
  }
]);

router.get('/:id', (req, res, next) => {
  request.get({
    url: `https://${config.get('aws.bucket')}.s3.${config.get('aws.region')}.amazonaws.com${req.url}`,
    encoding: null,
    timeout: config.get('timeout') * 1000
  }, (err, resp, buffer) => {
    if (err) {
      logError(req, err);
      return next(err);
    }
    res.writeHead(resp.statusCode, resp.headers);
    res.end(buffer);
  });
});

module.exports = router;
