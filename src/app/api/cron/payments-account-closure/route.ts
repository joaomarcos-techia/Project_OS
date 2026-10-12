/**
 * GET /api/cron/payments-account-closure — encerramento da conta Asaas pausada
 * (decisão de 07/10/2026, migration 0115).
 *
 * Diário. Para cada conta pausada sem nada em aberto (link pagável, devolução
 * sem confirmação, contestação em andamento):
 *   - aos 150 dias sem movimentação, avisa os donos por e-mail;
 *   - aos 180, e só se o aviso saiu há 30 dias, encerra: desativa o webhook no
 *     Asaas e apaga a credencial (account-store, sob o lock da pausa).
 * Movimentação nova invalida o aviso e reinicia a contagem. Falha numa clínica
 * não interrompe as outras e é contada no heartbeat.
 *
 * Auth + heartbeat iguais aos demais crons — [cron-auth.ts].
 */
import { listActiveOwnerEmails } from '@/contexts/identity/queries';
import { buildRequestContext } from '@/lib/audit/request-context';
import { recordHeartbeat } from '@/lib/cron-heartbeat';
import { sendTransactionalEmail } from '@/lib/email/resend';
import { renderPaymentAccountClosureNoticeEmail } from '@/lib/email/templates/payment-account-closure-notice';
import { createPaymentSettingsUrl } from '@/lib/http/application-url';
import { withCron } from '@/lib/http/cron';
import { metrics } from '@/lib/observability/metrics';
import { closureSchedule, hasClosureBlockers } from '@/lib/payments/account-closure';
import {
  closePausedPaymentAccount,
  listPausedPaymentAccounts,
  readPaymentAccountClosureState,
  recordPaymentAccountClosureNotice,
} from '@/lib/payments/account-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Teto por execução; o resto sai no dia seguinte. */
const BATCH = 200;

export const GET = withCron(
  {
    job: 'payments-account-closure',
    route: 'payments-account-closure',
    errorEvent: 'payments_account_closure.error',
  },
  async (req) => {
    const now = new Date();
    const requestContext = buildRequestContext(req.headers);
    const accounts = await listPausedPaymentAccounts(BATCH);
    let noticed = 0;
    let closed = 0;
    let blocked = 0;
    let failed = 0;

    for (const account of accounts) {
      try {
        const state = await readPaymentAccountClosureState(account.clinicId);
        if (!state?.paused) continue;
        if (hasClosureBlockers(state.blockers)) {
          blocked += 1;
          continue;
        }
        const schedule = closureSchedule({ ...state, now });
        if (schedule.noticeDue) {
          const recipients = await listActiveOwnerEmails(account.clinicId);
          if (recipients.length === 0) {
            metrics.emit('payments.account_closure.no_recipient', { clinicId: account.clinicId });
            continue;
          }
          const email = renderPaymentAccountClosureNoticeEmail({
            clinicName: account.clinicName,
            closeAt: schedule.closeAt,
            settingsUrl: createPaymentSettingsUrl(),
          });
          // A chave amarra o aviso à janela de inatividade: reexecução no mesmo
          // dia não manda de novo; movimentação nova abre outra janela.
          const window = state.lastActivityAt.toISOString();
          for (const [index, to] of recipients.entries()) {
            await sendTransactionalEmail({
              to,
              ...email,
              idempotencyKey: `payment-account-closure/${account.clinicId}/${window}/${index}`,
            });
          }
          const recorded = await recordPaymentAccountClosureNotice({
            clinicId: account.clinicId,
            recipients: recipients.length,
            closeAt: schedule.closeAt,
            requestContext,
          });
          if (recorded) noticed += 1;
        } else if (schedule.closeDue) {
          const result = await closePausedPaymentAccount({
            clinicId: account.clinicId,
            userId: null,
            trigger: 'inactivity',
            now,
            requestContext,
          });
          if (result.outcome === 'closed') {
            closed += 1;
            metrics.emit('payments.account.closed', {
              clinicId: account.clinicId,
              trigger: 'inactivity',
            });
          }
        }
      } catch {
        failed += 1;
        metrics.emit('payments.account_closure.failed', { clinicId: account.clinicId });
      }
    }

    const detail = { accounts: accounts.length, noticed, closed, blocked, failed };
    metrics.emit('payments.account_closure.run', detail);
    await recordHeartbeat('payments-account-closure', failed > 0 ? 'error' : 'success', detail);
    return Response.json({ ok: failed === 0, ...detail }, { status: 200 });
  },
);
