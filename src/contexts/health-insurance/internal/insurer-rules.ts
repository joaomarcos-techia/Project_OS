/**
 * Regras CONTRATUAIS da operadora (P2.5), guardadas em `hi_insurers.settings`. Puro: lido pelo
 * cadastro, pelo credenciamento, pelos lotes e pelas telas. Nada aqui desliga validação do padrão.
 */
/** Teto do padrão TISS: até 100 guias por lote. A operadora pode exigir menos (contrato). */
export const TISS_MAX_GUIDES_PER_BATCH = 100;

/**
 * P8.4-r (regra 7): a operadora aceita item executado sem solicitação prévia e regularizado depois
 * da sessão? `unknown` é o padrão e NÃO presume aceite: a inclusão pede a confirmação de quem
 * fatura. `forbids` vem do contrato, registrado pela clínica: o item nunca entra na guia dela.
 */
export type InsurerExtraItemsRule = 'unknown' | 'accepts' | 'forbids';
export const INSURER_EXTRA_ITEMS_RULES: readonly InsurerExtraItemsRule[] = ['unknown', 'accepts', 'forbids'];

export interface InsurerRules {
  /** Por contrato: a operadora exige o profissional executante habilitado (padrão: exige). */
  requireProfessionalCredential: boolean;
  /** Por contrato: máximo de guias por lote, de 1 até o teto do padrão (100). */
  maxGuidesPerBatch: number;
  /** Por contrato: prazo, em dias depois do atendimento, para enviar a guia; `null` = sem prazo registrado. */
  submissionDeadlineDays: number | null;
  /** P8.4-r: item executado além do solicitado, regularizado depois da sessão (padrão: desconhecido). */
  extraItemsAfterSession: InsurerExtraItemsRule;
}

/** Lê as regras guardadas na operadora, com os padrões que não presumem nada a mais. */
export function insurerRules(settings: unknown): InsurerRules {
  const s = (settings ?? {}) as Record<string, unknown>;
  const max = Number(s.maxGuidesPerBatch);
  const deadline = s.submissionDeadlineDays;
  return {
    requireProfessionalCredential: s.requireProfessionalCredential !== false,
    maxGuidesPerBatch:
      Number.isInteger(max) && max >= 1 && max <= TISS_MAX_GUIDES_PER_BATCH
        ? max
        : TISS_MAX_GUIDES_PER_BATCH,
    submissionDeadlineDays:
      typeof deadline === 'number' && Number.isInteger(deadline) && deadline >= 1 && deadline <= 365
        ? deadline
        : null,
    extraItemsAfterSession: INSURER_EXTRA_ITEMS_RULES.includes(s.extraItemsAfterSession as InsurerExtraItemsRule)
      ? (s.extraItemsAfterSession as InsurerExtraItemsRule)
      : 'unknown',
  };
}
