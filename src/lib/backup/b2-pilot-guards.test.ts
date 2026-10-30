import { describe, expect, it } from 'vitest';
import {
  assertChildScope,
  ownedVersion,
  parseAuthorization,
  pilotPrefix,
  PILOT_BUCKET,
  PILOT_CAPABILITIES,
  privateBucket,
  providerRoot,
  uploadEndpoint,
} from './b2-pilot-guards';

const runId = '59c1b905-07b6-4a38-89dc-13f4ec32eab0';
const prefix = pilotPrefix(runId);
const now = Date.now();
const sample = () => ({
  accountId: 'synthetic-account',
  authorizationToken: 'synthetic-token',
  applicationKeyExpirationTimestamp: now + 86400000,
  apiInfo: {
    storageApi: {
      apiUrl: 'https://api005.backblazeb2.com',
      downloadUrl: 'https://f005.backblazeb2.com',
      s3ApiUrl: 'https://s3.us-east-005.backblazeb2.com',
      allowed: {
        buckets: [{ id: 'abc123', name: PILOT_BUCKET }],
        namePrefix: prefix,
        capabilities: [...PILOT_CAPABILITIES],
      },
    },
  },
});

describe('B2 synthetic pilot boundaries (no network)', () => {
  it('accepts exactly the temporary child scope', () => {
    expect(() =>
      assertChildScope(parseAuthorization(sample()), 'abc123', prefix, now),
    ).not.toThrow();
  });
  it.each([
    'https://attacker.example',
    'http://api005.backblazeb2.com',
    'https://api005.backblazeb2.com/?secret=x',
    'https://api005.backblazeb2.com:444',
    'https://user@api005.backblazeb2.com',
    'https://api005.backblazeb2.com.evil.test',
  ])('rejects credential exfiltration endpoint %s', (url) => {
    expect(() => providerRoot(url, 'api')).toThrow();
  });
  it('pins download and S3 roots separately', () => {
    expect(() => providerRoot('https://api005.backblazeb2.com', 'download')).toThrow();
    expect(() => providerRoot('https://s3.us-west-001.backblazeb2.com', 's3')).toThrow();
  });
  it('accepts both documented upload URL forms for the expected bucket', () => {
    expect(
      uploadEndpoint(
        'https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file/abc123/c001',
        'abc123',
      ),
    ).toContain('/abc123/');
    expect(
      uploadEndpoint(
        'https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=c001&bucket=abc123',
        'abc123',
      ),
    ).toContain('bucket=abc123');
  });
  it.each([
    'https://attacker.example/b2api/v4/b2_upload_file/abc123/c001',
    'https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file/other/c001',
    'https://pod-000-1005-03.backblaze.com/b2api/v4/b2_upload_file?cvt=x&bucket=abc123&extra=x',
  ])('rejects untrusted upload URL %s', (url) =>
    expect(() => uploadEndpoint(url, 'abc123')).toThrow(),
  );
  it('rejects broad, wrong-prefix and overprivileged child keys', () => {
    for (const mutation of ['bucket', 'prefix', 'capability']) {
      const auth = parseAuthorization(sample());
      if (mutation === 'bucket') auth.allowed.buckets = null;
      if (mutation === 'prefix') auth.allowed.namePrefix = 'pilot/';
      if (mutation === 'capability')
        auth.allowed.capabilities = [...PILOT_CAPABILITIES, 'writeKeys'];
      expect(() => assertChildScope(auth, 'abc123', prefix, now)).toThrow();
    }
  });
  it.each([null, 0, now, now + 26 * 3600000, 'tomorrow'])(
    'rejects invalid expiry %s',
    (expires) => {
      const auth = parseAuthorization(sample());
      auth.expires = expires;
      expect(() => assertChildScope(auth, 'abc123', prefix, now)).toThrow();
    },
  );
  it('rejects public buckets and wrong identifiers', () => {
    const bucketRow = { bucketId: 'abc123', bucketName: PILOT_BUCKET, bucketType: 'allPrivate' };
    const bucket = { buckets: [bucketRow] };
    expect(privateBucket(bucket)).toBe('abc123');
    expect(() => privateBucket(bucket, 'other')).toThrow();
    bucketRow.bucketType = 'allPublic';
    expect(() => privateBucket(bucket)).toThrow();
  });
  it('never cleans an object whose fixture metadata differs', () => {
    const fixture = {
      fileName: `${prefix}synthetic.qororec`,
      bucketId: 'abc123',
      bytes: 400,
      sha1: 'synthetic-sha1',
      runId,
    };
    const file = {
      ...fixture,
      fileId: 'synthetic-file',
      action: 'upload',
      contentLength: 400,
      contentSha1: fixture.sha1,
      fileInfo: { 'qoro-pilot': runId },
    };
    expect(ownedVersion(file, fixture)).toBe('synthetic-file');
    for (const field of ['fileName', 'bucketId', 'contentLength', 'contentSha1', 'fileInfo']) {
      expect(() => ownedVersion({ ...file, [field]: 'different' }, fixture)).toThrow();
    }
  });
  it.each(['../secret', 'not-a-uuid', runId.toUpperCase()])(
    'rejects unsafe fixture ID %s',
    (id) => {
      expect(() => pilotPrefix(id)).toThrow();
    },
  );
});
