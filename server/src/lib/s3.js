import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { statSync } from 'node:fs';
import { getSetting } from '../settings.js';

export function s3Config() {
  return {
    endpoint: getSetting('s3_endpoint', process.env.S3_ENDPOINT || ''),
    region: getSetting('s3_region', process.env.S3_REGION || 'auto'),
    bucket: getSetting('s3_bucket', process.env.S3_BUCKET || ''),
    accessKeyId: getSetting('s3_access_key', process.env.S3_ACCESS_KEY || ''),
    secretAccessKey: getSetting('s3_secret_key', process.env.S3_SECRET_KEY || ''),
    forcePathStyle: getSetting('s3_force_path', process.env.S3_FORCE_PATH || '0') === '1',
    prefix: getSetting('s3_prefix', 'artifacts').replace(/^\/+|\/+$/g, '') || 'artifacts'
  };
}

export function s3Configured() {
  const c = s3Config();
  return Boolean(c.bucket && c.accessKeyId && c.secretAccessKey);
}

let cached = null;
function client() {
  const c = s3Config();
  const key = [c.endpoint, c.region, c.accessKeyId, c.secretAccessKey, c.forcePathStyle].join('|');
  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: new S3Client({
        region: c.region || 'auto',
        endpoint: c.endpoint || undefined,
        forcePathStyle: c.forcePathStyle,
        credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey }
      })
    };
  }
  return cached.client;
}

const objectKey = (key) => {
  const c = s3Config();
  return `${c.prefix}/${key}`;
};

export async function uploadArtifact(key, filePath) {
  const c = s3Config();
  await client().send(new PutObjectCommand({
    Bucket: c.bucket,
    Key: objectKey(key),
    Body: createReadStream(filePath),
    ContentLength: statSync(filePath).size,
    ContentType: 'application/zip'
  }));
  return { key, bucket: c.bucket };
}

export async function deleteArtifact(key) {
  if (!s3Configured()) return;
  const c = s3Config();
  try {
    await client().send(new DeleteObjectCommand({ Bucket: c.bucket, Key: objectKey(key) }));
  } catch { /* объект мог уже исчезнуть */ }
}

export async function artifactExists(key) {
  if (!s3Configured()) return false;
  const c = s3Config();
  try {
    await client().send(new HeadObjectCommand({ Bucket: c.bucket, Key: objectKey(key) }));
    return true;
  } catch { return false; }
}

export async function presignArtifact(key, filename = 'archive.zip', expires = 300) {
  const c = s3Config();
  return getSignedUrl(client(), new GetObjectCommand({
    Bucket: c.bucket,
    Key: objectKey(key),
    ResponseContentDisposition: `attachment; filename="${String(filename).replace(/"/g, '')}"`
  }), { expiresIn: expires });
}

export async function testS3() {
  const c = s3Config();
  if (!c.bucket) throw new Error('Не указан bucket');
  await client().send(new HeadBucketCommand({ Bucket: c.bucket }));
  return { ok: true, bucket: c.bucket };
}
