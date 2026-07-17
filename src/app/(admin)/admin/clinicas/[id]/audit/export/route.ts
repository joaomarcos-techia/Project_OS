/**
 * POST /admin/clinicas/[id]/audit/export?from&to (C15).
 *
 * Gera o PDF de auditoria da clínica no período, com SHA256, e devolve a signed
 * URL (7 dias). Write-surface sancionada do painel (junto de actions/impersonation):
 * grava artefato no storage + log audit_export em super_admin_actions. Coberta
 * pelo allowlist do arch test read-only.
 *
 * POST (não GET): a operação MUDA estado (artefato no storage + linha de auditoria).
 * GET seria acionável por CSRF (ex.: <img src=…>); POST + cookie SameSite do Supabase
 * bloqueia requisições cross-site. Os params from/to ficam na query (idempotentes p/
 * o mesmo período via dedup do nome do arquivo).
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { z } from 'zod';

import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';
import { assertPdfExportAllowed } from '@/lib/auth/rate-limit';
import { requireUser } from '@/lib/auth/tenant-context';
import { toErrorResponse } from '@/lib/http/error-response';
import { logger } from '@/lib/observability/logger';

import { guardAdminAccess } from '../../../../_lib/guard';
import { auditExportService } from '../../../../_lib/services/audit-export.service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * B6 — teto do intervalo. A rota renderiza PDF via WASM e varre `audit_events`
 * (particionada por mês); um range de anos força varredura e render enormes, sem
 * rate-limit. 12 meses cobre o caso real (export fiscal/LGPD por exercício).
 */
const MAX_EXPORT_MONTHS = 12;

/**
 * TODA resposta de erro desta rota usa o envelope C16 (`{error, code, message,
 * trace_id, timestamp}`) — um shape só.
 *
 * Deixar o `catch` no envelope e os demais em `{error: '<string>'}` foi um bug real:
 * o cliente lê `data.error`, que no envelope é o **booleano** `true`; React não
 * renderiza booleano, então a caixa de erro aparecia VAZIA e a mensagem do 422
 * ("reduza o intervalo") nunca chegava ao operador. `toErrorResponse` faz duck-type
 * de `code`+`httpStatus`, então um literal basta — sem classe de erro por caso.
 */
function fail(code: string, httpStatus: number, message: string, traceId: string): Response {
  return toErrorResponse({ code, httpStatus, message }, traceId);
}

function monthsBetween(from: Date, to: Date): number {
  const meses =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  return to.getUTCDate() >= from.getUTCDate() ? meses : meses - 1;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  await guardAdminAccess(); // 404 p/ não-super_admin

  // `rc` no topo (não junto do superAdminAction) para que o `trace_id` do envelope
  // seja o MESMO `requestId` que vai para os logs. Sem isso, `toErrorResponse` gera
  // um randomUUID por resposta e o contrato do envelope ("trace_id correlaciona a
  // resposta a logs/audit/Sentry" — error-response.ts) não se cumpre: o operador
  // recebe um id do usuário e não acha nada.
  const rc = buildRequestContext(await headers());
  const traceId = rc.requestId;

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail('clinic_id_invalido', 400, 'Clínica inválida.', traceId);
  }

  const url = new URL(req.url);
  const fromRaw = DateParam.safeParse(url.searchParams.get('from'));
  const toRaw = DateParam.safeParse(url.searchParams.get('to'));
  if (!fromRaw.success || !toRaw.success) {
    return fail('periodo_malformado', 400, 'Datas devem estar no formato AAAA-MM-DD.', traceId);
  }

  const fromIso = new Date(`${fromRaw.data}T00:00:00.000Z`).toISOString();
  const toIso = new Date(`${toRaw.data}T23:59:59.999Z`).toISOString();
  if (new Date(fromIso) > new Date(toIso)) {
    return fail('periodo_invertido', 400, 'A data inicial é posterior à final.', traceId);
  }

  // B6 — 400 acima é sintaxe (malformado / invertido); daqui para baixo é 422:
  // bem-formado, mas não processável.
  if (monthsBetween(new Date(fromIso), new Date(toIso)) >= MAX_EXPORT_MONTHS) {
    return fail(
      'periodo_excede_limite',
      422,
      `Período excede o limite máximo de exportação (${MAX_EXPORT_MONTHS} meses).`,
      traceId,
    );
  }

  // B6: render de PDF + varredura de audit_events são caros; teto por super_admin e
  // por clínica-alvo. Depois das validações baratas, para não gastar orçamento com
  // request malformado.
  const actor = await requireUser();
  // `scope: 'admin'` — balde separado: export de plataforma não consome o orçamento
  // de PDF da clínica-alvo (senão o super_admin barraria os usuários dela).
  const rl = await assertPdfExportAllowed(id, actor.userId, 'admin');
  if (!rl.ok) {
    return fail(
      'rate_limited',
      429,
      'Muitos exports em pouco tempo. Aguarde alguns minutos.',
      traceId,
    );
  }

  try {
    const result = await auditExportService.run({ clinicId: id, from: fromIso, to: toIso });

    await superAdminAction(
      {
        action: 'audit_export',
        targetClinicId: id,
        payload: { from: fromIso, to: toIso, sha256: result.sha256, rowCount: result.rowCount },
        requestContext: rc,
      },
      async () => {},
    );
    return NextResponse.json(result);
  } catch (e) {
    // B1: envelope genérico + trace_id; o detalhe só no observability. Domain error
    // (ex.: AuditExportTooLargeError → 422) mantém a própria mensagem, que é UI-safe.
    // `trace_id` no log E na resposta — é o que torna o par rastreável.
    logger.error('admin.audit_export.error', {
      trace_id: traceId,
      clinicId: id,
      message: e instanceof Error ? e.message : String(e),
    });
    return toErrorResponse(e, traceId);
  }
}
