/**
 * Direitos de Convênios (matriz I.2, P1.12-b; docs/convenios/matriz-permissoes-i2.md §3–§4 e §10,
 * decisões D-1 a D-8 aprovadas pelo fundador em 16/11/2026).
 *
 * Fonte ÚNICA de "quem pode o quê" no módulo: as server actions, as leituras auditadas e as telas
 * derivam daqui. A tela só esconde; quem decide é o servidor (o mesmo `allows` roda nas actions).
 *
 *   view:convenios               entrar no módulo; sem visão ampla = só as próprias guias (posse)
 *   manage:convenios             cadastro e configuração, preços de contrato (D-1), política de
 *                                repasse (D-2)
 *   operate:convenios            recepção: carteirinha, cobertura, autorização, solicitação SP/SADT,
 *                                conferir e corrigir a guia (sem valores)
 *   view:faturamento_convenio    ver valores, lotes, glosas, recursos, pagamentos, repasses
 *   manage:faturamento_convenio  aprovar e emitir, reabrir, cancelar, lotes e XML, glosas, recursos,
 *                                conciliação e repasses
 *
 * Posse (D-3, D-4): quem só tem `view:convenios` (a médica no pacote padrão) vê só as guias em que
 * é executante ou solicitante, sem valores (D-4: ocultos por padrão; a visão de valores se concede
 * pelo controle administrativo que já existe, o override individual de
 * `view:faturamento_convenio`, auditado e por clínica). Carteirinha e cobertura, só nos
 * atendimentos dela (D-3, opção B), conferido no servidor.
 *
 * Arquivo PURO (sem banco, sem sessão): testável e importável pela tela e pelo servidor.
 */
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';

/** Regras: a pessoa precisa de QUALQUER UM dos códigos listados. */
export const CONVENIOS_RULES = {
  view: [PERMISSIONS.VIEW_CONVENIOS],
  configure: [PERMISSIONS.MANAGE_CONVENIOS],
  operate: [PERMISSIONS.OPERATE_CONVENIOS],
  /** Conferir, devolver e corrigir a Consulta: recepção ou faturamento. */
  operateOrBill: [PERMISSIONS.OPERATE_CONVENIOS, PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO],
  seeValues: [PERMISSIONS.VIEW_FATURAMENTO_CONVENIO],
  bill: [PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO],
  /** Ler comprovante de autorização (matriz 4.2). */
  readReceipt: [PERMISSIONS.OPERATE_CONVENIOS, PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO],
  /**
   * PDF e XML emitidos. D-5 em três fases: até a via de atendimento ser validada (fase 2), a
   * recepção mantém o acesso que tinha (nada é ampliado nem retirado); a fase 3 troca esta regra
   * por `seeValues`. A médica não tinha e continua sem.
   */
  emittedDocuments: [PERMISSIONS.VIEW_FATURAMENTO_CONVENIO, PERMISSIONS.OPERATE_CONVENIOS],
  /** Cobrança Asaas da coparticipação do PACIENTE: continua no financeiro (matriz 4.3, sem mudança). */
  patientCharge: [PERMISSIONS.MANAGE_FINANCIAL],
} as const satisfies Record<string, readonly Permission[]>;

export type ConveniosRule = keyof typeof CONVENIOS_RULES;

export function allows(permissions: readonly string[], rule: ConveniosRule): boolean {
  return CONVENIOS_RULES[rule].some((p) => permissions.includes(p));
}

export interface ConveniosRights {
  view: boolean;
  configure: boolean;
  operate: boolean;
  seeValues: boolean;
  bill: boolean;
  /** Vê a clínica inteira (operar ou faturamento). Sem isso, só as próprias guias. */
  broad: boolean;
  readReceipt: boolean;
  emittedDocuments: boolean;
  patientCharge: boolean;
}

export function conveniosRights(permissions: readonly string[]): ConveniosRights {
  const has = (p: Permission) => permissions.includes(p);
  const operate = has(PERMISSIONS.OPERATE_CONVENIOS);
  const seeValues = has(PERMISSIONS.VIEW_FATURAMENTO_CONVENIO);
  const bill = has(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
  return {
    view: has(PERMISSIONS.VIEW_CONVENIOS),
    configure: has(PERMISSIONS.MANAGE_CONVENIOS),
    operate,
    seeValues,
    bill,
    broad: operate || seeValues || bill,
    readReceipt: allows(permissions, 'readReceipt'),
    emittedDocuments: allows(permissions, 'emittedDocuments'),
    patientCharge: allows(permissions, 'patientCharge'),
  };
}

/** Escopo de leitura das guias: clínica inteira ou só as próprias (posse por executante/solicitante). */
export type GuideScope = { kind: 'clinic' } | { kind: 'own'; professionalId: string };

export function guideScopeFor(rights: ConveniosRights, userId: string): GuideScope {
  return rights.broad ? { kind: 'clinic' } : { kind: 'own', professionalId: userId };
}

/**
 * Regra de cada escrita das actions, pelo nome do evento de auditoria. Falha FECHADA: um evento sem
 * regra aqui é recusado no servidor (`ruleForAuditAction` lança), e o teste estático cobre todos os
 * eventos de `actions.ts`.
 */
const WRITE_RULE_BY_PREFIX: ReadonlyArray<readonly [string, ConveniosRule]> = [
  // Conferência e correção (recepção ou faturamento).
  ['health_insurance.guide.reviewed', 'operateOrBill'],
  ['health_insurance.guide.returned', 'operateOrBill'],
  ['health_insurance.guide.consulta_fields_updated', 'operateOrBill'],
  // Faturamento.
  ['health_insurance.guide.cancelled', 'bill'],
  ['health_insurance.guide.reconciled', 'bill'],
  ['health_insurance.guide.substitution', 'bill'],
  ['health_insurance.batch.', 'bill'],
  ['health_insurance.gloss.', 'bill'],
  ['health_insurance.appeal.', 'bill'],
  ['health_insurance.payment.', 'bill'],
  ['health_insurance.payout.review_', 'bill'],
  ['health_insurance.payout.policy_changed', 'configure'],
  ['health_insurance.payout.', 'bill'],
  // Recepção.
  ['health_insurance.sadt_request.', 'operate'],
  ['health_insurance.authorization.', 'operate'],
  // Cobrança do paciente (Asaas).
  ['health_insurance.copay.charge_', 'patientCharge'],
];

export function ruleForAuditAction(action: string): ConveniosRule {
  const hit = WRITE_RULE_BY_PREFIX.find(([prefix]) => action.startsWith(prefix));
  if (!hit) throw new Error(`ação de Convênios sem regra de permissão: ${action}`);
  return hit[1];
}
