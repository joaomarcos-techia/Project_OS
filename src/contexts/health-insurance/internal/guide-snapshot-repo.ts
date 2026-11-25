/**
 * Leitura crua do snapshot aprovado das guias (sem decifrar). Separada de
 * `guide-access.ts` para que só aquele arquivo combine o ciphertext com a
 * decifragem (invariante testada) e para isolar a consulta nos testes.
 */
import 'server-only';

import { and, eq, inArray } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { hiGuideSnapshots, hiGuides, type HiGuideStatus, type HiGuideType } from '../schema-clinic';

export interface ApprovedSnapshotRow {
  guideId: string;
  guideType: HiGuideType;
  number: string;
  status: HiGuideStatus;
  revision: number;
  snapshotId: string | null;
  snapshotRevision: number | null;
  contentEncrypted: string | null;
  contentSha256: string | null;
}

/** Guias da clínica (por id E clínica, sob RLS) com o snapshot aprovado, se houver. */
export async function loadApprovedSnapshots(
  tx: Tx,
  clinicId: string,
  guideIds: readonly string[],
): Promise<ApprovedSnapshotRow[]> {
  if (guideIds.length === 0) return [];
  return tx
    .select({
      guideId: hiGuides.id,
      guideType: hiGuides.guideType,
      number: hiGuides.number,
      status: hiGuides.status,
      revision: hiGuides.revision,
      snapshotId: hiGuideSnapshots.id,
      snapshotRevision: hiGuideSnapshots.revision,
      contentEncrypted: hiGuideSnapshots.contentEncrypted,
      contentSha256: hiGuideSnapshots.contentSha256,
    })
    .from(hiGuides)
    .leftJoin(
      hiGuideSnapshots,
      and(
        eq(hiGuideSnapshots.clinicId, hiGuides.clinicId),
        eq(hiGuideSnapshots.guideId, hiGuides.id),
        eq(hiGuideSnapshots.id, hiGuides.approvedSnapshotId),
      ),
    )
    .where(and(eq(hiGuides.clinicId, clinicId), inArray(hiGuides.id, [...guideIds])));
}
