import { describe, expect, it } from 'vitest';

import { planTissStorageReconcile } from './tiss-file-access';

const C = '11111111-1111-4111-8111-111111111111';
const now = new Date('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe('P12.7 — consistência banco × armazenamento', () => {
  it('registro sem objeto é "ausente" (crítico); objeto sem registro fora da carência é órfão', () => {
    const plan = planTissStorageReconcile(
      [
        { fileId: 'f1', ref: `${C}/a` },
        { fileId: 'f2', ref: `${C}/b` },
      ],
      [
        { ref: `${C}/a`, createdAt: hoursAgo(100) },
        { ref: `${C}/x`, createdAt: hoursAgo(48) },
        { ref: `${C}/y`, createdAt: hoursAgo(2) },
      ],
      now,
    );
    expect(plan).toEqual({ missing: [{ fileId: 'f2', ref: `${C}/b` }], orphans: [`${C}/x`], recentOrphans: 1 });
  });

  it('objeto sem data de criação nunca é descartado (na dúvida, fica)', () => {
    const plan = planTissStorageReconcile([], [{ ref: `${C}/z`, createdAt: null }], now);
    expect([plan.orphans, plan.recentOrphans]).toEqual([[], 1]);
  });

  it('objeto referenciado nunca é órfão, por mais antigo que seja (retenção)', () => {
    const plan = planTissStorageReconcile([{ fileId: 'f', ref: `${C}/old` }], [{ ref: `${C}/old`, createdAt: hoursAgo(24 * 3650) }], now, 1);
    expect(plan).toEqual({ missing: [], orphans: [], recentOrphans: 0 });
  });
});
