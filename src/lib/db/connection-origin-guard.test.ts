import { describe, expect, it } from 'vitest';

import { findOriginUsages, type Classify } from './connection-origin-guard';

/**
 * F-01 regression: prove that misuse FAILS detection for every bypass form.
 * A stub classifier marks `@/lib/db` as the origin and `./helper` as a
 * transitively-tainted re-exporter (simulating the arch-check's taint pass).
 */
const classify: Classify = (spec) => ({
  postgresDriver: spec === 'postgres',
  drizzlePgFactory: spec === 'drizzle-orm/postgres-js',
  poolOrigin: spec === '@/lib/db' || spec === './helper',
});

const kinds = (src: string) => findOriginUsages(src, 'src/contexts/x/bad.ts', classify).map((u) => u.kind);

describe('connection-origin-guard (F-01) — detects every bypass form', () => {
  it('1) static import { db }', () => {
    const u = findOriginUsages(`import { db } from '@/lib/db';`, 'f.ts', classify);
    expect(u).toHaveLength(1);
    expect(u[0]!.kind).toBe('pool-import');
    expect(u[0]!.name).toBe('db');
  });

  it('2) dynamic import()', () => {
    expect(kinds(`async function f(){ const m = await import('@/lib/db'); return m; }`)).toContain('dynamic');
  });

  it('3) require()', () => {
    expect(kinds(`const m = require('@/lib/db');`)).toContain('require');
  });

  it('4) re-export export { db } from origin', () => {
    const u = findOriginUsages(`export { db } from '@/lib/db';`, 'f.ts', classify);
    expect(u.some((x) => x.kind === 'pool-reexport' && x.name === 'db')).toBe(true);
  });

  it('4b) re-export * from origin', () => {
    expect(kinds(`export * from '@/lib/db';`)).toContain('pool-reexport');
  });

  it('5) transitive: import { db } from a tainted re-exporter (2 hops)', () => {
    const u = findOriginUsages(`import { db } from './helper';`, 'src/contexts/x/bad.ts', classify);
    expect(u.some((x) => x.kind === 'pool-import' && x.name === 'db')).toBe(true);
  });

  it('6) namespace import of origin', () => {
    expect(kinds(`import * as db from '@/lib/db';`)).toContain('pool-namespace');
  });

  it('7) postgres driver + drizzle factory', () => {
    expect(kinds(`import postgres from 'postgres';`)).toContain('postgres');
    expect(kinds(`import { drizzle } from 'drizzle-orm/postgres-js';`)).toContain('drizzle-pg');
  });

  it('does NOT flag type-only imports or unrelated drizzle helpers', () => {
    expect(findOriginUsages(`import type { Tx } from '@/lib/db';`, 'f.ts', classify)).toHaveLength(0);
    expect(findOriginUsages(`import { sql, eq } from 'drizzle-orm';`, 'f.ts', classify)).toHaveLength(0);
    expect(
      findOriginUsages(`import { withTenant } from '@/lib/db/tenant';`, 'f.ts', classify),
    ).toHaveLength(0);
  });
});
