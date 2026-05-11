/* eslint-disable */
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const axios = require('axios');
const fs = require('fs');
const onFinished = require('on-finished');
const config = require('config');
const path = require('path');
const { URL } = require('url');
const debug = require('debug')('file-vault');
const FormData = require('form-data');
const crypto = require('crypto');
const algorithm = 'aes-256-ctr';
const password = config.get('aws.password');
const IV_LENGTH = 16;
const ENCRYPTION_KEY = Buffer.concat([Buffer.from(password), Buffer.alloc(32)], 32);

const logger = require('../logger');
const s3 = require('../clients/s3');

/**
 * Resolves the configured request timeout in milliseconds.
 * Falls back to 15 seconds when config is missing or invalid.
 *
 * @returns {number} Timeout in milliseconds.
 */
function getTimeoutMs() {
  const timeoutSeconds = Number(config.get('timeout'));
  if (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0) {
    return timeoutSeconds * 1000;
  }

  return 15000;
}

if (password === '') {
  throw new Error('please set the AWS_PASSWORD');
}

const upload = multer({
  dest: config.get('fileDestination')
});

/**
 * Validates an uploaded file extension against the configured whitelist.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next function.
 * @returns {void}
 */
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

/**
 * Schedules deletion of the temporary uploaded file once the response finishes.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next function.
 * @returns {void}
 */
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

/**
 * Sends the uploaded file to ClamAV REST for virus scanning.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next function.
 * @returns {Promise<void>}
 */
async function clamAV(req, res, next) {
  debug('checking for virus');
  let fileData = {
    name: req.file.originalname,
    file: fs.createReadStream(req.file.path)
  };

  const formData = new FormData();
  formData.append('file', fileData.file, fileData.name);
  try {
    const params = {
      method: 'POST',
      url: config.get('clamRest.url'),
      data: formData,
      timeout: getTimeoutMs(),
      fileSize: parseInt(config.get('fileSize')),
      headers: { ...formData.getHeaders() }
    };
    const response = await axios(params);
    const resBody = response.data;
    const responseText = typeof resBody === 'string' ? resBody : JSON.stringify(resBody);
    if (responseText.indexOf('false') !== -1) {
      let err = {
        code: 'VirusFound'
      };
      return next(err);
    }
    debug('no virus found');
    return next();
  }
  catch (err) {
    logger.log('error', err);
    err = {
      code: 'VirusScanFailed'
    };
    return next(err);
  }
}

/**
 * Uploads the scanned file to S3 and stores a presigned URL on the request.
 *
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next function.
 * @returns {Promise<void>}
 */
async function s3Upload(req, res, next) {
  debug('uploading to s3');
  const params = {
    Bucket: config.get('aws.bucket'),
    Key: req.file.filename
  };

  try {
    await s3.send(new PutObjectCommand(Object.assign({}, params, {
      Body: fs.createReadStream(req.file.path),
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: config.get('aws.kmsKeyId'),
      ContentType: req.file.mimetype
    })));

    req.s3Url = await getSignedUrl(s3, new GetObjectCommand(Object.assign({}, params)), {
      expiresIn: parseInt(config.get('aws.expiry'))
    });
    debug('uploaded file');
    next();
  }
  catch (err) {
    logger.log('error', err);
    debug('uploaded file');
    next({
      code: 'S3PUTFailed'
    });
  }
}

/**
 * Encrypts a signature string into the file-vault id format: hex(iv):hex(ciphertext).
 *
 * @param {string} text Plaintext signature.
 * @returns {string} Encrypted value in file-vault id format.
 */
function encrypt(text) {
  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypts a file-vault id value in format hex(iv):hex(ciphertext).
 *
 * @param {string} text Encrypted file-vault id.
 * @returns {string} Decrypted plaintext signature.
 */
function decrypt(text) {
  let textParts = text.split(':');
  let iv = Buffer.from(textParts.shift(), 'hex');
  let encryptedText = Buffer.from(textParts.join(':'), 'hex');
  let decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

/**
 * Performs a binary GET request and writes the upstream response through.
 *
 * @param {string} url Target URL.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next function.
 * @returns {Promise<void>}
 */
async function getRequest(url, res, next) {
  try {
    const reqConf = {
      method: 'GET',
      url: url,
      responseType: 'arraybuffer',
      timeout: getTimeoutMs()
    };
    const response = await axios(reqConf);
    res.writeHead(response.status, response.headers);
    res.end(response.data);
  }
  catch (err) {
    logger.log('error', err);
    return next(new Error('FileGetFailed'));
  }
}

router.post('/', [
  upload.single('document'),
  checkExtension,
  deleteFileOnFinishedRequest,
  clamAV,
  s3Upload,
  (req, res) => {
    const s3Url = new URL(req.s3Url);
    const s3Item = `/${req.file.filename}`;
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

router.get('/:id', async (req, res, next) => {
  const reqId = req.query.id;
  const requestDate = req.query.date;

  if (!reqId || !requestDate || typeof reqId !== 'string' || typeof requestDate !== 'string') {
    return next({
      code: 'FileGetInvalidRequest'
    });
  }

  let decryptedId;
  let requestDay;
  try {
    decryptedId = decrypt(reqId);
    requestDay = requestDate.split('T')[0];
  }
  catch (err) {
    logger.log('error', err);
    return next({
      code: 'FileGetInvalidRequest'
    });
  }

  let params = `?X-Amz-Algorithm=${config.get('aws.amzAlgorithm')}`;
  params += `&X-Amz-Credential=${config.get('aws.accessKeyId')}`;
  params += `%2F${requestDay}`;
  params += `%2F${config.get('aws.region')}%2Fs3%2Faws4_request`;
  params += `&X-Amz-Date=${requestDate}`;
  params += `&X-Amz-Expires=${parseInt(config.get('aws.expiry'))}`;
  params += `&X-Amz-Signature=${decryptedId}`;
  params += '&X-Amz-SignedHeaders=host';

  let objectUrl;
  if (config.has('aws.endpoint') && config.get('aws.endpoint')) {
    objectUrl = `${config.get('aws.endpoint').replace(/\/$/, '')}/${config.get('aws.bucket')}/${req.params.id}`;
  } else {
    objectUrl = `https://${config.get('aws.bucket')}.s3.${config.get('aws.region')}.amazonaws.com/${req.params.id}`;
  }

  logger.log('info', 'getting file-vault url');
  await getRequest(`${objectUrl}${params}`, res, next);
})

if (config.allowGenerateLinkRoute === 'yes') {
  router.get('/generate-link/:id', async (req, res, next) => {
    debug('generating presign url from s3');

    try {
      const url = await getSignedUrl(s3, new GetObjectCommand({
        Bucket: config.get('aws.bucket'),
        Key: req.params.id
      }), {
        expiresIn: parseInt(config.get('aws.expiry'))
      });
      logger.log('info', 'getting generated file-vault url');
      await getRequest(url, res, next);
    }
    catch (err) {
      logger.log('error', err);
      next(err);
    }
  });
}

module.exports = router;
