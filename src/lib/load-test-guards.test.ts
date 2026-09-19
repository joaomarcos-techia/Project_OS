import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertEphemeralScratchTarget,
  assertEphemeralTempDirectory,
  assertLoadTestConfirmation,
  assertSafeSchemaSource,
} from '../../scripts/load-test-guards';

describe('load-test fail-closed guards', () => {
  it('requires the exact explicit confirmation', () => {
    expect(() => assertLoadTestConfirmation(undefined)).toThrow(/LOCAL_SCRATCH_ONLY/u);
    expect(() => assertLoadTestConfirmation('yes')).toThrow(/LOCAL_SCRATCH_ONLY/u);
    expect(() => assertLoadTestConfirmation('LOCAL_SCRATCH_ONLY')).not.toThrow();
  });

  it('rejects production signals and a source without TLS', () => {
    const dev = 'postgresql://user:secret@dev.example.test:6543/postgres?sslmode=require';
    expect(() => assertSafeSchemaSource({ sourceUrl: dev, productionUrl: dev })).toThrow(
      /DATABASE_URL_PROD/u,
    );
    expect(() =>
      assertSafeSchemaSource({
        sourceUrl: dev,
        productionUrl: 'postgresql://other:rotated@dev.example.test:6543/postgres?sslmode=require',
      }),
    ).toThrow(/DATABASE_URL_PROD/u);
    expect(() => assertSafeSchemaSource({ sourceUrl: dev, projectEnv: 'prod' })).toThrow(
      /SUPABASE_PROJECT_ENV=prod/u,
    );
    expect(() =>
      assertSafeSchemaSource({
        sourceUrl: 'postgresql://user:secret@production.example.test:6543/postgres?sslmode=require',
      }),
    ).toThrow(/produção/u);
    expect(() =>
      assertSafeSchemaSource({ sourceUrl: 'postgresql://user:secret@dev.example.test/postgres' }),
    ).toThrow(/sslmode=require/u);
  });

  it('accepts only a TLS loopback database with the disposable prefix', () => {
    const source = 'postgresql://user:secret@dev.example.test:6543/postgres?sslmode=require';
    expect(() =>
      assertEphemeralScratchTarget(
        'postgresql://postgres@127.0.0.1:55432/clinicaos_load_abc?sslmode=require',
        source,
      ),
    ).not.toThrow();
    expect(() =>
      assertEphemeralScratchTarget(
        'postgresql://postgres@preview.example.test/clinicaos_load_abc?sslmode=require',
        source,
      ),
    ).toThrow(/loopback/u);
    expect(() =>
      assertEphemeralScratchTarget(
        'postgresql://postgres@127.0.0.1:55432/postgres?sslmode=require',
        source,
      ),
    ).toThrow(/clinicaos_load_/u);
  });

  it('allows cleanup only below the OS temp root with the exact prefix', () => {
    const root = resolve('load-test-tmp-root');
    const target = join(root, 'clinicaos-load-abc');
    expect(assertEphemeralTempDirectory(target, root)).toBe(target);
    expect(() => assertEphemeralTempDirectory(root, root)).toThrow(/recusada remoção/u);
    expect(() =>
      assertEphemeralTempDirectory(resolve('load-test-outside', 'clinicaos-load-abc'), root),
    ).toThrow(/recusada remoção/u);
    expect(() => assertEphemeralTempDirectory(join(root, 'outro'), root)).toThrow(
      /recusada remoção/u,
    );
  });
});
