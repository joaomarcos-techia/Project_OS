import { headers } from 'next/headers';

import { buildRequestContext } from '@/lib/audit/request-context';
import { superAdminAction } from '@/lib/audit/super-admin';

import { guardAdminAccess } from '../../_lib/guard';
import {
  exportFeedback,
  isFeedbackCategory,
  isFeedbackOrder,
  isFeedbackStatus,
} from '../../_lib/repositories/feedback.repo';

function csvCell(value: string | null | undefined): string {
  return `"${(value ?? '').replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  await guardAdminAccess();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? undefined;
  const category = searchParams.get('category') ?? undefined;
  const from = searchParams.get('from') ?? undefined;
  const to = searchParams.get('to') ?? undefined;
  const parseDay = (value: string | undefined, endExclusive = false): Date | undefined => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return undefined;
    if (endExclusive) date.setUTCDate(date.getUTCDate() + 1);
    return date;
  };
  const rows = await exportFeedback({
    status: isFeedbackStatus(status) ? status : undefined,
    category: isFeedbackCategory(category) ? category : undefined,
    query: searchParams.get('q') ?? undefined,
    clinicQuery: searchParams.get('clinic') ?? undefined,
    userQuery: searchParams.get('user') ?? undefined,
    createdFrom: parseDay(from),
    createdBefore: parseDay(to, true),
    order: isFeedbackOrder(searchParams.get('order') ?? undefined)
      ? (searchParams.get('order') as 'newest' | 'oldest' | 'priority')
      : 'newest',
  });
  await superAdminAction(
    {
      action: 'feedback.exported',
      targetClinicId: null,
      payload: {
        rowCount: rows.length,
        status: status ?? null,
        category: category ?? null,
        from: from ?? null,
        to: to ?? null,
      },
      requestContext: buildRequestContext(await headers()),
    },
    async () => undefined,
  );
  const body = [
    [
      'id',
      'clinica',
      'autor',
      'titulo',
      'descricao',
      'categoria',
      'prioridade',
      'status',
      'navegador',
      'plataforma',
      'enviado_em',
      'atualizado_em',
    ].join(','),
    ...rows.map((row) =>
      [
        row.id,
        row.clinicName,
        row.userName,
        row.title,
        row.description,
        row.category,
        row.priority,
        row.status,
        row.browser,
        row.platform,
        row.createdAt.toISOString(),
        row.updatedAt.toISOString(),
      ]
        .map((value) => csvCell(value))
        .join(','),
    ),
  ].join('\r\n');
  return new Response(`\uFEFF${body}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="feedbacks.csv"',
      'cache-control': 'no-store',
    },
  });
}
