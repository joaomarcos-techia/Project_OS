/**
 * SecretProvider — sources the AES master key(s) and the global lookup salt.
 *
 * Two backends (PlanoAção §5.2 / ADR-012):
 *   - EnvSecretProvider          : dev/test. Reads base64 secrets from env.
 *   - GcpSecretManagerProvider   : production. Reads from Google Secret Manager.
 *
 * The master key is NEVER in `.env` in production (5.7 checklist) and NEVER in
 * the database or source. The interface is async because a real secret manager
 * is a network call; the provider caches the raw secret for the process
 * lifetime (cheap, immutable) while the per-tenant key is derived per call
 * (no derived-key cache — derivation is a single HKDF, microseconds).
 *
 * Server-only: touches node:crypto-adjacent secrets and (in prod) the GCP SDK.
 */
import 'server-only';

import { env, assertCryptoRuntimeReady, resolveCryptoBackend } from '@/lib/env';

export interface SecretProvider {
  /** Raw AES-256 master key bytes for `version`. Must be exactly 32 bytes. */
  getMasterKey(version: number): Promise<Buffer>;
  /** Global HMAC salt for deterministic lookup hashes. */
  getLookupSalt(): Promise<Buffer>;
}

/** Decode a base64 secret and assert a minimum byte length. */
function decodeSecret(name: string, b64: string, minBytes: number): Buffer {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length < minBytes) {
    throw new Error(
      `[crypto] secret ${name} decodes to ${buf.length} bytes; expected >= ${minBytes}. ` +
        `Generate with: openssl rand -base64 ${minBytes}`,
    );
  }
  return buf;
}

class EnvSecretProvider implements SecretProvider {
  private masterByVersion = new Map<number, Buffer>();
  private salt: Buffer | null = null;

  async getMasterKey(version: number): Promise<Buffer> {
    const cached = this.masterByVersion.get(version);
    if (cached) return cached;
    const varName = `CRYPTO_MASTER_KEY_V${version}`;
    // Explicit map (env is strongly typed; no dynamic indexing). Add V3+ here
    // when rotation needs it.
    const raw =
      version === 1 ? env.CRYPTO_MASTER_KEY_V1 : version === 2 ? env.CRYPTO_MASTER_KEY_V2 : undefined;
    if (!raw) {
      throw new Error(
        `[crypto] ${varName} is not set. Cannot decrypt ciphertext written with master-key version ${version}.`,
      );
    }
    // AES-256 key must be exactly 32 bytes.
    const key = decodeSecret(varName, raw, 32);
    if (key.length !== 32) {
      throw new Error(`[crypto] ${varName} must be exactly 32 bytes (got ${key.length}).`);
    }
    this.masterByVersion.set(version, key);
    return key;
  }

  async getLookupSalt(): Promise<Buffer> {
    if (this.salt) return this.salt;
    if (!env.CRYPTO_LOOKUP_SALT) {
      throw new Error('[crypto] CRYPTO_LOOKUP_SALT is not set.');
    }
    // 16 bytes is the floor for a meaningful HMAC salt.
    this.salt = decodeSecret('CRYPTO_LOOKUP_SALT', env.CRYPTO_LOOKUP_SALT, 16);
    return this.salt;
  }
}

class GcpSecretManagerProvider implements SecretProvider {
  private masterByVersion = new Map<number, Buffer>();
  private salt: Buffer | null = null;
  // Lazy SDK handle so dev/test never load @google-cloud/secret-manager.
  private clientPromise: Promise<unknown> | null = null;

  private async client() {
    if (!this.clientPromise) {
      // Runtime-computed specifier: keeps @google-cloud/secret-manager an
      // OPTIONAL prod-only dependency (install it only where backend=gcp).
      // TS/bundler won't statically resolve a variable specifier, so dev/test
      // never need the package present.
      const moduleName = '@google-cloud/secret-manager';
      this.clientPromise = (import(/* webpackIgnore: true */ /* @vite-ignore */ moduleName) as Promise<{
        SecretManagerServiceClient: new () => unknown;
      }>).then((m) => new m.SecretManagerServiceClient());
    }
    return this.clientPromise;
  }

  private async access(secretName: string, version: string): Promise<Buffer> {
    const client = (await this.client()) as {
      accessSecretVersion(req: { name: string }): Promise<[{ payload?: { data?: Uint8Array } }]>;
    };
    const name = `projects/${env.GCP_PROJECT_ID}/secrets/${secretName}/versions/${version}`;
    const [res] = await client.accessSecretVersion({ name });
    const data = res.payload?.data;
    if (!data) throw new Error(`[crypto] GCP secret ${name} has no payload`);
    // Stored base64 (same encoding as env backend) for parity.
    return decodeSecret(secretName, Buffer.from(data).toString('utf8').trim(), 16);
  }

  async getMasterKey(version: number): Promise<Buffer> {
    const cached = this.masterByVersion.get(version);
    if (cached) return cached;
    const key = await this.access(env.GCP_SECRET_MASTER_KEY_NAME!, String(version));
    if (key.length !== 32) {
      throw new Error(`[crypto] GCP master key v${version} must be 32 bytes (got ${key.length}).`);
    }
    this.masterByVersion.set(version, key);
    return key;
  }

  async getLookupSalt(): Promise<Buffer> {
    if (this.salt) return this.salt;
    this.salt = await this.access(env.GCP_SECRET_LOOKUP_SALT_NAME!, 'latest');
    return this.salt;
  }
}

let singleton: SecretProvider | null = null;

/** Process-wide SecretProvider, chosen by CRYPTO_SECRET_BACKEND / NODE_ENV. */
export function getSecretProvider(): SecretProvider {
  if (singleton) return singleton;
  assertCryptoRuntimeReady();
  singleton = resolveCryptoBackend() === 'gcp'
    ? new GcpSecretManagerProvider()
    : new EnvSecretProvider();
  return singleton;
}

/** Test-only: reset the cached singleton. */
export const __testing__ = {
  reset(): void {
    singleton = null;
  },
  setProvider(p: SecretProvider): void {
    singleton = p;
  },
};
