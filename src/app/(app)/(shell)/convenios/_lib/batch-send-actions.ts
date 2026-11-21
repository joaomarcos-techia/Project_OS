'use server';

/**
 * P9.4 — pedir o envio do lote exportado pelo webservice HOMOLOGADO da operadora. O pedido vai ao
 * outbox com a chave `hi-batch-send:<lote>:v<versão>` (um envio por versão, por mais cliques que
 * haja) e é processado logo depois da resposta; o cron é a reserva. Sem operadora homologada
 * (produção hoje), o serviço recusa e a tela nem mostra o botão.
 */
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { HEALTH_INSURANCE_EVENTS } from '@/contexts/health-insurance';
import { BatchConnectorSendError, requestBatchConnectorSendTx } from '@/contexts/health-insurance/internal/batch-connector-send';
import { ConveniosModuleDisabledError } from '@/contexts/health-insurance/internal/module-guard';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { AuthError, requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { premiumAccessErrorFrom, premiumDenialMessage } from '@/lib/premium-access';

import { processOutboxSoon } from './outbox-now';

type Result = { ok: true; data: string } | { ok: false; error: string };

export async function requestBatchConnectorSendAction(input: { batchId: string; version: number }): Promise<Result> {
  try {
    const d = z.object({ batchId: z.string().uuid(), version: z.number().int().min(1) }).parse(input);
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    const clinicId = await requireClinicId();
    const rc = await requestContext();
    const { key } = await withTenant(
      clinicId,
      (tx) => requestBatchConnectorSendTx(tx, { clinicId, batchId: d.batchId, version: d.version, userId: user.userId, requestContext: rc }),
      user.userId,
    );
    processOutboxSoon('batch_send', [{ eventType: HEALTH_INSURANCE_EVENTS.BATCH_SEND_REQUESTED, idempotencyKeys: [key] }]);
    revalidatePath('/convenios', 'layout');
    return { ok: true, data: 'Envio pelo webservice na fila; a tela mostra o recibo quando a operadora responder.' };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: 'Seu perfil não tem permissão para enviar o lote.' };
    const premium = premiumAccessErrorFrom(error);
    if (premium) return { ok: false, error: premiumDenialMessage(premium.feature, premium.reason) };
    if (error instanceof ConveniosModuleDisabledError || error instanceof BatchConnectorSendError) return { ok: false, error: error.message };
    return { ok: false, error: 'Não foi possível pedir o envio agora. Tente de novo.' };
  }
}
