/**
 * Política da pendência "convênio sem guia" (P7.4) — pura, sem banco.
 *
 * Decide, a partir dos fatos do atendimento, o que fazer: nada (particular), fechar
 * (guia pronta ou atendimento que deixou de estar concluído), criar ou reavaliar a
 * guia, ou abrir a pendência com o MOTIVO exato, o RESPONSÁVEL e se a recuperação é
 * automática ou humana. Nunca inventa dado: sem cobertura, sem contrato ou sem
 * autorização concedida, a resposta é pendência para uma pessoa, não uma guia
 * faturável.
 */
import { premiumDenialMessage, type PremiumDenial } from '@/lib/premium-access/policy';

import type { GuideIssue } from '../tiss/validation/common';
import type {
  HiBillingGapOwner,
  HiBillingGapReason,
  HiCoverageStatus,
  HiGuideStatus,
} from '../schema-clinic';

export interface CoverageFact {
  id: string;
  status: HiCoverageStatus;
  guideType: 'consulta' | 'sp_sadt';
}

export interface GuideFact {
  id: string;
  status: HiGuideStatus;
  live: boolean;
  items: number;
  issues: GuideIssue[];
  /** Chave de origem do automático (`appointment:<id>:consulta`). */
  automatic: boolean;
  /** Algum usuário já mexeu na guia (histórico do banco). */
  editedByUser: boolean;
}

export interface BillingFacts {
  appointmentStatus: string;
  billingMode: 'particular' | 'convenio';
  hasPatient: boolean;
  /** O atendimento tem procedimento do Qoro (o contrato liga o TUSS a ele). */
  hasProcedure: boolean;
  moduleEnabled: boolean;
  /**
   * Decisão comercial (D24, `qoro_premium_denial`): `null` = assinatura paga e
   * ativa no plano que inclui Convênios. Qualquer motivo = nenhuma guia nova.
   */
  premiumDenial: PremiumDenial | null;
  coverage: CoverageFact | null;
  /** Guias ligadas ao atendimento (pela chave de origem ou por item). */
  guides: GuideFact[];
}

export interface GapSpec {
  reason: HiBillingGapReason;
  owner: HiBillingGapOwner;
  recovery: 'automatic' | 'human';
  issues: GuideIssue[];
  guideId: string | null;
}

export type BillingDecision =
  | { action: 'ignore' }
  | { action: 'close_not_applicable' }
  | { action: 'close_guide_ready'; guideId: string }
  | { action: 'create_guide' }
  | { action: 'refresh_guide'; guideId: string }
  | { action: 'open_gap'; gap: GapSpec };

const human = (
  reason: HiBillingGapReason,
  owner: HiBillingGapOwner,
  issues: GuideIssue[] = [],
  guideId: string | null = null,
): BillingDecision => ({
  action: 'open_gap',
  gap: { reason, owner, recovery: 'human', issues, guideId },
});

const gi = (code: string, field: string, message: string, owner: GuideIssue['owner']): GuideIssue => ({
  code,
  field,
  message,
  owner,
});

const CONTRACT_CODES = new Set([
  'CONTRACT_NOT_FOUND',
  'CONTRACT_AMBIGUOUS',
  'PROCEDURE_NOT_CONTRACTED',
  'PROCEDURE_CODE_AMBIGUOUS',
]);
const MEMBERSHIP_CODES = new Set(['MEMBERSHIP_NOT_ACTIVE', 'MEMBERSHIP_EXPIRED', 'MEMBERSHIP_MISSING']);
const AUTHORIZATION_CODES = new Set([
  'AUTHORIZATION_MISSING',
  'AUTHORIZATION_AMBIGUOUS',
  'AUTHORIZATION_EXPIRED',
]);

/** Motivo e responsável de uma guia em edição, pela pendência mais determinante. */
export function classifyGuideIssues(issues: GuideIssue[]): { reason: HiBillingGapReason; owner: HiBillingGapOwner } {
  if (issues.some((i) => CONTRACT_CODES.has(i.code))) return { reason: 'contract_missing', owner: 'gestor' };
  if (issues.some((i) => MEMBERSHIP_CODES.has(i.code))) return { reason: 'membership_invalid', owner: 'recepcao' };
  if (issues.some((i) => AUTHORIZATION_CODES.has(i.code))) {
    return { reason: 'authorization_pending', owner: 'recepcao' };
  }
  return { reason: 'guide_pending_data', owner: issues[0]?.owner ?? 'financeiro' };
}

/** Guia que conta como "o atendimento entrou no faturamento": viva e fora da edição com pendências. */
export function isBillingReady(g: GuideFact): boolean {
  return g.live && g.status !== 'pending_data' && g.status !== 'cancelled' && g.status !== 'replaced';
}

export interface DecideOptions {
  /** A guia em edição já foi reavaliada nesta passada: agora é classificar. */
  refreshTried?: boolean;
  /** A criação já foi tentada nesta passada e não resultou em guia. */
  createTried?: boolean;
}

export function decideBilling(f: BillingFacts, opts: DecideOptions = {}): BillingDecision {
  if (f.billingMode !== 'convenio') return { action: 'ignore' };
  if (f.appointmentStatus !== 'atendido') return { action: 'close_not_applicable' };

  const ready = f.guides.find(isBillingReady);
  if (ready) {
    // Linha de defesa: a 0147 impede guia conferida sem item; se aparecer, é humano.
    if (ready.items === 0) {
      return human('guide_inconsistent', 'suporte', [
        gi(
          'GUIDE_WITHOUT_ITEMS',
          'guia',
          'A guia está fora da edição e não tem procedimento. Verifique antes de faturar.',
          'gestor',
        ),
      ], ready.id);
    }
    return { action: 'close_guide_ready', guideId: ready.id };
  }

  const pending = f.guides.find((g) => g.live && g.status === 'pending_data');

  // Assinatura não está paga e ativa: nenhuma guia é criada nem reavaliada. A
  // pendência é AUTOMÁTICA (reavaliada a cada 24 h, sem teto): regularizada a
  // assinatura, o reconcile gera a guia sem ninguém precisar lembrar.
  if (f.premiumDenial) {
    return {
      action: 'open_gap',
      gap: {
        reason: 'subscription_inactive',
        owner: 'gestor',
        recovery: 'automatic',
        issues: [
          gi('SUBSCRIPTION_INACTIVE', 'clinica', premiumDenialMessage('health_insurance', f.premiumDenial), 'gestor'),
        ],
        guideId: pending?.id ?? null,
      },
    };
  }

  if (pending) {
    if (!f.moduleEnabled) return human('module_disabled', 'gestor', [], pending.id);
    if (pending.automatic && !pending.editedByUser && !opts.refreshTried) {
      return { action: 'refresh_guide', guideId: pending.id };
    }
    const c = classifyGuideIssues(pending.issues);
    return human(c.reason, c.owner, pending.issues, pending.id);
  }

  if (f.guides.length > 0) {
    // Só guias canceladas ou substituídas sem substituta viva: decisão de quem fatura.
    const last = f.guides[0]!;
    return human('guide_cancelled', 'financeiro', [
      gi(
        'GUIDE_CANCELLED',
        'guia',
        'A guia deste atendimento foi cancelada e não há outra em vigor. Gere uma nova guia ou encerre a pendência com o motivo.',
        'financeiro',
      ),
    ], last.id);
  }

  if (!f.moduleEnabled) {
    return human('module_disabled', 'gestor', [
      gi(
        'MODULE_DISABLED',
        'clinica',
        'O módulo de convênios está desligado nesta clínica; a guia não é gerada.',
        'gestor',
      ),
    ]);
  }
  if (!f.hasPatient || !f.coverage) {
    return human('coverage_missing', 'recepcao', [
      gi(
        'COVERAGE_MISSING',
        'cobertura',
        'O atendimento é de convênio e não tem operadora, plano e carteirinha registrados. Registre a cobertura (correção administrativa).',
        'recepcao',
      ),
    ]);
  }
  if (f.coverage.status === 'cancelled') {
    return human('coverage_cancelled', 'recepcao', [
      gi(
        'COVERAGE_CANCELLED',
        'cobertura',
        'A cobertura deste atendimento está cancelada. Corrija a cobertura ou encerre a pendência com o motivo.',
        'recepcao',
      ),
    ]);
  }
  if (f.coverage.guideType === 'sp_sadt') {
    // P8.7: a sessão que executa um item da solicitação entra na guia SP/SADT. O serviço
    // de execução devolve as pendências específicas (sem solicitação, aguardando a
    // operadora, saldo esgotado, senha vencida, contrato); aqui só a rede de segurança.
    if (opts.createTried) {
      return human('coverage_incomplete', 'recepcao', [
        gi(
          'SADT_NOT_BILLED',
          'solicitacao',
          'A sessão de SP/SADT não entrou em guia. Confira a solicitação, a autorização e o contrato.',
          'recepcao',
        ),
      ]);
    }
    return { action: 'create_guide' };
  }
  if (!f.hasProcedure) {
    return human('contract_missing', 'gestor', [
      gi(
        'APPOINTMENT_WITHOUT_PROCEDURE',
        'atendimento.procedimento',
        'O atendimento não tem procedimento do Qoro; sem ele não há código TUSS nem valor de contrato.',
        'gestor',
      ),
    ]);
  }
  if (f.coverage.status === 'authorization_denied') {
    return human('authorization_denied', 'gestor', [
      gi(
        'AUTHORIZATION_DENIED',
        'autorizacao',
        'A operadora negou a autorização. Decida com o paciente e encerre a pendência com o motivo; nenhuma guia é gerada.',
        'gestor',
      ),
    ]);
  }
  if (opts.createTried) {
    return human('coverage_incomplete', 'recepcao', [
      gi(
        'COVERAGE_INCOMPLETE',
        'cobertura',
        'A guia não pôde ser gerada com a cobertura registrada. Confira operadora, plano e carteirinha.',
        'recepcao',
      ),
    ]);
  }
  return { action: 'create_guide' };
}

/** Teto de tentativas automáticas quando o processamento FALHA (erro técnico). */
export const MAX_AUTOMATIC_ATTEMPTS = 8;
const MINUTE = 60_000;

/**
 * Próxima tentativa. Falha técnica: 15 min × 2^(n−1), teto de 24 h, e para no teto de
 * tentativas (vira humana). Pendência de dado: reavaliação diária (o dado pode ter
 * sido corrigido por outro caminho, como um contrato novo).
 */
export function nextAttemptDelayMs(kind: 'failure' | 'data', attempts: number): number | null {
  if (kind === 'data') return 24 * 60 * MINUTE;
  if (attempts >= MAX_AUTOMATIC_ATTEMPTS) return null;
  return Math.min(15 * MINUTE * 2 ** Math.max(0, attempts - 1), 24 * 60 * MINUTE);
}

/** Código de erro sem dado pessoal (SQLSTATE ou nome da classe), no formato da coluna. */
export function errorCode(e: unknown): string {
  const err = e as { code?: unknown; name?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.code ?? err?.cause?.code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `pg_${code.toLowerCase()}`;
  const name = typeof err?.name === 'string' ? err.name : 'error';
  const slug = name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return slug.slice(0, 64) || 'error';
}
