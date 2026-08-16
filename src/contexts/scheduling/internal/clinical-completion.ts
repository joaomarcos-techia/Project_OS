import 'server-only';

import { sql } from 'drizzle-orm';

import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireFreshPermission } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';

import { SchedulingValidationError } from '../errors';

/**
 * Conclusão clínica ≠ operação de fila (AUTHZ-008).
 *
 * ===================================================================
 * O que o pentest fez
 * ===================================================================
 * Um atendente com `edit:agenda` + `view:consultorio`, SEM
 * `create:prontuario`/`sign:prontuario`, criou um encaixe, chamou e clicou em
 * "Encerrar consulta". O banco registrou `chegou→em_atendimento→atendido` com
 * ZERO prontuários no instante do fechamento. Depois:
 *
 *   - o consumer de `appointment.started` chegou ATRASADO e criou um prontuário
 *     rascunho, vazio, não assinado, com `created_by` = o médico que não
 *     atendeu ninguém;
 *   - `appointment.completed` foi processado e gerou um lançamento financeiro
 *     `pendente` de valor positivo.
 *
 * Ou seja: um perfil não clínico declarou a consulta concluída, produziu
 * cobrança e deixou uma trilha clínica tardia, vazia e atribuída a outra
 * pessoa. Isso quebra segregação de funções, autoria, ordem causal e a
 * confiabilidade médico-legal do prontuário.
 *
 * ===================================================================
 * As duas invariantes
 * ===================================================================
 * 1. QUEM: concluir é ato clínico. `edit:agenda` autoriza mover a fila
 *    (check-in, chamar, falta) — não declarar que houve atendimento. Exigimos
 *    `create:prontuario` FRESH e vínculo com o profissional atribuído, ou
 *    delegação administrativa explícita.
 *
 * 2. O QUÊ: para paciente CADASTRADO não existe `atendido` sem registro
 *    clínico assinado. Walk-in sem paciente permanece fora — não há prontuário
 *    a exigir, e essa é a exceção deliberada do contrato atual.
 *
 * ===================================================================
 * Por que a precondição roda DENTRO da transação
 * ===================================================================
 * `applyTransition` já pegou `FOR UPDATE` no appointment. Conferir o prontuário
 * ali, sob o mesmo lock, faz três coisas de uma vez: fecha a corrida com o
 * worker atrasado, impede o state log de nascer, e — porque o evento é
 * publicado na MESMA transação — impede o lançamento financeiro. Validar antes
 * ou fora do lock deixaria a janela que o pentest explorou.
 */

/** Ator vindo do gate; só o necessário para a decisão. */
export interface ClinicalActor {
  userId: string;
  isSuperAdmin: boolean;
  aal: 'aal1' | 'aal2' | null;
  permissions: readonly string[];
}

/**
 * Delegação clínica explícita: quem administra a clínica (owner/gestor) pode
 * concluir um atendimento de outro profissional. É a MESMA capacidade
 * administrativa usada em AUTHZ-007, e por isso continua observável na matriz
 * de permissões — não é um papel novo inventado aqui.
 */
function hasClinicalDelegation(actor: ClinicalActor): boolean {
  if (actor.isSuperAdmin) return actor.aal === 'aal2';
  return actor.permissions.includes(PERMISSIONS.MANAGE_SETTINGS);
}

/**
 * Regra PURA de QUEM pode concluir — mesma fonte para a UI e para o servidor.
 * Se divergirem, a tela volta a oferecer "Encerrar consulta" para quem o
 * backend nega, que é metade do achado.
 *
 * @param assignedDoctorId profissional atribuído ao appointment.
 */
export function canCompleteClinically(actor: ClinicalActor, assignedDoctorId: string): boolean {
  if (actor.isSuperAdmin) return actor.aal === 'aal2';
  // Capacidade clínica é pré-requisito dos dois caminhos: nem o gestor conclui
  // sem ela, senão "delegação" viraria bypass do ato clínico.
  if (!actor.permissions.includes(PERMISSIONS.CREATE_PRONTUARIO)) return false;
  return actor.userId === assignedDoctorId || hasClinicalDelegation(actor);
}

/**
 * Versão server-side com revalidação no banco. `requireFreshPermission` é
 * exigência do relatório para a conclusão: capacidade revogada há um segundo
 * não pode fechar uma consulta.
 *
 * Lança `AuthError` (403) ou `SchedulingValidationError`. Os callers de Server
 * Action já convertem em resultado controlado.
 */
export async function assertCanCompleteClinically(
  actor: ClinicalActor,
  assignedDoctorId: string,
): Promise<void> {
  await requireFreshPermission(PERMISSIONS.CREATE_PRONTUARIO);
  if (actor.isSuperAdmin) return;
  if (actor.userId === assignedDoctorId) return;
  // Não é o profissional atribuído: exige delegação administrativa, revalidada.
  await requireFreshPermission(PERMISSIONS.MANAGE_SETTINGS);
}

/**
 * Precondição de DADOS: existe prontuário assinado para este atendimento?
 *
 * Executa sob o lock de `applyTransition`, no mesmo tx tenant-scoped.
 *
 * Escolha do estado `assinado` (e não "existe um rascunho"): um rascunho vazio
 * é exatamente o que o worker atrasado produziu no achado. Rascunho não é
 * registro clínico — é intenção. O evento que vira cobrança precisa de um fato
 * assinado por um profissional identificável.
 */
export async function assertClinicalRecordReady(
  tx: Tx,
  clinicId: string,
  appointmentId: string,
): Promise<void> {
  // Leitura direta na tabela de clinical: a invariante é de SCHEDULING (não
  // existe `atendido` sem registro), mas o fato mora lá. Mesma travessia
  // documentada que este contexto já faz com `identity/schema`.
  const rows = await tx.execute<{ status: string }>(
    sql`SELECT status FROM prontuarios
         WHERE clinic_id = ${clinicId}::uuid
           AND appointment_id = ${appointmentId}::uuid
         ORDER BY created_at DESC
         LIMIT 1`,
  );

  const status = rows[0]?.status ?? null;
  if (status === null) {
    throw new SchedulingValidationError(
      'não é possível encerrar: este atendimento ainda não tem prontuário. Registre e assine o prontuário antes de concluir.',
    );
  }
  if (status !== 'assinado') {
    throw new SchedulingValidationError(
      'não é possível encerrar: o prontuário deste atendimento ainda não foi assinado.',
    );
  }
}
