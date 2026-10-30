/** Guards for the synthetic B2 pilot; not a production backup credential policy. */
export const PILOT_BUCKET = 'qoro-recovery-pilot-20261030';
export const PILOT_S3_HOST = 's3.us-east-005.backblazeb2.com';
export const PILOT_CAPABILITIES = [
  'listBuckets',
  'listFiles',
  'readFiles',
  'writeFiles',
  'deleteFiles',
] as const;

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('RESPONSE_SHAPE');
  return Object.fromEntries(Object.entries(value));
}

export function textField(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\x00-\x1f\x7f]/u.test(value))
    throw new Error('RESPONSE_SHAPE');
  return value;
}

export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('RESPONSE_SHAPE');
  return Array.from(value);
}

function httpsUrl(value: unknown): URL {
  const url = new URL(textField(value));
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
    throw new Error('PROVIDER_ENDPOINT');
  return url;
}

export function providerRoot(value: unknown, kind: 'api' | 'download' | 's3'): string {
  const url = httpsUrl(value);
  const validHost =
    kind === 'api'
      ? /^api[0-9]+\.backblazeb2\.com$/u.test(url.hostname)
      : kind === 'download'
        ? /^f[0-9]+\.backblazeb2\.com$/u.test(url.hostname)
        : url.hostname === PILOT_S3_HOST;
  if (!validHost || url.pathname !== '/' || url.search) throw new Error('PROVIDER_ENDPOINT');
  return url.origin;
}

export function uploadEndpoint(value: unknown, bucketId: string): string {
  const url = httpsUrl(value);
  const validHost = /^pod-[a-z0-9-]+\.backblaze\.com$/u.test(url.hostname);
  const pathPrefix = '/b2api/v4/b2_upload_file';
  const validPath = url.pathname.startsWith(`${pathPrefix}/${bucketId}/`) && !url.search;
  const validQuery =
    url.pathname === pathPrefix &&
    url.searchParams.get('bucket') === bucketId &&
    url.searchParams.has('cvt') &&
    [...url.searchParams.keys()].every((k) => k === 'bucket' || k === 'cvt');
  if (!validHost || (!validPath && !validQuery)) throw new Error('UPLOAD_ENDPOINT');
  return url.href;
}

export function pilotPrefix(runId: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(runId))
    throw new Error('RUN_ID');
  return `pilot/${runId}/`;
}

export function parseAuthorization(value: unknown) {
  const auth = record(value);
  const storage = record(record(auth.apiInfo).storageApi);
  providerRoot(storage.s3ApiUrl, 's3');
  return {
    accountId: textField(auth.accountId),
    token: textField(auth.authorizationToken),
    api: providerRoot(storage.apiUrl, 'api'),
    download: providerRoot(storage.downloadUrl, 'download'),
    allowed: record(storage.allowed),
    expires: auth.applicationKeyExpirationTimestamp,
  };
}

export function assertChildScope(
  auth: ReturnType<typeof parseAuthorization>,
  bucketId: string,
  prefix: string,
  now: number,
): void {
  const buckets = list(auth.allowed.buckets);
  if (
    buckets.length !== 1 ||
    record(buckets[0]).id !== bucketId ||
    record(buckets[0]).name !== PILOT_BUCKET ||
    auth.allowed.namePrefix !== prefix
  )
    throw new Error('CHILD_SCOPE');
  const caps = list(auth.allowed.capabilities).map(textField);
  if (
    caps.length !== PILOT_CAPABILITIES.length ||
    PILOT_CAPABILITIES.some((cap) => !caps.includes(cap))
  )
    throw new Error('CHILD_CAPABILITIES');
  if (
    typeof auth.expires !== 'number' ||
    !Number.isSafeInteger(auth.expires) ||
    auth.expires <= now ||
    auth.expires > now + 25 * 60 * 60 * 1000
  )
    throw new Error('CHILD_EXPIRY');
}

export function privateBucket(value: unknown, expectedId?: string): string {
  const buckets = list(record(value).buckets);
  if (buckets.length !== 1) throw new Error('BUCKET_SCOPE');
  const bucket = record(buckets[0]);
  if (
    bucket.bucketName !== PILOT_BUCKET ||
    bucket.bucketType !== 'allPrivate' ||
    (expectedId && bucket.bucketId !== expectedId)
  )
    throw new Error('BUCKET_PRIVATE');
  return textField(bucket.bucketId);
}

export function ownedVersion(
  value: unknown,
  fixture: {
    fileName: string;
    bucketId: string;
    bytes: number;
    sha1: string;
    runId: string;
  },
): string {
  const file = record(value);
  if (
    file.action !== 'upload' ||
    file.fileName !== fixture.fileName ||
    file.bucketId !== fixture.bucketId ||
    file.contentLength !== fixture.bytes ||
    file.contentSha1 !== fixture.sha1 ||
    record(file.fileInfo)['qoro-pilot'] !== fixture.runId
  )
    throw new Error('FIXTURE_OWNERSHIP');
  return textField(file.fileId);
}
