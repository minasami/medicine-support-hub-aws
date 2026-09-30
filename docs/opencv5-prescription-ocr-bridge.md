# Optional OpenCV prescription OCR bridge

## Status and scope

The integration code is part of the feature-branch change only. It is **disabled by default** and remains disabled until the owner separately deploys the IAM-protected Lambda Function URL, configures the Appwrite Function server environment, and completes the required privacy/security and cost review. No deployment, AWS resource creation, real-patient-data processing, or cloud call is part of this change; this change incurred no AWS worker charges.

The existing client OCR fallback remains available. Unless **both** the client build gate and server-side Function gate are explicitly enabled, the browser/native OCR runs against the original uploaded image and the client does not invoke the preprocessing action. When enabled, it asks the authenticated Appwrite `ocr-prescription-parser` Function for a transient preprocessed copy, then runs the existing local OCR against that copy. The original Appwrite upload is not modified, replaced, or deleted; the worker does not persist either image.

## Request and authorization path

1. The client uploads the source image to the existing `prescription-images` bucket with file-level `read` and `delete` permissions for the signed-in Appwrite user only.
2. The client calls the existing `ocr-prescription-parser` Function with `{ action: "preprocess", imageId }`. It does not call the AWS URL, send AWS credentials, or choose a worker URL.
3. The Function requires `x-appwrite-user-jwt` (or the existing `x-appwrite-jwt` header), creates a user-authenticated Appwrite client, and verifies the caller with `Account.get()`. Caller identity is taken only from the verified account; request-body `user_id`, `userId`, and other unknown fields are stripped and never used for authority.
4. Before any worker request, the Function reads file metadata through the caller's JWT-bound Storage client and requires both `read("user:<verified-user-id>")` and `delete("user:<verified-user-id>")` in the file ACL. This follows the existing ownership check in `functions/prescription-service/src/main.js`. A missing session, inaccessible file, or mismatched ACL is rejected; the bridge does not fall back to trusting a body-supplied identity.
5. Only after those checks and an explicit server-side enable flag does the Function download the original bytes and send a bounded JPEG/PNG/WebP copy to the configured AWS Lambda Function URL over HTTPS with SigV4 (`service=lambda`). The host and region are validated; the endpoint cannot be supplied by the caller. The worker URL must remain `AuthType: AWS_IAM`, with no public `NONE` endpoint.
6. A successful processed image is returned only to the authenticated caller for the existing local OCR step. If the feature is off, the file is unsupported/too large, signing/configuration is missing, or the worker fails, the Function returns a safe fallback result and the client uses the original local file. The original file ID remains the one attached to the prescription.

The Appwrite Function remains restricted to `execute: ["users"]`; do not add `any`. Keep the prescription bucket's file-level security enabled. The repository's bucket provisioning script enables it for new buckets, but before rollout verify the existing bucket setting and that a test upload has the expected per-user permissions. If that cannot be verified, do not enable the bridge.

## Required configuration before any opt-in

Configure these only in the **Appwrite Function's server-side environment** or the AWS service itself. Never place AWS values in Vite/client environment variables, `appwrite.json`, source code, logs, or a client bundle.

| Variable | Required when enabled | Purpose |
| --- | --- | --- |
| `VITE_OPENCV5_PRESCRIPTION_VISION_ENABLED` | Yes; keep `false`/unset until rollout approval | Non-secret client build gate. The browser does not invoke the preprocessing Function unless this is exactly `true`; it contains no worker URL or credentials. |
| `OPENCV5_PRESCRIPTION_VISION_ENABLED` | Yes; keep `false` until rollout approval | Server-side feature gate. Code treats missing or any value other than `true` as off. |
| `OPENCV5_WORKER_URL` | Yes | Deployed Lambda Function URL, exactly the HTTPS root URL matching `https://<id>.lambda-url.<AWS_REGION>.on.aws/`. The function rejects non-Lambda hosts, paths, query strings, and region mismatches. |
| `AWS_REGION` | Yes | Region of the Lambda Function URL and the SigV4 signing scope. |
| `AWS_ACCESS_KEY_ID` | Yes | Server-side IAM access key with narrowly scoped Function URL invocation permissions. |
| `AWS_SECRET_ACCESS_KEY` | Yes | Matching server-side IAM secret. Store as a protected Appwrite Function secret; never commit it. |
| `AWS_SESSION_TOKEN` | If using temporary STS credentials | Session token for short-lived IAM credentials. |
| `APPWRITE_FUNCTION_API_ENDPOINT` | Existing Appwrite runtime configuration | Appwrite endpoint used with the caller JWT. |
| `APPWRITE_FUNCTION_PROJECT_ID` | Existing Appwrite runtime configuration | Appwrite project used with the caller JWT. |
| `APPWRITE_API_KEY` or `APPWRITE_FUNCTION_API_KEY` | Existing database persistence path, if required | Existing server-side Appwrite database scopes; it is not used as AWS credentials and is not accepted from the caller. |

The IAM identity needs only the worker-specific `lambda:InvokeFunctionUrl` permission conditioned on `lambda:FunctionUrlAuthType = AWS_IAM` and `lambda:InvokeFunction` conditioned on `lambda:InvokedViaFunctionUrl = true`, scoped to the deployed worker function ARN. Do not grant wildcard principals or public invocation. Use temporary, short-lived credentials where the hosting setup supports them, and rotate them through the owner-approved secrets process. Enabling the bridge causes per-invocation AWS charges; confirm an owner-approved budget before setting either gate to `true`.

The worker accepts at most 4 MiB and 24 megapixels; the Appwrite-to-worker request is time-limited to 15 seconds to leave headroom under Appwrite's 30-second synchronous execution limit. The synchronous execution response contains the processed image as base64, so **do not assume that response is transient**: verify Appwrite execution-history retention and access controls for `responseBody` before enabling the flag. If those controls are not acceptable for prescription images, redesign the transfer path rather than weakening auth or file permissions. Do not log request/response bodies, image bytes, credentials, or patient content. Enabling the flag is a separate product/privacy decision because a copy of the user's prescription image will be processed by AWS.

## Local verification

The integration tests use synthetic bytes and mocked Appwrite/AWS clients only; they make no network calls. From `functions/ocr-prescription-parser`:

```sh
npm test
```

The standalone worker's synthetic-only suite remains:

```sh
cd infra/opencv5-prescription-worker
python -m unittest -v test_app.py
```
