import {
  resolveSettledCollectionCasesPrivileged,
  upsertCollectionCasePrivileged,
} from '@/lib/financial/collection-case-store';

import type { DunningCandidate } from '../dunning-candidates';
import type { ManualCollectionStage } from '../dunning-policy';

export async function upsertCollectionCase(
  candidate: DunningCandidate,
  stage: ManualCollectionStage,
): Promise<void> {
  await upsertCollectionCasePrivileged(candidate, stage);
}

export async function resolveSettledCollectionCases(clinicId: string): Promise<number> {
  return resolveSettledCollectionCasesPrivileged(clinicId);
}
