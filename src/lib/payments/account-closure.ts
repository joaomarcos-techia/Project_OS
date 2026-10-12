/**
 * Encerramento definitivo da conta Asaas pausada — decisão de 07/10/2026.
 *
 * Uma conta pausada guarda a chave cifrada e o webhook para conciliar o que
 * ainda pode acontecer com cobranças antigas. Guardar para sempre uma chave que
 * movimenta o dinheiro da clínica é risco; por isso ela pode ser encerrada:
 *
 *   - pela clínica, a qualquer momento, quando nada está em aberto;
 *   - automaticamente, depois de 180 dias sem movimentação, com aviso por e-mail
 *     30 dias antes. Movimentação nova invalida o aviso e reinicia a contagem.
 *
 * "Em aberto" é o que ainda pode exigir a conta: link de pagamento pagável,
 * devolução ao paciente sem confirmação e contestação em andamento.
 *
 * Funções puras: o account-store lê o estado e o cron decide com elas.
 */

export const CLOSURE_INACTIVITY_DAYS = 180;
export const CLOSURE_NOTICE_DAYS = 30;

const DAY_MS = 86_400_000;

export interface PaymentAccountClosureBlockers {
  /** Cobranças com link ainda pagável (`pending`). */
  openLinks: number;
  /** Devoluções devidas ao paciente sem confirmação do Asaas. */
  pendingRefunds: number;
  /** Contestação ou chargeback em andamento. */
  openDisputes: number;
}

export function hasClosureBlockers(blockers: PaymentAccountClosureBlockers): boolean {
  return blockers.openLinks > 0 || blockers.pendingRefunds > 0 || blockers.openDisputes > 0;
}

export interface PaymentAccountClosureSchedule {
  /** A partir de quando o aviso deve sair (150 dias sem movimentação). */
  noticeDueAt: Date;
  /** Quando o encerramento automático pode acontecer, considerando o aviso. */
  closeAt: Date;
  /** Há aviso enviado DEPOIS da última movimentação. */
  noticeValid: boolean;
  /** O cron deve enviar o aviso agora. */
  noticeDue: boolean;
  /** O cron pode encerrar agora (se nada estiver em aberto). */
  closeDue: boolean;
}

export function closureSchedule(input: {
  lastActivityAt: Date;
  noticeSentAt: Date | null;
  now: Date;
}): PaymentAccountClosureSchedule {
  const now = input.now.getTime();
  const inactivityEnd = input.lastActivityAt.getTime() + CLOSURE_INACTIVITY_DAYS * DAY_MS;
  const noticeDueAt = inactivityEnd - CLOSURE_NOTICE_DAYS * DAY_MS;
  const noticeSentAt = input.noticeSentAt?.getTime() ?? null;
  const noticeValid = noticeSentAt !== null && noticeSentAt >= input.lastActivityAt.getTime();
  // Sem aviso válido, ele sai no próximo cron a partir de `noticeDueAt`, e o
  // encerramento só pode vir 30 dias depois dele.
  const noticeAt = noticeValid ? noticeSentAt : Math.max(now, noticeDueAt);
  const closeAt = Math.max(inactivityEnd, noticeAt + CLOSURE_NOTICE_DAYS * DAY_MS);
  return {
    noticeDueAt: new Date(noticeDueAt),
    closeAt: new Date(closeAt),
    noticeValid,
    noticeDue: !noticeValid && now >= noticeDueAt,
    closeDue: noticeValid && now >= closeAt,
  };
}
