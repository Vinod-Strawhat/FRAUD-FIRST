import {
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface EvidenceS3UploadInput {
  bucket: string;
  key: string;
  body: Uint8Array;
  contentType: string;
  sha256: string;
  preservedAt: string;
}

export interface EvidenceS3UploadResult {
  key: string;
  eTag?: string;
  versionId?: string;
}

let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    });
  }
  return s3Client;
}

export function hasAwsCredentials(): boolean {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const hasRegion = Boolean(region);
  const hasStaticCredentials =
    Boolean(process.env.AWS_ACCESS_KEY_ID) &&
    Boolean(process.env.AWS_SECRET_ACCESS_KEY);
  const hasProfile = Boolean(process.env.AWS_PROFILE);
  return hasRegion && (hasStaticCredentials || hasProfile);
}

export function configuredEvidenceBucket(): string | null {
  const bucket = process.env.FRAUDFIRST_EVIDENCE_BUCKET;
  return typeof bucket === "string" && bucket.length > 0 ? bucket : null;
}

export async function uploadEvidenceBytes(
  input: EvidenceS3UploadInput
): Promise<EvidenceS3UploadResult> {
  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType,
    ServerSideEncryption: "AES256",
    Metadata: {
      "fraudfirst-sha256": input.sha256,
      "fraudfirst-preserved-at": input.preservedAt,
      "fraudfirst-key": input.key,
    },
  });
  const response = await getClient().send(command);
  return {
    key: input.key,
    eTag: response.ETag,
    versionId: response.VersionId,
  };
}