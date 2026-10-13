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

No AWS resources are created by this repository change. The worker stack consumes the **pre-created external** ECR repository `opencv-worker-test`; it does not declare or own an ECR resource. The review-only CloudFormation change set is a separate, owner-operated step and must not be executed. Any eventual deployment may incur charges for Lambda execution, container-image storage, and network transfer.

Use only the approved `opencv-worker-test-deploy` assumed role in the approved account and `us-east-1`. The first AWS command in a session must be `aws sts get-caller-identity`; continue only if both the account and assumed role match the approval. Do not run AWS commands as root or use another identity. Stop on access denied or any unexpected permission, resource, cost, or proposed action. Prepare the CloudFormation service role, Lambda execution role, and permissions boundary separately under the approved policy proposal.

Set values only from the verified identity and approved proposal; these placeholders are not credentials:

```sh
export AWS_ACCOUNT_ID="<verified-12-digit-account-id>"
export AWS_REGION="us-east-1"
export STACK_NAME="opencv-worker-test"
export CFN_ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/opencv-worker-test-cfn"
export IMAGE_REPOSITORY_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/opencv-worker-test"
```

Check for the external ECR repository before creating anything:

```sh
aws ecr describe-repositories \
  --repository-names opencv-worker-test \
  --region "$AWS_REGION"
```

Create it only if that command returns `RepositoryNotFoundException`; on `AccessDenied`, any other error, or an unexpected existing repository configuration, stop and review rather than treating the result as absence:

```sh
aws ecr create-repository \
  --repository-name opencv-worker-test \
  --region "$AWS_REGION"
```

Validate and build locally. The current SAM build tags the image `prescriptionvisionworker:opencv5-python312`; confirm the tag from the build output if the template changes. **Stop without uploading if its size exceeds 5,000,000,000 bytes.**

```sh
sam validate --lint --template-file template.yaml
sam build --use-container --template-file template.yaml
docker image ls --no-trunc
IMAGE_SIZE_BYTES="$(docker image inspect prescriptionvisionworker:opencv5-python312 --format '{{.Size}}')"
printf 'SAM image size: %s bytes\n' "$IMAGE_SIZE_BYTES"
if [ "$IMAGE_SIZE_BYTES" -gt 5000000000 ]; then
  echo "Image exceeds 5GB; stop without uploading." >&2
  exit 1
fi
```

After the size gate passes, package the image into the pre-created repository. This step uploads the image; the mapping uses the single Image function's external repository. Do not use `--resolve-image-repos` or create an ECR resource in the worker stack.

```sh
sam package \
  --template-file .aws-sam/build/template.yaml \
  --image-repository "$IMAGE_REPOSITORY_URI" \
  --output-template-file .aws-sam/build/packaged-template.yaml \
  --region "$AWS_REGION"
```

Determine the change-set type from the verified stack state: use `CREATE` only when `opencv-worker-test` does not exist, or `UPDATE` only when it exists in an updateable state. Stop on any other lookup error or unexpected stack status. Then create a uniquely named change set for review only:

```sh
export CHANGE_SET_TYPE="<CREATE-or-UPDATE-after-verifying-stack-state>"
export CHANGE_SET_NAME="opencv-worker-test-review-$(date -u +%Y%m%dT%H%M%SZ)"

aws cloudformation create-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --change-set-type "$CHANGE_SET_TYPE" \
  --template-body file://.aws-sam/build/packaged-template.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --role-arn "$CFN_ROLE_ARN" \
  --region "$AWS_REGION"

aws cloudformation wait change-set-create-complete \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --region "$AWS_REGION"

aws cloudformation describe-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --region "$AWS_REGION" \
  --query 'Changes[].ResourceChange.{Action:Action,LogicalResourceId:LogicalResourceId,ResourceType:ResourceType,Replacement:Replacement}' \
  --output table
```

Review the complete change set and stop if it contains anything beyond the worker Lambda, its execution role, its `AWS_IAM`-authenticated Function URL, and the explicit 7-day log group. No ECR resource, public invoke permission, Appwrite resource, or unrelated action is allowed. **Do not run `execute-change-set` or otherwise apply the change set.**

The function uses the explicitly named execution role with Lambda-only trust, the fixed logging permissions boundary, and only the proposed CloudWatch Logs write permissions. The function URL remains `FunctionUrlConfig.AuthType: AWS_IAM`; do not change it to `NONE`, add wildcard principals, enable public invoke permissions, or add a permissive CORS policy. AWS requires SigV4 for each IAM-authenticated URL request and both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` permissions ([invocation guidance](https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html), [access-control guidance](https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html)). The URL is routable but **not an unauthenticated public processing endpoint**. Same-account callers can be granted narrowly scoped identity permissions; cross-account callers also need a specific resource-based grant. The Function URL configuration and SAM output follow [AWS SAM's documented `FunctionUrlConfig` pattern](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-function-functionurlconfig.html).

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
