/**
 * Resolução das credenciais do médico (C7) — P1: resolver SEM validação,
 * validação CRM separada e opt-in.
 *
 *   - resolveDoctorSnapshot(tx, userId)  → lê profiles; crm pode vir null.
 *   - assertDoctorHasCrm(snapshot)        → lança se crm ausente.
 *
 * Quem chama (ver §8 do plano):
 *   signProntuario              → só resolveDoctorSnapshot (R6: assinar NÃO exige CRM)
 *   createPrescription/Document → resolveDoctorSnapshot + assertDoctorHasCrm
 *   regenerate*Pdf              → NENHUM dos dois (usa snapshot persistido na linha)
 */
import { eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';
/* eslint-disable boundaries/element-types -- como tenant-context.ts: profiles é declarado no schema de identity (Drizzle FK precisa morar onde a tabela é declarada); leitura tenant-scoped via tx (RLS aplica). */
import { profiles } from '@/contexts/identity/schema';
/* eslint-enable boundaries/element-types */

import { ClinicalValidationError } from '../errors';

export interface DoctorSnapshot {
  nome: string;
  crm: string | null;
  crmUf: string | null;
  especialidade: string | null;
}

export type DoctorSnapshotWithCrm = DoctorSnapshot & { crm: string };

/** Lê o snapshot do médico (profile do próprio usuário) DENTRO do tx tenant-scoped. */
export async function resolveDoctorSnapshot(tx: Tx, userId: string): Promise<DoctorSnapshot> {
  const [row] = await tx
    .select({
      nome: profiles.nome,
      crm: profiles.crm,
      crmUf: profiles.crmUf,
      especialidade: profiles.especialidade,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!row) {
    throw new ClinicalValidationError('Médico responsável não encontrado no cadastro.');
  }
  return {
    nome: row.nome,
    crm: row.crm ?? null,
    crmUf: row.crmUf ?? null,
    especialidade: row.especialidade ?? null,
  };
}

/** Proíbe documento sem CRM (Regra de negócio R6: prescrição/documentos exigem CRM). */
export function assertDoctorHasCrm(s: DoctorSnapshot): asserts s is DoctorSnapshotWithCrm {
  if (!s.crm || s.crm.trim() === '') {
    throw new ClinicalValidationError(
      'Documento exige CRM cadastrado para o médico responsável. Preencha o CRM no perfil antes de emitir.',
    );
  }
}
