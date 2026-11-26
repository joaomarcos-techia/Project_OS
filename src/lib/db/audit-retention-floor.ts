/**
 * S5 / requisitos 58 e 85 da ANS: a trilha de auditoria fica 180 dias sem alteração nem remoção. O gatilho da
 * candidata 0171 recusa UPDATE/DELETE/TRUNCATE em linha, mas DETACH de partição é DDL e passa por cima dele. O
 * único caminho do app que desanexa partição é `pnpm audit:partitions --retain N` (operador): N abaixo de 6 meses
 * desanexaria registros com menos de 180 dias, então é recusado aqui.
 *
 * Com N ≥ 6, só sai partição cujo mês INTEIRO é mais antigo que N meses: o registro mais novo dela tem mais de
 * 6 meses (≥ 181 dias).
 */
export const AUDIT_TRAIL_MIN_RETAIN_MONTHS = 6;

/** `0` = sem retenção (só provisiona). Qualquer outro valor precisa ser inteiro ≥ 6. */
export function assertAuditRetainMonths(n: number): void {
  if (n === 0) return;
  if (!Number.isInteger(n) || n < AUDIT_TRAIL_MIN_RETAIN_MONTHS) {
    throw new Error(
      `--retain ${n} recusado: a trilha de auditoria fica ao menos ${AUDIT_TRAIL_MIN_RETAIN_MONTHS} meses (180 dias, requisitos 58 e 85 da ANS)`,
    );
  }
}
