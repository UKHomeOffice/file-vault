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
 * Parses decrypted file id payload, supporting both modern JSON payload and legacy signature-only format.
 *
 * @param {string} decryptedId Decrypted file-vault id content.
 * @returns {{signature: string, algorithm?: string, credential?: string, expires?: string, signedHeaders?: string, securityToken?: string}|null}
 */
function parseFileIdPayload(decryptedId) {
  try {
    const parsed = JSON.parse(decryptedId);
    if (parsed && typeof parsed === 'object' && typeof parsed.signature === 'string' && parsed.signature) {
      return {
        signature: parsed.signature,
        algorithm: typeof parsed.algorithm === 'string' ? parsed.algorithm : undefined,
        credential: typeof parsed.credential === 'string' ? parsed.credential : undefined,
        expires: typeof parsed.expires === 'string' ? parsed.expires : undefined,
        signedHeaders: typeof parsed.signedHeaders === 'string' ? parsed.signedHeaders : undefined,
        securityToken: typeof parsed.securityToken === 'string' ? parsed.securityToken : undefined
      };
    }
  }
  catch (err) {
    // Legacy file ids are plain signatures and are handled by fallback logic.
  }

  if (typeof decryptedId === 'string' && decryptedId.length > 0) {
    return {
      signature: decryptedId
    };
  }

  return null;
}

/**
 * Converts URLSearchParams to a plain object for deterministic debug logging.
 *
 * @param {URLSearchParams} params URL search params.
 * @returns {Record<string, string>} Plain object containing all entries.
 */
function searchParamsToObject(params) {
  const result = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

/**
 * Emits DEBUG-only diagnostics for reconstructed S3 signature inputs.
 *
 * @param {string} objectUrl S3 object URL without query.
 * @param {string} objectId Requested object key.
 * @param {string} requestDate Date query parameter supplied to file-vault.
 * @param {{signature: string, algorithm?: string, credential?: string, expires?: string, signedHeaders?: string, securityToken?: string}} fileIdPayload Decrypted payload.
 * @param {URLSearchParams} params Reconstructed URL params sent to S3.
 * @returns {void}
 */
function logSignatureDiagnostics(objectUrl, objectId, requestDate, fileIdPayload, params) {
  if (!process.env.DEBUG) {
    return;
  }

  logger.debug('file-vault signature diagnostics (GET /:id)');
  logger.debug({
    objectId,
    objectUrl,
    requestDate,
    payload: {
      hasAlgorithm: Boolean(fileIdPayload.algorithm),
      hasCredential: Boolean(fileIdPayload.credential),
      hasExpires: Boolean(fileIdPayload.expires),
      hasSignedHeaders: Boolean(fileIdPayload.signedHeaders),
      hasSecurityToken: Boolean(fileIdPayload.securityToken),
      signatureLength: typeof fileIdPayload.signature === 'string' ? fileIdPayload.signature.length : 0
    },
    reconstructedQuery: searchParamsToObject(params)
  });
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
    const requestDate = s3Url.searchParams.get('X-Amz-Date');
    const fileIdPayload = {
      signature: s3Url.searchParams.get('X-Amz-Signature'),
      algorithm: s3Url.searchParams.get('X-Amz-Algorithm'),
      credential: s3Url.searchParams.get('X-Amz-Credential'),
      expires: s3Url.searchParams.get('X-Amz-Expires'),
      signedHeaders: s3Url.searchParams.get('X-Amz-SignedHeaders'),
      securityToken: s3Url.searchParams.get('X-Amz-Security-Token')
    };
    const fileId = encrypt(JSON.stringify(fileIdPayload));

    if (process.env.DEBUG) {
      logger.debug(s3Url.searchParams.get('X-Amz-Signature'));
      logger.debug(fileId);
    }

    debug('returning file-vault url');

    const responseData = {
      url: `${config.get('file-vault-url')}/file${s3Item}?date=${requestDate}&id=${fileId}`
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

  let fileIdPayload;
  try {
    fileIdPayload = parseFileIdPayload(decrypt(reqId));
    if (!fileIdPayload) {
      throw new Error('invalid file id payload');
    }
  }
  catch (err) {
    logger.log('error', err);
    return next({
      code: 'FileGetInvalidRequest'
    });
  }

  const requestDay = requestDate.split('T')[0];
  const credential = fileIdPayload.credential
    || `${config.get('aws.accessKeyId')}/${requestDay}/${config.get('aws.region')}/s3/aws4_request`;

  const params = new URLSearchParams({
    'X-Amz-Algorithm': fileIdPayload.algorithm || config.get('aws.amzAlgorithm'),
    'X-Amz-Credential': credential,
    'X-Amz-Date': requestDate,
    'X-Amz-Expires': fileIdPayload.expires || String(parseInt(config.get('aws.expiry'))),
    'X-Amz-Signature': fileIdPayload.signature,
    'X-Amz-SignedHeaders': fileIdPayload.signedHeaders || 'host'
  });

  if (fileIdPayload.securityToken) {
    params.append('X-Amz-Security-Token', fileIdPayload.securityToken);
  }

  let objectUrl;
  if (config.has('aws.endpoint') && config.get('aws.endpoint')) {
    objectUrl = `${config.get('aws.endpoint').replace(/\/$/, '')}/${config.get('aws.bucket')}/${req.params.id}`;
  } else {
    objectUrl = `https://${config.get('aws.bucket')}.s3.${config.get('aws.region')}.amazonaws.com/${req.params.id}`;
  }

  logSignatureDiagnostics(objectUrl, req.params.id, requestDate, fileIdPayload, params);

  logger.log('info', 'getting file-vault url');
  await getRequest(`${objectUrl}?${params.toString()}`, res, next);
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
