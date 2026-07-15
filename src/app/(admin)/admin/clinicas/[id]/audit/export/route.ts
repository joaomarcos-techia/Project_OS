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

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'clinic id inválido' }, { status: 400 });
  }

  const url = new URL(req.url);
  const fromRaw = DateParam.safeParse(url.searchParams.get('from'));
  const toRaw = DateParam.safeParse(url.searchParams.get('to'));
  if (!fromRaw.success || !toRaw.success) {
    return NextResponse.json({ error: 'from/to devem ser YYYY-MM-DD' }, { status: 400 });
  }

  const fromIso = new Date(`${fromRaw.data}T00:00:00.000Z`).toISOString();
  const toIso = new Date(`${toRaw.data}T23:59:59.999Z`).toISOString();
  if (new Date(fromIso) > new Date(toIso)) {
    return NextResponse.json({ error: 'período invertido' }, { status: 400 });
  }

  // B6 — 400 acima é sintaxe (malformado / invertido); daqui para baixo é 422:
  // bem-formado, mas não processável.
  if (monthsBetween(new Date(fromIso), new Date(toIso)) >= MAX_EXPORT_MONTHS) {
    return NextResponse.json(
      { error: `Período excede o limite máximo de exportação (${MAX_EXPORT_MONTHS} meses).` },
      { status: 422 },
    );
  }

  // B6: render de PDF + varredura de audit_events são caros; teto por super_admin e
  // por clínica-alvo. Depois das validações baratas, para não gastar orçamento com
  // request malformado.
  const actor = await requireUser();
  const rl = await assertPdfExportAllowed(id, actor.userId);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Muitos exports em pouco tempo. Aguarde alguns minutos.' },
      { status: 429 },
    );
  }

  const rc = buildRequestContext(await headers());
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
    logger.error('admin.audit_export.error', {
      clinicId: id,
      message: e instanceof Error ? e.message : String(e),
    });
    return toErrorResponse(e);
  }
}
