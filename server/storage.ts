import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ENV } from "./_core/env";

let client: S3Client | null = null;

function normalizeKey(value: string): string {
  const normalized = value
    .replaceAll("\\", "/")
    .split("/")
    .filter(part => part.length > 0 && part !== "." && part !== "..")
    .join("/");

  if (!normalized) throw new Error("Storage key is required.");
  return normalized;
}

function requireStorageConfig() {
  if (!ENV.s3Bucket) {
    throw new Error("S3_BUCKET is required for protected object storage.");
  }

  if (Boolean(ENV.s3AccessKeyId) !== Boolean(ENV.s3SecretAccessKey)) {
    throw new Error(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must either both be set or both be omitted.",
    );
  }
}

function getClient(): S3Client {
  requireStorageConfig();
  if (client) return client;

  client = new S3Client({
    region: ENV.s3Region,
    endpoint: ENV.s3Endpoint || undefined,
    forcePathStyle: ENV.s3ForcePathStyle,
    credentials:
      ENV.s3AccessKeyId && ENV.s3SecretAccessKey
        ? {
            accessKeyId: ENV.s3AccessKeyId,
            secretAccessKey: ENV.s3SecretAccessKey,
          }
        : undefined,
  });

  return client;
}

export async function storageReady(): Promise<void> {
  requireStorageConfig();
  await getClient().send(new HeadBucketCommand({ Bucket: ENV.s3Bucket }));
}

export async function storagePut(
  relativeKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  requireStorageConfig();
  const key = normalizeKey(relativeKey);

  await getClient().send(
    new PutObjectCommand({
      Bucket: ENV.s3Bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    }),
  );

  return {
    key,
    url: await storageGetSignedUrl(key),
  };
}

export async function storageCreateUploadUrl(
  relativeKey: string,
  contentType = "application/octet-stream",
): Promise<{ key: string; uploadUrl: string }> {
  requireStorageConfig();
  const key = normalizeKey(relativeKey);
  const command = new PutObjectCommand({
    Bucket: ENV.s3Bucket,
    Key: key,
    ContentType: contentType,
  });
  return {
    key,
    uploadUrl: await getSignedUrl(getClient(), command, {
      expiresIn: ENV.storageSignedUrlTtlSeconds,
    }),
  };
}

export async function storageHead(relativeKey: string): Promise<{ contentLength: number; contentType: string | null }> {
  requireStorageConfig();
  const key = normalizeKey(relativeKey);
  const response = await getClient().send(
    new HeadObjectCommand({ Bucket: ENV.s3Bucket, Key: key }),
  );
  return {
    contentLength: Number(response.ContentLength ?? 0),
    contentType: response.ContentType ?? null,
  };
}

export async function storageReadBuffer(relativeKey: string): Promise<Buffer> {
  requireStorageConfig();
  const key = normalizeKey(relativeKey);
  const response = await getClient().send(
    new GetObjectCommand({ Bucket: ENV.s3Bucket, Key: key }),
  );
  if (!response.Body) throw new Error("The protected source object is empty or unavailable.");
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

export async function storageGet(
  relativeKey: string,
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relativeKey);
  return {
    key,
    url: await storageGetSignedUrl(key),
  };
}

export async function storageGetSignedUrl(relativeKey: string): Promise<string> {
  requireStorageConfig();
  const key = normalizeKey(relativeKey);

  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: ENV.s3Bucket,
      Key: key,
    }),
    { expiresIn: ENV.storageSignedUrlTtlSeconds },
  );
}
