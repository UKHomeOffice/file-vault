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

## Tutorial

This tutorial explains how to set up the different components of AWS s3, keycloak and the filevault configuration file.  This will then allow you to run a local instance of filevault in docker-compose so you can post a document.

### AWS S3

Make sure you have an AWS s3 instance created.

#### AWS S3 Secrets

Grab the secrets.  In kubernetes you can do this

`kubectl get secrets notify-secret -o yaml`

This should return your secrets like so

```
  access_key_id: <your-access-key-id>
  kms_key_id: <your-kms-key-id>
  name: <your-bucket-name>
  secret_access_key: <your-secret-access-key>
```

Note: that each item in the secret is likely to be base64 encoded and you'll need to decode it.  You can do this on the terminal like so

`echo <secret> | base64 -D`

#### AWS CLI

Now check that these secrets are valid.  The best way to do this is to use the [AWS-CLI](https://docs.aws.amazon.com/polly/latest/dg/setup-aws-cli.html). You'll need to download & install it.

#### AWS Credentials

You'll need to set up your [AWS credentials](https://docs.aws.amazon.com/sdk-for-java/v1/developer-guide/setup-credentials.html)

Now you should be able to access your bucket

`aws s3 ls s3://<your-s3-bucket-name>`

If your bucket is empty, this is not going to return anything.  

#### Upload to AWS

Next try and post to the bucket

`aws s3 cp --sse aws:kms --sse-kms-key-id <kms-key-id> <file> s3://<bucket-name>`

If the post was successful, the command line will return something like the following

`upload: ./myfile.txt to s3://my-bucket/myfile.txt`

### Keycloak <a name="keycloak">

#### Keycloak realm <a name="keycloak-realm">

You will need a keycloak realm set up something like

`https://sso-dev.notprod.homeoffice.gov.uk/auth/realms/<my-realm>`

#### Client ID and Client secret <a name="client-id-secret"></a>

You will need to create a client in keycloak.  You may need to ask your administrator to do this if you do not have access

- Go to `Keycloak` -> `Applications` -> `Security Admin console` -> `Clients` -> `Create`
- Name the `client ID`
- Enable `Direct Access Grants`
- Select the `Credentials tab`
- Keep a note of the `Client secret`.  You will need this later
- Set the `Valid Redirect URIs` to `localhost`

#### Roles

You will also need to create a role

- Go to `Keycloak` -> `Roles` (located on the left) -> `Add role` 
- Call the role `caseworkers`

#### Groups

You will also need to create a group

- Go to `Keycloak` -> `Groups` (located on the left) -> `New`
- Call the group something 
- open the group -> role mappings -> assign roles as `caseworkers`

#### Users

You will also need to create a user

- Go to `Keycloak` -> `Users` (located on the left) -> `Add user`
- Give the user an `username` and `password`

### Docker-compose

The best way to run the service is to use docker-compose.  However, you'll need to make sure you change and obtain the following configuration details in the `docker-compose.yml` file:

```
- PROXY_CLIENT_SECERT=<client-secret>
- PROXY_CLIENT_ID=<client-id>
- PROXY_DISCOVERY_URL=<keycloak-realm-url>
```

You can grab the [client-id](#client-id-secret), [client-secret](#client) and [keycloak-realm-url](keycloak-realm) from [Keycloak](#keycloak) as described above.

#### Build & Run

- `docker-compose build`
- `docker-compose up`

#### bearer token <a name="bearer-token">

Request a bearer token from keycloak.  Note the keycloak url is different to your normal url

```
curl -X POST https://<domain-of-host-realm>/auth/realms/<my-realm>/protocol/openid-connect/token -d "username=<your-username>" -d 'password=<your-password>' -d 'grant_type=password' -d 'client_id=<your-client-id>' -d 'client_secret=<your-client-id>'
```

This will return a long bearer token in JSON

```
{"access_token":"<bearer-token-returned>","expires_in":300,"refresh_expires_in":1800,"refresh_token":"<bearer-token-returned>","token_type":"bearer","not-before-policy":0,"session_state":"<session-stat-number>","scope":"email profile"}
```

#### Upload a document via filevault

Ensure you have the [bearer token](#bearer-token) and you use it before it expires.

Also ensure you have the path of a file to POST.

```
curl -H "Authorization: Bearer <bearer-token>" -F 'document=@/Users/Name/my-file.txt' https://localhost/file -kv
```

Note: that the end point is `localhost/file`

This will return a url something like

```
{"url":"http://localhost/file/<filename>?date=<date>&id=<random-id>"}
```

Copy and paste the url into the browser.  You will need to log into office 365. Your file should be there
