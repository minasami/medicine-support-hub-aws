# Standalone OpenCV 5 prescription-image worker

This directory contains an **optional, standalone** AWS Lambda container worker. It detects a plausible page quadrilateral, rectifies perspective, applies CLAHE and adaptive thresholding for downstream OCR, and returns deterministic image-quality metrics. If the boundary is uncertain, it returns a bounded identity image and a warning instead of inventing a crop.

The worker does **not** perform OCR, identify medicines, interpret dosage, diagnose, or make clinical decisions. Its image-quality thresholds are heuristics for capture-quality feedback, not clinical validation. Preserve the source image for any downstream review; the returned thresholded image is only an OCR aid.

## Local synthetic-only checks

Python 3.12 is the Lambda runtime; dependencies are pinned in `requirements.txt`.

```sh
python -m pip install -r requirements.txt
python -m unittest -v test_app.py
```

Every fixture is generated in memory from blank canvases and geometric line art. The tests do not use real patient data, network services, AWS credentials, or AWS resources.

Build the image locally, if Docker is available:

```sh
docker build -t opencv5-prescription-worker .
```

## Opt-in worker deployment (not performed)

No AWS resources are created by this repository change. Deployment is deliberately a separate, owner-operated step and may incur AWS charges for Lambda execution, container-image storage, and network transfer. Do not deploy without separate review and authorization.

From this directory, after approval in a dedicated non-production AWS account:

```sh
sam validate --lint --template-file template.yaml
sam build --use-container --template-file template.yaml
sam deploy --guided --template-file .aws-sam/build/template.yaml
```

The template creates only the worker's Lambda function, Function URL, and required runtime logging resources. It declares `FunctionUrlConfig.AuthType: AWS_IAM`; [AWS requires SigV4 for each IAM-authenticated URL request](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html) and both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` permissions ([AWS access-control guidance](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)). The URL is routable but **not an unauthenticated public processing endpoint**. Same-account callers can be granted narrowly scoped identity permissions; cross-account callers also need a specific resource-based grant. Do not change the auth type to `NONE`, add wildcard principals, enable public invoke permissions, or add a permissive CORS policy. The Function URL configuration and SAM output follow [AWS SAM's documented `FunctionUrlConfig` pattern](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-functionurlconfig.html).

Grant a caller only the two invoke actions on the deployed function ARN, constrained to this Function URL. For example, an identity policy can use the following resource-scoped shape (replace the ARN only after deployment and review):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunctionUrl",
      "Resource": "<worker-function-arn>",
      "Condition": { "StringEquals": { "lambda:FunctionUrlAuthType": "AWS_IAM" } }
    },
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "<worker-function-arn>",
      "Condition": { "Bool": { "lambda:InvokedViaFunctionUrl": "true" } }
    }
  ]
}
```

Use a SigV4-capable AWS SDK or an approved signer for requests; never put AWS credentials in a browser, mobile app, source tree, or client-distributed configuration. The template gives the execution role only Lambda's basic CloudWatch Logs permissions; the worker has no S3, database, queue, or external-service permissions. Keep invocation access private and narrowly scoped.

## Data handling and limits

- Input is limited to 4 MiB, JPEG/PNG/WebP, and 24 megapixels; dimensions are checked before OpenCV decodes pixels.
- Work is in memory. The handler does not write image data to disk, storage, logs, or a database and does not return exception text or request contents.
- Lambda's normal operational metadata and invocation metrics still apply. Configure any additional logging or tracing to exclude request/response bodies and image data.
- The Function URL response is `no-store`; callers should also avoid caching or persisting the returned image unless they have an approved data-handling design.
- Do not send real patient information to development, test, or public demo environments. Use only synthetic fixtures for validation.

The feature branch also contains an optional server-side bridge from Appwrite's existing prescription OCR Function. That bridge is **off by default**, verifies the Appwrite caller and per-file ownership before processing, and signs AWS Function URL requests with SigV4. It is not active until the owner separately deploys/configures the worker and Appwrite Function. See [the bridge rollout and security guide](../../docs/opencv5-prescription-ocr-bridge.md) for required server-only variables, IAM scope, privacy review, and fallback behavior. No AWS resources or Appwrite deployment are included in this repository change.
