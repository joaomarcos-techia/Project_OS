/**
 * Trilha de LEITURA de prontuário (LGPD — auditoria 2026-09-10, peso 5).
 *
 * ===================================================================
 * Por que este arquivo existe
 * ===================================================================
 * `audit_events` cobria MUTAÇÃO e o download de PDF clínico
 * (`serveClinicalPdf` → `clinical.*.pdf_accessed`), mas a leitura que
 * DECIFRA o SOAP na tela não deixava rastro: `getProntuarioById` e
 * `getProntuarioByAppointment` chamam `toProntuarioDetail`, que roda
 * `decryptJson` sobre `content_encrypted`. Um colaborador com
 * `view:prontuario` abria o prontuário de qualquer paciente da clínica e
 * o único registro era o log de acesso HTTP — sem quem, sem qual
 * prontuário, sem quando, sem tela de origem. O titular do dado é o
 * paciente, que não escolheu o SSO da clínica; sem trilha de leitura não
 * há como responder "quem viu meu prontuário".
 *
 * Duas decisões:
 *
 *  1. IDENTIDADE VEM DA SESSÃO, NUNCA DO CALLER. `userId` e o flag de
 *     impersonate saem de `requireUser()` (cache por request — custo zero
 *     depois do gate). O `clinicId` continua vindo do gate do caller, que
 *     é a mesma fonte usada para a consulta: se a trilha usasse outro
 *     escopo, ela registraria uma leitura que não aconteceu.
 *
 *  2. FAIL-CLOSED, igual à mutação. O INSERT do audit vai na MESMA tx da
 *     leitura; se ele falhar, a leitura falha junto e o SOAP não chega à
 *     tela. É a política "no audit, no op" de `logAudit` aplicada ao lado
 *     de leitura — trocar por best-effort transformaria a trilha em
 *     decoração no exato momento em que ela importa.
 *
 * O `after` registra SÓ metadado operacional (tela de origem, status,
 * versão). Nunca conteúdo clínico, nome, CPF nem id de paciente em claro
 * além do próprio `resource_id` — `sanitizePayload` roda depois disso, mas
 * não é desculpa para mandar prontuário para dentro do log.
 *
 * Server-only. Todo leitor de prontuário DECIFRADO fora do próprio
 * contexto Clinical passa por aqui — invariante travada por
 * `prontuario-access.test.ts`.
 */
import 'server-only';

import { recordImpersonationAudit } from '@/lib/audit/impersonation-extra';
import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { and, eq } from 'drizzle-orm';

import { toProntuarioDetail } from './queries';
import { prontuarios } from './schema';
import type { ProntuarioDetail } from './types';

/**
 * Tela que originou a leitura. É o "motivo" operacional exigido pelo
 * registro de tratamento: um valor NOMEADO no servidor, não string livre
 * do cliente. Ampliar exige commit — é isso que mantém a trilha legível.
 */
export type ProntuarioReadSurface = 'prontuario_editor' | 'consultorio_atendimento';

/** Seletor do prontuário. Nunca aceita `clinicId` — ele vem do gate. */
type ProntuarioSelector = { prontuarioId: string } | { appointmentId: string };

/**
 * Lê um prontuário DECIFRADO e grava `clinical.prontuario.viewed` na mesma
 * transação. Devolve `null` quando não existe no tenant — nesse caso não há
 * leitura de dado clínico e, portanto, nada a auditar.
 *
 * @param clinicId Escopo EFETIVO já resolvido pelo gate do caller
 *                 (`resourceGate`/`requireUser`), nunca um id de payload.
 */
export async function readProntuarioAudited(
  clinicId: string,
  surface: ProntuarioReadSurface,
  selector: ProntuarioSelector,
): Promise<ProntuarioDetail | null> {
  // Autoridade da trilha: quem está logado agora, não quem o caller diz ser.
  const user = await requireUser();
  const context = await requestContext();

  const { detail, auditEventId } = await withTenant(clinicId, async (tx) => {
    const [row] = await tx
      .select()
      .from(prontuarios)
      .where(
        and(
          eq(prontuarios.clinicId, clinicId),
          'prontuarioId' in selector
            ? eq(prontuarios.id, selector.prontuarioId)
            : eq(prontuarios.appointmentId, selector.appointmentId),
        ),
      )
      .limit(1);
    if (!row) return { detail: null, auditEventId: null };

    // Decifra DEPOIS de existir a linha e ANTES do INSERT do audit: o mesmo
    // rollback que desfaz a trilha impede a resposta de sair da função.
    const decrypted = await toProntuarioDetail(clinicId, row);
    const id = await logAudit(tx, {
      clinicId,
      userId: user.userId,
      action: 'clinical.prontuario.viewed',
      resourceType: 'prontuario',
      resourceId: decrypted.id,
      before: null,
      after: { surface, status: decrypted.status, version: decrypted.version },
      requestContext: context,
    });
    return { detail: decrypted, auditEventId: id };
  });

  // Suporte entrando no registro de outra clínica: além do audit_events com
  // user_id do super_admin, deixa o cross-reference em super_admin_actions —
  // mesma correlação que a mutação impersonada já tinha. Best-effort por
  // contrato do helper (a leitura já commitou; o registro primário existe).
  const impersonation = user.session?.impersonation;
  if (impersonation && auditEventId) {
    await recordImpersonationAudit({
      impersonationId: impersonation.impersonationId,
      auditEventId,
      superAdminId: user.userId,
      clinicId,
      action: 'clinical.prontuario.viewed',
      resourceType: 'prontuario',
      resourceId: detail?.id ?? null,
      requestContext: context,
    });
  }

  return detail;
}
