'use server';

/**
 * R45 — pedir o XML do lote em segundo plano (lotes grandes). O pedido é persistido no
 * outbox na mesma transação da auditoria, com a chave `hi-batch-export:<lote>:v<versão>`:
 * o mesmo lote na mesma versão gera um job só, por mais cliques que haja. O worker lê as
 * guias pela leitura DELEGADA (em nome de quem pediu, permissão conferida de novo na
 * execução) e grava o arquivo pela exportação existente, que é idempotente.
 *
 * Logo depois da resposta o job é processado (o cron é a reserva). A tela do lote mostra
 * o estado do job (na fila, gerando, falhou com o motivo, pronto).
 */
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { HEALTH_INSURANCE_EVENTS } from '@/contexts/health-insurance';
import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { AuthError, requireClinicId, requireFreshPermission, requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { publishEvent } from '@/lib/outbox/publish';
import { premiumAccessErrorFrom, premiumDenialMessage, assertPremiumFeatureTx } from '@/lib/premium-access';

import { processOutboxSoon } from './outbox-now';

type Result = { ok: true; data: string } | { ok: false; error: string };

function batchExportKey(batchId: string, version: number): string {
  return `hi-batch-export:${batchId}:v${version}`;
}

export async function requestBatchExportAction(input: { batchId: string; version: number }): Promise<Result> {
  try {
    const d = z.object({ batchId: z.string().uuid(), version: z.number().int().min(1) }).parse(input);
    const user = await requireUser();
    await requireFreshPermission(PERMISSIONS.MANAGE_FINANCIAL);
    const clinicId = await requireClinicId();
    const rc = await requestContext();
    const key = batchExportKey(d.batchId, d.version);
    const outcome = await withTenant(
      clinicId,
      async (tx) => {
        // D24: pedir exportação é operação nova (o banco confere de novo ao exportar).
        await assertPremiumFeatureTx(tx, clinicId, 'health_insurance');
        const [b] = (await tx.execute(
          sql`SELECT status, version, (SELECT count(*) FROM public.hi_batch_guides g WHERE g.clinic_id = b.clinic_id AND g.batch_id = b.id AND g.active)::int AS guides
                FROM public.hi_batches b WHERE b.clinic_id = ${clinicId}::uuid AND b.id = ${d.batchId}::uuid`,
        )) as unknown as Array<{ status: string; version: number; guides: number }>;
        if (!b) return 'Lote não encontrado nesta clínica.';
        if (b.status !== 'prepared') return 'Só um lote preparado gera XML.';
        if (Number(b.version) !== d.version) return 'O lote mudou desde que a tela foi aberta; recarregue.';
        if (b.guides === 0) return 'O lote não tem guias.';
        await publishEvent(tx, {
          clinicId,
          eventType: HEALTH_INSURANCE_EVENTS.BATCH_EXPORT_REQUESTED,
          payload: { clinicId, batchId: d.batchId, version: d.version, requestedBy: user.userId },
          idempotencyKey: key,
        });
        await logAudit(tx, {
          clinicId,
          userId: user.userId,
          action: 'health_insurance.batch.export_requested',
          resourceType: 'hi_batch',
          resourceId: d.batchId,
          before: null,
          after: { version: d.version, guides: b.guides, mode: 'async' },
          requestContext: rc,
        });
        return null;
      },
      user.userId,
    );
    if (outcome) return { ok: false, error: outcome };
    processOutboxSoon('batch_export', [{ eventType: HEALTH_INSURANCE_EVENTS.BATCH_EXPORT_REQUESTED, idempotencyKeys: [key] }]);
    revalidatePath('/convenios', 'layout');
    return { ok: true, data: 'XML do lote na fila; a tela mostra quando ficar pronto.' };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: 'Seu perfil não tem permissão para gerar o XML do lote.' };
    const premium = premiumAccessErrorFrom(error);
    if (premium) return { ok: false, error: premiumDenialMessage(premium.feature, premium.reason) };
    return { ok: false, error: 'Não foi possível pedir a exportação agora. Tente de novo.' };
  }
}
