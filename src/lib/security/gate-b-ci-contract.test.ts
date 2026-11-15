import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  syntheticBuildEnvironment,
  validateArchiveNames,
} from '../../../scripts/gate-b-composed-build';
import { verifyCipherHash, verifySyntheticSnapshot } from '../../../scripts/gate-b-synthetic-ci';

describe('dedicated synthetic CI boundaries', () => {
  it('does not inherit Production, CI, provider or personal configuration credentials', () => {
    const env = syntheticBuildEnvironment(
      {
        NODE_ENV: 'development',
        PATH: '/synthetic/bin',
        HOME: '/personal',
        DATABASE_URL_PROD: 'must-not-survive',
        ABACATEPAY_API_KEY: 'must-not-survive',
        GH_TOKEN: 'must-not-survive',
        SENTRY_AUTH_TOKEN: 'must-not-survive',
        VERCEL_TOKEN: 'must-not-survive',
        NODE_OPTIONS: '--import=untrusted',
        npm_config_userconfig: '/personal/.npmrc',
      },
      '/new-empty-home',
    );
    expect(env.PATH).toBe('/synthetic/bin');
    expect(env.HOME).toBe('/new-empty-home');
    expect(Object.values(env)).not.toContain('must-not-survive');
    expect(env.GH_TOKEN).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.npm_config_userconfig).toBeUndefined();
    expect(env.DATABASE_URL).toContain('127.0.0.1');
  });

  it('rejects traversal, duplicate members, runtime env and excluded TISS migrations', () => {
    const valid = Array.from({ length: 2785 }, (_, i) => `src/sintético-${i}.ts`);
    expect(validateArchiveNames(valid)).toHaveLength(2785);
    for (const invalid of [
      '../outside',
      '/absolute',
      'src\\outside',
      '.env.local',
      'nested/.env',
      'drizzle/migrations/0160_tiss.sql',
      valid[1]!,
    ]) {
      expect(() => validateArchiveNames([invalid, ...valid.slice(1)])).toThrow();
    }
    expect(() => validateArchiveNames(valid.slice(1))).toThrow();
  });

  it('verifies ciphertext bytes before any restore and detects tampering', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'qoro-ci-hash-test-'));
    const file = path.join(dir, 'synthetic.sql.gpg');
    try {
      const contents = Buffer.from('synthetic encrypted envelope contract');
      await writeFile(file, contents);
      const hash = createHash('sha256').update(contents).digest('hex');
      await expect(verifyCipherHash(file, hash)).resolves.toBeUndefined();
      await writeFile(file, Buffer.from('tampered synthetic envelope'));
      await expect(verifyCipherHash(file, hash)).rejects.toThrow('SHA256');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('does not accept structurally incomplete, empty or inconsistent restore evidence', () => {
    for (const invalid of [
      null,
      {},
      { parents: [], orphans: 1 },
      { journal: [{ id: 1, hash: 'wrong' }] },
    ]) {
      expect(() => verifySyntheticSnapshot(invalid, invalid)).toThrow();
    }
  });
});
