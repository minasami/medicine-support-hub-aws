# Linux/amd64 child manifest of AWS's Python 3.12 Lambda image, resolved 2026-10-13.
# Refresh the digest deliberately to take upstream security and runtime updates.
FROM --platform=linux/amd64 public.ecr.aws/lambda/python@sha256:e244a3ce9f8b77c8afe7a8403e67f845ecdb7ae09992b1a1d6139e4edde26380

COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN python -m pip install --no-cache-dir --only-binary=:all: \
    --requirement ${LAMBDA_TASK_ROOT}/requirements.txt

COPY app.py ${LAMBDA_TASK_ROOT}/app.py
CMD ["app.lambda_handler"]
