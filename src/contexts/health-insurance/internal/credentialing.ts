/**
 * Credenciamento por plano e vigência (P2.2): a clínica só fatura numa operadora e num
 * plano em que está credenciada NA DATA do atendimento, e — quando a operadora exige — só
 * com profissional habilitado nela.
 *
 * O que NÃO se presume:
 *  - credenciamento numa operadora não vale para todos os planos: "todos os planos" só
 *    existe se a clínica registrou assim, de propósito (`plan_id` nulo, escolhido na tela);
 *  - credenciamento suspenso, encerrado, futuro ou vencido não vale;
 *  - sem plano informado no atendimento, só o credenciamento de todos os planos confere.
 *
 * Profissional: exigido quando a clínica fatura como pessoa jurídica e a operadora não
 * dispensou (`settings.requireProfessionalCredential`, padrão exigir). Na pessoa física o
 * contratado É o profissional, e o credenciamento da clínica já é o dele.
 *
 * Só leitura, dentro da transação do chamador (RLS da clínica). Devolve pendências com
 * responsável; quem decide o que fazer com elas é a cobertura, a guia ou a solicitação.
 */
import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

import { hiClinicSettings, hiCredentials, hiInsurers } from '../schema-clinic';
import type { GuideIssue } from '../tiss/validation/common';

export interface CredentialCheck {
  clinicId: string;
  insurerId: string;
  planId: string | null;
  /** Profissional que executa (ou solicita); `null` quando não se aplica. */
  professionalId: string | null;
  /** `AAAA-MM-DD` do atendimento (ou da solicitação), no fuso da clínica. */
  date: string;
}

export interface CredentialRow {
  planId: string | null;
  professionalId: string | null;
  validFrom: string;
  validUntil: string | null;
  status: 'active' | 'suspended' | 'ended';
}

export interface CredentialPolicy {
  providerKind: 'PF' | 'PJ' | null;
  requireProfessionalCredential: boolean;
}

/** A operadora dispensa a habilitação do profissional? (P2.5; padrão: não dispensa). */
export function requiresProfessionalCredential(settings: unknown): boolean {
  const v = (settings as { requireProfessionalCredential?: unknown } | null)
    ?.requireProfessionalCredential;
  return v !== false;
}

const covers = (c: CredentialRow, planId: string | null) =>
  c.planId === null || (planId !== null && c.planId === planId);
const inForce = (c: CredentialRow, date: string) =>
  c.validFrom <= date && (c.validUntil === null || c.validUntil >= date);

/**
 * Regra pura (testada sem banco): pendências do credenciamento para o alvo e a data.
 * A mensagem diz o PORQUÊ (suspenso, fora da vigência, só em outro plano), para quem
 * corrige não ter de adivinhar.
 */
export function credentialIssues(
  rows: readonly CredentialRow[],
  check: Omit<CredentialCheck, 'clinicId' | 'insurerId'>,
  policy: CredentialPolicy,
): GuideIssue[] {
  const out: GuideIssue[] = [];
  const explain = (
    target: readonly CredentialRow[],
    who: 'clinic' | 'professional',
  ): GuideIssue | null => {
    const ok = target.some(
      (c) => c.status === 'active' && covers(c, check.planId) && inForce(c, check.date),
    );
    if (ok) return null;
    const samePlan = target.filter((c) => covers(c, check.planId));
    const suspended = samePlan.find((c) => c.status === 'suspended' && inForce(c, check.date));
    const outOfPeriod = samePlan.filter((c) => c.status !== 'suspended' && !inForce(c, check.date));
    const otherPlans = target.filter((c) => !covers(c, check.planId) && c.status === 'active');
    const subject = who === 'clinic' ? 'A clínica' : 'O profissional';
    let why: string;
    if (suspended)
      why = `está com o credenciamento SUSPENSO nesta operadora${check.planId ? ' e plano' : ''}`;
    else if (outOfPeriod.length > 0) {
      const periods = outOfPeriod
        .map((c) => `${c.validFrom} a ${c.validUntil ?? 'sem fim'}`)
        .join('; ');
      why = `não tem credenciamento vigente em ${check.date} (vigências registradas: ${periods})`;
    } else if (otherPlans.length > 0) {
      why = check.planId
        ? 'está credenciado(a) só em outros planos desta operadora'
        : 'está credenciado(a) só em planos específicos; informe o plano do atendimento';
    } else
      why = `não tem credenciamento registrado nesta operadora${check.planId ? ' para este plano' : ''}`;
    return who === 'clinic'
      ? {
          code: 'CREDENTIAL_CLINIC_MISSING',
          field: 'contratado.credenciamento',
          message: `${subject} ${why}. Registre ou ajuste em Convênios › Configuração › Operadora › Credenciamento.`,
          owner: 'gestor',
        }
      : {
          code: 'CREDENTIAL_PROFESSIONAL_MISSING',
          field: 'profissional.credenciamento',
          message: `${subject} ${why}. A operadora exige o profissional habilitado; registre em Convênios › Configuração › Operadora › Credenciamento.`,
          owner: 'gestor',
        };
  };
  const clinicIssue = explain(
    rows.filter((c) => c.professionalId === null),
    'clinic',
  );
  if (clinicIssue) out.push(clinicIssue);
  if (
    policy.providerKind === 'PJ' &&
    policy.requireProfessionalCredential &&
    check.professionalId
  ) {
    const proIssue = explain(
      rows.filter((c) => c.professionalId === check.professionalId),
      'professional',
    );
    if (proIssue) out.push(proIssue);
  }
  return out;
}

/** Lê o credenciamento e a política da clínica/operadora e devolve as pendências. */
export async function credentialingIssuesTx(tx: Tx, check: CredentialCheck): Promise<GuideIssue[]> {
  const [settings] = await tx
    .select({ providerKind: hiClinicSettings.providerKind })
    .from(hiClinicSettings)
    .where(eq(hiClinicSettings.clinicId, check.clinicId))
    .limit(1);
  const [insurer] = await tx
    .select({ settings: hiInsurers.settings })
    .from(hiInsurers)
    .where(and(eq(hiInsurers.clinicId, check.clinicId), eq(hiInsurers.id, check.insurerId)))
    .limit(1);
  const rows = await tx
    .select({
      planId: hiCredentials.planId,
      professionalId: hiCredentials.professionalId,
      validFrom: hiCredentials.validFrom,
      validUntil: hiCredentials.validUntil,
      status: hiCredentials.status,
    })
    .from(hiCredentials)
    .where(
      and(eq(hiCredentials.clinicId, check.clinicId), eq(hiCredentials.insurerId, check.insurerId)),
    );
  return credentialIssues(rows, check, {
    providerKind: settings?.providerKind ?? null,
    requireProfessionalCredential: requiresProfessionalCredential(insurer?.settings),
  });
}
