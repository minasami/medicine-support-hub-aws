/**
 * AWS Cloud Client for Medicine Support Hub.
 * Connects the web frontend to:
 * - AWS Amplify Hosting (App d24cynqfuktylf)
 * - AWS Lambda Function URL (Backend & MCP Bridge)
 * - Amazon S3 (msh-prescriptions-243894880675)
 * - Amazon DynamoDB (msh_prescriptions)
 * - Amazon Bedrock (Clinical Assistant & Speech)
 */

export interface AWSCloudStatus {
  ok: boolean;
  service: string;
  runtime: string;
  version: string;
  region: string;
  aws: {
    amplify: {
      appId: string;
      url: string;
      status: string;
    };
    s3: {
      bucket: string;
      status: string;
    };
    dynamodb: {
      table: string;
      status: string;
    };
    bedrock: {
      enabled: boolean;
      model: string;
      hybridFallback: string;
    };
  };
  tools: string[];
}

export interface AWSPrescriptionItem {
  id: string;
  patient_id?: string;
  patient_name?: string;
  status: "pending_review" | "verified" | "dispensed" | "substituted_generic";
  doctor_name?: string;
  diagnosis?: string;
  medicines: Array<{
    name: string;
    dosage?: string;
    status?: string;
    priceEgp?: number;
    generic_substitute?: string;
  }>;
  created_at: string;
  s3_key?: string;
  aws_region?: string;
  notes?: string;
}

export interface AWSClinicalAnalysis {
  provider: string;
  aws: {
    bedrock: boolean;
    dynamodb: string;
    s3: string;
    region: string;
  };
  interactions: Array<{
    pair: string[];
    severity: string;
    warning: string;
    warningAr?: string;
  }>;
  substitutions: Array<{
    prescribedBrand: string;
    availableGenerics: Array<{
      name: string;
      company: string;
      strength: string;
      forms: string;
      priceEgp: number;
      savingsPercent: string;
    }>;
    clinicalNote: string;
  }>;
  clinicalAdvice: string;
  safetyCheckPassed: boolean;
  timestamp: string;
}

export const AWS_CONFIG = {
  region: import.meta.env.VITE_AWS_REGION || "us-east-1",
  amplifyAppId: "d24cynqfuktylf",
  amplifyUrl: "https://main.d24cynqfuktylf.amplifyapp.com",
  s3Bucket: import.meta.env.VITE_AWS_S3_PRESCRIPTIONS_BUCKET || "msh-prescriptions-243894880675",
  dynamoTable: import.meta.env.VITE_AWS_DYNAMODB_TABLE || "msh_prescriptions",
  lambdaUrl: "https://btf73widzhd7aboopn2fes66di0nrlnk.lambda-url.us-east-1.on.aws",
};

/**
 * Fetch real-time health and AWS service telemetry
 */
export async function getAWSCloudStatus(): Promise<AWSCloudStatus> {
  const res = await fetch(`${AWS_CONFIG.lambdaUrl}/health`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch AWS status: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * List prescriptions stored in Amazon DynamoDB
 */
export async function listAWSPrescriptions(): Promise<AWSPrescriptionItem[]> {
  try {
    const res = await fetch(`${AWS_CONFIG.lambdaUrl}/api/prescriptions`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.prescriptions || [];
  } catch (err) {
    console.warn("Falling back to local cache for prescriptions:", err);
    return [];
  }
}

/**
 * Create a new prescription in Amazon DynamoDB
 */
export async function createAWSPrescription(
  record: Partial<AWSPrescriptionItem>
): Promise<AWSPrescriptionItem> {
  const res = await fetch(`${AWS_CONFIG.lambdaUrl}/api/prescriptions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    throw new Error(`Failed to save to DynamoDB: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.prescription;
}

/**
 * Upload prescription file directly to Amazon S3 via presigned PUT URL
 */
export async function uploadPrescriptionToS3(
  file: File
): Promise<{ s3Key: string; bucket: string; region: string }> {
  // 1. Request presigned URL from Lambda
  const presignedRes = await fetch(
    `${AWS_CONFIG.lambdaUrl}/api/prescriptions/upload-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "image/jpeg",
      }),
    }
  );

  if (!presignedRes.ok) {
    throw new Error(`Failed to get S3 upload authorization: HTTP ${presignedRes.status}`);
  }

  const { uploadUrl, key, bucket, region } = await presignedRes.json();

  // 2. Direct browser PUT to Amazon S3
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "image/jpeg",
    },
    body: file,
  });

  if (!uploadRes.ok) {
    throw new Error(`S3 direct upload failed: HTTP ${uploadRes.status}`);
  }

  return { s3Key: key, bucket, region };
}

/**
 * Analyze prescription and medicines with Amazon Bedrock & EDA Clinical Rules Engine
 */
export async function analyzeWithAWSBedrock(payload: {
  text?: string;
  medicines?: string[];
}): Promise<AWSClinicalAnalysis> {
  const res = await fetch(`${AWS_CONFIG.lambdaUrl}/api/clinical/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Bedrock clinical analysis failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.analysis;
}
