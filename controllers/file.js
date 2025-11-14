/* eslint-disable */
'use strict';

const { GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { s3 } = require('../s3/s3Client');

const express = require('express');
const router = express.Router();
const multer = require('multer');
const request = require('request');
const fs = require('fs');
const onFinished = require('on-finished');
const config = require('config');
const path = require('path');
const { URL } = require('url');
const debug = require('debug')('file-vault');

const crypto = require('crypto');
const algorithm = 'aes-256-ctr';
const password = config.get('aws.password');
const IV_LENGTH = 16;
const ENCRYPTION_KEY = Buffer.concat([Buffer.from(password), Buffer.alloc(32)], 32);

const logger = require('../logger');
const { get } = require('lodash');

if (password === '') {
  throw new Error('please set the AWS_PASSWORD');
}

const upload = multer({
  dest: config.get('fileDestination')
});

function checkExtension(req, res, next) {
  const fileTypes = config.get('fileTypes');

  if (fileTypes) {
    const uploadedFileExtension = path.extname(req.file.originalname).replace('.', '').toLowerCase();
    const fileAllowed = fileTypes.split(',')
      .find((allowedExtension) => uploadedFileExtension === allowedExtension);
    if (fileAllowed) {

      debug('passed file extension check');
      next();
    } else {

      debug('failed file extension check');
      next({
        code: 'FileExtensionNotAllowed'
      });
    }
  } else {
    debug('passed file extension check');
    next();
  }
}

function deleteFileOnFinishedRequest(req, res, next) {
  if (req.file) {
    onFinished(res, () => {
      fs.unlink(req.file.path, err => {
        if (err) {
          console.log(err);
        }
      });
    });
    debug('deleted file on finish');
    next();
  } else {
    next({
      code: 'FileNotFound'
    });
  }
}

function clamAV(req, res, next) {
  debug('checking for virus');
  let fileData = {
    name: req.file.originalname,
    file: fs.createReadStream(req.file.path)
  };
  request.post({
    url: config.get('clamRest.url'),
    formData: fileData,
    timeout: parseInt(config.get('timeout')) * 1000,
    fileSize: parseInt(config.get('fileSize'))
  }, (err, httpResponse, body) => {
    if (err) {
      logger.log('error', err);
      err = {
        code: 'VirusScanFailed'
      };
    }
    else if (httpResponse && httpResponse.statusCode >= 400) {
      err = {
        code: 'VirusScanFailed'
      };
    }
    else if (body.indexOf('false') !== -1) {
      err = {
        code: 'VirusFound'
      };
    }

    debug('no virus found');
    next(err);
  });
}

function s3Upload(req, res, next) {
  debug('uploading to s3');

  const key = req.file.filename;

  const params = {
    Bucket: config.get('aws.bucket'),
    Key: key,
    Body: fs.createReadStream(req.file.path),
    SSEKMSKeyId: config.get('aws.kmsKeyId'),
    ContentType: req.file.mimetype,
    ContentLength: fs.statSync(req.file.path).size
  };

  const putObjectCommand = new PutObjectCommand(params);

  const getObjectCommand = new GetObjectCommand({
    Bucket: config.get('aws.bucket'),
    Key: key
  });

  s3.send(putObjectCommand)
    .then(() => {
      return getSignedUrl(s3, getObjectCommand, {
        expiresIn: config.get('aws.expiry') 
      });
    })
    .then((signedUrl) => {
      req.s3Url = signedUrl;
      next();
    })
    .catch((err) => {
      console.log("failed to upload to S3", err);
      logger.error('S3 upload failed', err);
      err = {
        code: 'S3PUTFailed',
      }
      next(err);
    });

    next();

  // s3.putObject(Object.assign({}, params, {
  //   Body: fs.createReadStream(req.file.path),
  //   ServerSideEncryption: 'aws:kms',
  //   SSEKMSKeyId: config.get('aws.kmsKeyId'),
  //   ContentType: req.file.mimetype
  // }), (err) => {
  //   if (err) {
  //     logger.log('error', err);
  //     err = {
  //       code: 'S3PUTFailed'
  //     };
  //   } else {
  //     req.s3Url = s3.getSignedUrl('getObject', Object.assign({}, params, {
  //       Expires: config.get('aws.expiry')
  //     }));
  //   }

  //   debug('uploaded file');
  //   next(err);
  // });
}
// Following this example
// https://stackoverflow.com/questions/60369148/how-do-i-replace-deprecated-crypto-createcipher-in-node-js
function encrypt(text) {
  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  let textParts = text.split(':');
  let iv = Buffer.from(textParts.shift(), 'hex');
  let encryptedText = Buffer.from(textParts.join(':'), 'hex');
  let decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

function decrypt_deprecated(text) {
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

    if (process.env.DEBUG) {
      logger.debug(s3Url.searchParams.get('X-Amz-Signature'));
      logger.debug(fileId);
    }

    debug('returning file-vault url');

    const responseData = {
      url: `${config.get('file-vault-url')}/file${s3Item}?date=${Date}&id=${fileId}`
    };

    if (config.get('returnOriginalSignedUrl') === 'yes') {
      responseData.originalSignedUrl = req.s3Url;
    }

    res.status(200).json(responseData);
  }
]);

router.get('/:id', (req, res, next) => {
  const reqId = req.query.id;
  const decyptedId = reqId.indexOf(':') > -1 ? decrypt(reqId) : decrypt_deprecated(reqId);

  let params = `?X-Amz-Algorithm=${config.get('aws.amzAlgorithm')}`;
  params += `&X-Amz-Credential=${config.get('aws.accessKeyId')}`;
  params += `%2F${req.query.date.split('T')[0]}`;
  params += `%2F${config.get('aws.region')}%2Fs3%2Faws4_request`;
  params += `&X-Amz-Date=${req.query.date}`;
  params += `&X-Amz-Expires=${config.get('aws.expiry')}`;
  params += `&X-Amz-Signature=${decyptedId}`;
  params += '&X-Amz-SignedHeaders=host';

  request.get({
    url: `https://${config.get('aws.bucket')}.s3.${config.get('aws.region')}.amazonaws.com/${req.params.id}${params}`,
    encoding: null,
    timeout: config.get('timeout') * 1000
  }, (err, resp, buffer) => {
    if (err) {
      logger.log('error', err);
      return next(err);
    }
    res.writeHead(resp.statusCode, resp.headers);
    res.end(buffer);
  });
});

if (config.allowGenerateLinkRoute === 'yes') {
  router.get('/generate-link/:id', (req, res, next) => {
    debug('generating presign url from s3');

    const url = getSignedUrl(s3, 'getObject', {
      Bucket: config.get('aws.bucket'),
      Key: req.params.id,
      expiresIn: config.get('aws.expiry')
    }).then((url) => {
      request.get({
        url,
        encoding: null,
        timeout: config.get('timeout') * 1000
      }, (err, resp, buffer) => {
        if (err) {
          logger.log('error', err);
          return next(err);
        }
        res.writeHead(resp.statusCode, resp.headers);
        res.end(buffer);
      }).catch((err) => {
        logger.log('error', err);
        return next(err);
      });
    });


    // s3.getSignedUrl('getObject', {
    //     Bucket: config.get('aws.bucket'),
    //     Key: req.params.id,
    //     Expires: config.get('aws.expiry')
    //   }, (err, url) => {
    //     request.get({
    //       url,
    //       encoding: null,
    //       timeout: config.get('timeout') * 1000
    //     }, (err, resp, buffer) => {
    //       if (err) {
    //         logger.log('error', err);
    //         return next(err);
    //       }
    //       res.writeHead(resp.statusCode, resp.headers);
    //       res.end(buffer);
    //     });
    //   });
  });
}

module.exports = router;
