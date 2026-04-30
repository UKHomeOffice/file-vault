# File-vault

File-vault is a small Express service for scanning uploaded files, storing them in S3, and returning a retrieval URL that can be handed back to another service or UI.

The current service uses:

- Node 24
- AWS SDK for JavaScript v3
- Jest for unit testing
- ClamAV for virus scanning
- S3 presigned URLs encrypted with `aes-256-ctr`

## What the service does

The upload flow is:

1. Accept a multipart upload in the `document` form field.
2. Optionally reject the file if its extension is not allowed.
3. Send the file to ClamAV for scanning.
4. Upload the file to S3 with KMS server-side encryption.
5. Generate a presigned S3 download URL.
6. Encrypt the S3 signature and return a shorter file-vault URL.

The retrieval flow is:

1. Accept a file-vault URL of the form `/file/:id?date=...&id=...`.
2. Decrypt the encrypted S3 signature.
3. Reconstruct the S3 presigned URL.
4. Fetch the file from S3 and stream it back to the caller.

## Important behavior

- Only the current encrypted ID format is supported. The old deprecated decrypt fallback has been removed.
- Returned file IDs are encoded as `hex(iv):hex(ciphertext)`.
- `POST /file` returns `400` for expected validation or upstream scan/upload failures and `GET /file/:id` returns `500` for internal retrieval failures.
- The optional `GET /file/generate-link/:id` route is disabled by default and must be enabled explicitly.

## API

### `POST /file`

Accepts a multipart form upload with the file in the `document` field.

Example:

```bash
curl -F 'document=@/path/to/file.pdf' http://localhost:3000/file
```

Successful response:

```json
{
  "url": "http://localhost/file/abc123?date=20260430T120000Z&id=<encrypted-signature>"
}
```

If `RETURN_ORIGINAL_SIGNED_URL=yes` is set, the response also includes the original S3 presigned URL:

```json
{
  "url": "http://localhost/file/abc123?date=20260430T120000Z&id=<encrypted-signature>",
  "originalSignedUrl": "https://bucket.s3.eu-west-1.amazonaws.com/..."
}
```

Common error responses:

```json
{ "code": "FileNotFound" }
```

```json
{ "code": "FileExtensionNotAllowed" }
```

```json
{ "code": "VirusFound" }
```

```json
{ "code": "VirusScanFailed" }
```

```json
{ "code": "S3PUTFailed" }
```

### `GET /file/:id`

Retrieves a previously uploaded object using the file-vault URL returned by `POST /file`.

The simplest way to fetch a file is to use the returned `url` value exactly as provided.

Example:

```text
http://localhost:3000/file/97ebbf4916250d24c7724044d1e1a54d?date=20260430T120000Z&id=75219fd49fe3d34a46b213f162bf05dc:c38868e0cad4596bb62c0feb04f86245ed188c944a2c231d718ecd83a8e988351900e01f2ecf958e8334e02a6e44cbb8ccebfbe1b1cb84d6d997017fc33e3d6d
```

Example with `curl`:

```bash
curl "http://localhost:3000/file/97ebbf4916250d24c7724044d1e1a54d?date=20260430T120000Z&id=75219fd49fe3d34a46b213f162bf05dc%3Ac38868e0cad4596bb62c0feb04f86245ed188c944a2c231d718ecd83a8e988351900e01f2ecf958e8334e02a6e44cbb8ccebfbe1b1cb84d6d997017fc33e3d6d"
```

If you build the URL manually:

- The path parameter is the uploaded object key.
- The `date` query parameter is the `X-Amz-Date` value from the original presigned URL.
- The `id` query parameter is the encrypted S3 signature returned by file-vault.
- The encrypted `id` contains a `:` character, so it should be URL-encoded as `%3A` when used in a raw query string.

The `id` query parameter is not the S3 object key. It is the encrypted S3 signature. The path parameter is the S3 object key generated during upload.

This is not correct:

```bash
curl http://localhost:3000/file/75219fd49fe3d34a46b213f162bf05dc:c38868e0cad4596bb62c0feb04f86245ed188c944a2c231d718ecd83a8e988351900e01f2ecf958e8334e02a6e44cbb8ccebfbe1b1cb84d6d997017fc33e3d6d
```

That request puts the encrypted signature in the path and omits the required `date` and `id` query parameters.

### `GET /file/generate-link/:id`

This route is only available when `ALLOW_GENERATE_LINK_ROUTE=yes` is set.

It generates a fresh presigned S3 URL for the supplied object key and immediately proxies the file response back to the caller.

## Configuration

N.B. if you are getting either 502 errors through Nginx and the Nginx logs are saying 'upstream prematurely closed connection while reading response header' OR you see this error below if running filevault locally, this is due to issues with decryption and the AWS Password or signature in the ID query parameter falling out of sync with the service. This is usually due to a code change or using a different file vault image in your drone file (i.e. switching the filevault image SHA). This is most likely to be discovered during Testing and should not be an issue in production unless the AWS Password or default algorithm has been changed suddenly. Beware: this could block caseworkers from accessing previously submitted material to S3.

```
{
  "code": "ERR_UNESCAPED_CHARACTERS"
}
```

The service uses the `config` package and reads the following environment variables.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `FILE_VAULT_URL` | Yes | `http://localhost` | Base URL used when returning file-vault links |
| `CLAMAV_REST_URL` | Yes | none | URL of the ClamAV REST service |
| `AWS_ACCESS_KEY_ID` | Yes | none | AWS access key ID |
| `AWS_SECRET_ACCESS_KEY` | Yes | none | AWS secret access key |
| `AWS_KMS_KEY_ID` | Yes | none | KMS key used for S3 server-side encryption |
| `AWS_BUCKET` | Yes | none | S3 bucket name |
| `AWS_PASSWORD` | Yes | empty string, which causes startup failure | Secret used to derive the encryption key for returned IDs |
| `AWS_ENDPOINT` | No | empty | Custom S3-compatible endpoint (for example `http://local-s3:80`) |
| `AWS_REGION` | No | `eu-west-1` | AWS region |
| `AWS_SIGNATURE_VERSION` | No | `v4` | Retained config value for AWS signing |
| `AWS_EXPIRY_TIME` | No | `3600` | Presigned URL expiry in seconds |
| `REQUEST_TIMEOUT` | No | `15000` ms effective fallback if unset or invalid | Timeout for ClamAV and retrieval HTTP requests |
| `STORAGE_FILE_DESTINATION` | No | `uploads` | Temporary upload directory |
| `FILE_EXTENSION_WHITELIST` | No | empty | Comma-separated list of allowed file extensions |
| `MAX_FILE_SIZE` | No | none | Available config value for scan-size limits |
| `ALLOW_GENERATE_LINK_ROUTE` | No | `no` | Enables `GET /file/generate-link/:id` |
| `RETURN_ORIGINAL_SIGNED_URL` | No | `no` | Includes the raw S3 presigned URL in upload responses |

## Local development

### Prerequisites

- Node `>=24.15.0 <25.0.0`
- Yarn 1
- Access to an S3 bucket and KMS key
- A ClamAV REST endpoint

### Install and run

```bash
yarn install
yarn start
```

For local development with dotenv support:

```bash
yarn start:dev
```

The app listens on the configured port, which defaults to `3000`.

## Docker compose

The repository still includes a `docker-compose.yml` that runs:

- the app
- a ClamAV REST service (`ajilaag/clamav-rest:0.5.3`)
- a local S3-compatible service (`local-s3`)
- a local S3 init job (`local-s3-init`) that waits for S3 and creates `aws-bucket` only when missing
- an nginx proxy
- a Keycloak proxy in front of the app

That proxy stack is for local end-to-end testing. Authentication is not implemented in the app itself.

For local development, the app is configured to use:

- `CLAMAV_REST_URL=http://clamav-rest:9000/scan`
- `AWS_ENDPOINT=http://local-s3:80`
- `ALLOW_GENERATE_LINK_ROUTE=yes`

Before using the compose stack, update the proxy-related values in `docker-compose.yml` to match your Keycloak realm and client configuration.

Build and run:

```bash
docker compose up -d --build --remove-orphans
```

Build and run with the proxy profile enabled:

```bash
docker compose --profile proxy up -d --build --remove-orphans
```

Check service status:

```bash
docker compose ps
```

Check service status with the proxy profile enabled:

```bash
docker compose --profile proxy ps
```

You should see `clamav-rest` become healthy and `local-s3` running.

Without the proxy profile, call the app directly at `http://localhost:3000/file`.

With the proxy profile enabled, traffic goes through `proxy` and `nginx-proxy`, so use `https://localhost/file`.

The `proxy` and `nginx-proxy` services are only started when `--profile proxy` is set.

NOTE: If you are running on Apple Silicon, note that the current `proxy` image in `docker-compose.yml` has shown runtime issues on arm64, so the profile command is correct but the proxy service itself may still fail until that image is replaced with a compatible tag.

If you want to exercise the proxied path, obtain a bearer token from your Keycloak realm before calling `https://localhost/file`.

To list objects in local S3 using the compose AWS CLI image:

```bash
docker compose run --rm --entrypoint /usr/local/bin/aws local-s3-init --endpoint-url http://local-s3:80 s3 ls s3://aws-bucket
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


## Testing

Run linting and unit tests:

```bash
yarn test
```

Or run them separately:

```bash
yarn run test:lint
yarn run test:unit
```

The unit suite uses Jest and currently covers the upload flow, retrieval flow, generate-link route, timeout behavior, app wiring, and logger behavior.

## Release workflow

This repository uses Git tags to trigger the release pipeline and publish container images to Quay.

Typical release flow:

1. Create a semantic version tag from `master`.
2. Push the tag.
3. Drone builds and publishes the image.

Example:

```bash
git checkout master
git tag 1.2.3
git push origin 1.2.3
```

The published image should be referenced with both tag and digest when possible.

Example:

```text
quay.io/ukhomeofficedigital/file-vault:1.2.3@sha256:<digest>
```


**Important:**

Use valid Semantic Versioning format: v<MAJOR>.<MINOR>.<PATCH> (e.g., 1.0.0, 2.3.1)

The Drone CI pipeline is configured to only trigger on tags created from the master branch.

#### Reason for Usage of image:tag@digest

The format image:tag@digest combines:

* Tag (human-readable version, like 1.2.3)

* Digest (immutable SHA-256 content identifier)

The digest SHA (sha256:<digest>) is a cryptographic hash that uniquely identifies the image content. You can retrieve it from Quay.io after the image is pushed:

**This guarantees:**

* 'Consistency' – The image always resolves to the same content.

* 'Traceability' – You can trace exactly which build and source it came from.

* 'Security' – Prevents tampering or tag overwriting in registries.
