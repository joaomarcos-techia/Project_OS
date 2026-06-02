/**
 * Leitura mínima do nome do paciente para snapshot em documentos legais (C7).
 *
 * Documento médico (prescrição/atestado/etc.) NOMEIA o paciente — exigência
 * legal. O nome é congelado na linha no momento da emissão (R8). Aqui há uma
 * leitura cross-context PONTUAL (sem JOIN, só `nome` por id), DENTRO do tx
 * tenant-scoped (RLS aplica). Mesmo padrão de exceção de tenant-context.ts (profiles).
 */
import { eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
/* eslint-disable boundaries/element-types -- leitura pontual do nome do paciente p/ snapshot legal; sem JOIN; RLS aplica via tx tenant-scoped. */
import { patients } from '@/contexts/patient/schema';
/* eslint-enable boundaries/element-types */

import { ClinicalValidationError } from '../errors';

/** Retorna `patients.nome` (não-criptografado) do paciente no tenant atual. */
export async function resolvePatientNome(tx: Tx, patientId: string): Promise<string> {
  const [row] = await tx
    .select({ nome: patients.nome, deletedAt: patients.deletedAt })
    .from(patients)
    .where(eq(patients.id, patientId))
    .limit(1);
  if (!row || row.deletedAt) {
    throw new ClinicalValidationError('Paciente não encontrado para emissão do documento.');
  }
  return row.nome;
}
