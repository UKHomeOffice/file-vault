# File-vault a RESTful service to store and retrieve files

File-vault is a simple REST service that allows POSTing a file to an S3 bucket. Upon a successful virus check the service will return with a URL that can be used to retrieve the file. 

## Configuration

The following environment variables are used to configure file-vault.
```
  FILE_VAULT_URL            | URL of file-vault, this is used when returning a URL upon successful upload to S3
  CLAMAV_REST_URL           | Location of ClamAV rest service
  AWS_ACCESS_KEY_ID         | AWS Key ID
  AWS_SECRET_ACCESS_KEY     | AWS Secret Access Key
  AWS_KMS_KEY_ID            | AWS KMS Key ID
  AWS_REGION                | AWS Region (defaults to eu-west-1)
  AWS_SIGNATURE_VERSION     | AWS Signature Version (defaults to v4)
  AWS_BUCKET                | AWS Bucket Name
  AWS_EXPIRY_TIME           | Length of time (in seconds) the URL will be valid for (defaults to 1 hour)
  AWS_PASSWORD              | A password used to encrypt the params that are returned by file-vault
  STORAGE_FILE_DESTINATION  | Temp directory for storing uploaded file (this is deleted on upload or fail and defaults to 'uploads')
  REQUEST_TIMEOUT           | Length of time (in seconds) for timeouts on http requests made by file-vault (when talking to clamAV and s3, defaults to 15s)
  FILE_EXTENSION_WHITELIST  | A comma separated list of file types that you want to white-list (defaults to everything). If the file is not in this list file-vault will respond with an error.
```
