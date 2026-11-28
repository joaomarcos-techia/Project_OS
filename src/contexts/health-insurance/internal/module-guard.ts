/**
 * Interruptor operacional de Convênios (`hi_clinic_settings.enabled`) nas operações que CRIAM ou
 * AVANÇAM trabalho TISS (classe A do parecer de 15/11, noite: docs/convenios/modulo-desligado.md).
 *
 * Política já aprovada, só implementada aqui (não é regra comercial nova):
 *   - ADR-072, item 10: ativação por flag em cada clínica, desligada por padrão;
 *   - docs/convenios/bloqueio-comercial-trial.md: "assinatura paga com o módulo desligado não opera
 *     Convênios" (a flag se SOMA ao gate comercial D24, não o substitui);
 *   - diretriz do fundador de 15/11: módulo desligado não cria nem avança operação TISS por chamada
 *     direta ao servidor.
 *
 * O que NÃO passa por aqui (classes B e C): leitura e download auditados, cancelamento, fatos da
 * operadora sobre trabalho já entregue (protocolo, análise, retorno, glosa, pagamento, recurso),
 * conciliação e repasse. Desligar o módulo não apaga nem esconde nada e não pode impedir de
 * preservar uma obrigação já faturada.
 *
 * Ordem: primeiro a decisão comercial (no trial, a resposta é "contrate"), depois o interruptor.
 */
import { sql } from 'drizzle-orm';

import { assertPremiumFeatureTx, type PremiumSql } from '@/lib/premium-access';

export class ConveniosModuleDisabledError extends Error {
  readonly code = 'convenios_module_disabled';
  constructor() {
    super(
      'Convênios está desligado nesta clínica. Para voltar a operar, a gestão liga o módulo em Convênios › Configuração; os registros já feitos continuam disponíveis para consulta.',
    );
    this.name = 'ConveniosModuleDisabledError';
  }
}

/** Só o interruptor (para quem já fez a checagem comercial por outro caminho). */
export async function assertConveniosModuleEnabledTx(tx: PremiumSql, clinicId: string): Promise<void> {
  const rows = (await tx.execute(
    sql`SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid`,
  )) as unknown as Array<{ enabled: boolean | null }>;
  // Sem linha de configuração = nunca ligado (desligado por padrão).
  if (rows[0]?.enabled !== true) throw new ConveniosModuleDisabledError();
}

/** Operação que cria ou avança trabalho TISS: assinatura paga e ativa (D24) E módulo ligado. */
export async function assertConveniosOperableTx(tx: PremiumSql, clinicId: string): Promise<void> {
  await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
  await assertConveniosModuleEnabledTx(tx, clinicId);
}
