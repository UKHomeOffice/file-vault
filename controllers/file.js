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
const {URL} = require('url');

const crypto = require('crypto');
const algorithm = 'aes-256-ctr';
const password = config.get('aws.password');

if (password === '') {
  throw new Error('please set the AWS_PASSWORD');
}

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
      req.s3Url = s3.getSignedUrl('getObject', Object.assign({}, params, {
        Expires: config.get('aws.expiry')
      }));
    }
    next(err);
  });
}

function encrypt(text) {
  const cipher = crypto.createCipher(algorithm, password);
  let crypted = cipher.update(text, 'utf8', 'hex');
  crypted += cipher.final('hex');
  return crypted;
}

function decrypt(text) {
  const decipher = crypto.createDecipher(algorithm, password);
  let dec = decipher.update(text, 'hex', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}

router.post('/', [
  upload.single('document'),
  checkExtension,
  deleteFileOnFinishedRequest,
  clamAV,
  s3Upload,
  (req, res) => {
    const s3Url = new URL(req.s3Url);
    const s3Item = s3Url.pathname;
    const Date = s3Url.searchParams.get('X-Amz-Date');
    const fileId = encrypt(s3Url.searchParams.get('X-Amz-Signature'));

    res.status(200).json({
      url: `${config.get('file-vault-url')}/file${s3Item}?date=${Date}&id=${fileId}`
    });
  }
]);

router.get('/:id', (req, res, next) => {
  let params = `?X-Amz-Algorithm=${config.get('aws.amzAlgorithm')}`;
  params += `&X-Amz-Credential=${config.get('aws.secretAccessKey')}`;
  params += `%2F${req.query.date.split('T')[0]}`;
  params += `%2F${config.get('aws.region')}%2Fs3%2Faws4_request`;
  params += `&X-Amz-Date=${req.query.date}`;
  params += `&X-Amz-Expires=${config.get('aws.expiry')}`;
  params += `&X-Amz-Signature=${decrypt(req.query.id)}`;
  params += '&X-Amz-SignedHeaders=host';

  request.get({
    url: `https://${config.get('aws.bucket')}.s3.${config.get('aws.region')}.amazonaws.com/${req.params.id}${params}`,
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
