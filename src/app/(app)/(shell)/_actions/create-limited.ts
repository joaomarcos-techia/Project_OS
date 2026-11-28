'use server';

import { createProcedure } from '@/contexts/scheduling/catalog-actions';
import type { CreateProcedureInput, ProcedureSummary } from '@/contexts/scheduling/types';
import {
  createPrescriptionTemplate,
  duplicatePrescriptionTemplate,
} from '@/contexts/clinical/actions-templates';
import type {
  PrescriptionTemplateInput,
  PrescriptionTemplateSummary,
} from '@/contexts/clinical/types';
import type { SchedulingActionResult } from '@/contexts/scheduling/action-result';
import { trialAccessErrorFrom } from '@/lib/trial-access/policy';

/** UI adapter only: original authenticated domain actions and their contracts stay intact. */
async function limited<T>(run: () => Promise<T>): Promise<SchedulingActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    const trial = trialAccessErrorFrom(error);
    if (trial) return { ok: false, message: trial.message };
    throw error;
  }
}

export async function createProcedureWithTrialLimit(
  input: CreateProcedureInput,
  key: string,
): Promise<SchedulingActionResult<ProcedureSummary>> {
  return limited(() => createProcedure(input, key));
}
export async function createTemplateWithTrialLimit(
  input: PrescriptionTemplateInput,
  key: string,
): Promise<SchedulingActionResult<PrescriptionTemplateSummary>> {
  return limited(() => createPrescriptionTemplate(input, key));
}
export async function duplicateTemplateWithTrialLimit(
  id: string,
  key: string,
): Promise<SchedulingActionResult<PrescriptionTemplateSummary>> {
  return limited(() => duplicatePrescriptionTemplate(id, key));
}
