import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { FeedbackManager } from '../feedback-manager';
import { guardAdminAccess } from '../../_lib/guard';
import { formatDateTime } from '../../_lib/format';
import { getFeedbackDetail } from '../../_lib/repositories/feedback.repo';

export const metadata: Metadata = { title: 'Feedback' };

const STATUS_LABEL: Record<string, string> = {
  received: 'Recebido',
  under_review: 'Em análise',
  planned: 'Planejado',
  in_development: 'Em desenvolvimento',
  completed: 'Concluído',
  rejected: 'Recusado',
  archived: 'Arquivado',
};

export default async function FeedbackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await guardAdminAccess();
  const { id } = await params;
  const feedback = await getFeedbackDetail(id);
  if (!feedback) notFound();
  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Operação' },
          { label: 'Feedbacks', href: '/admin/feedbacks' },
          { label: feedback.title },
        ]}
        title={feedback.title}
        description={`Enviado por ${feedback.userName ?? 'usuário removido'} · ${feedback.clinicName}`}
      />
      <div className="grid gap-(--sp-4) lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex flex-col gap-(--sp-4)">
          <Card className="p-(--card-pad)">
            <div className="mb-3 flex flex-wrap gap-2">
              <Badge>{feedback.category}</Badge>
              <Badge tone="blue">{feedback.priority}</Badge>
              <Badge tone="violet">{STATUS_LABEL[feedback.status] ?? feedback.status}</Badge>
            </div>
            <p className="whitespace-pre-wrap text-(length:--fs-sm) leading-relaxed">
              {feedback.description}
            </p>
            <dl className="mt-5 grid gap-2 border-t border-border pt-4 text-(length:--fs-xs) text-fg-muted sm:grid-cols-2">
              <div>
                <dt className="font-medium text-fg">Plano atual</dt>
                <dd>{feedback.planName ?? 'Não informado'}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Enviado</dt>
                <dd>{formatDateTime(feedback.createdAt.toISOString())}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Atualizado</dt>
                <dd>{formatDateTime(feedback.updatedAt.toISOString())}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Navegador</dt>
                <dd>{feedback.browser ?? 'Não informado'}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Plataforma</dt>
                <dd>{feedback.platform ?? 'Não informada'}</dd>
              </div>
              <div>
                <dt className="font-medium text-fg">Anexos</dt>
                <dd>Nenhum anexo disponível</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <div className="border-b border-border px-(--card-pad) py-3">
              <h2 className="text-(length:--fs-sm) font-semibold">Histórico</h2>
            </div>
            <ul className="divide-y divide-border">
              {feedback.history.map((item) => (
                <li key={item.id} className="px-(--card-pad) py-3 text-(length:--fs-sm)">
                  <p>
                    {item.action.replace(/_/g, ' ')}
                    {item.toStatus ? ` · ${STATUS_LABEL[item.toStatus] ?? item.toStatus}` : ''}
                  </p>
                  {item.note ? (
                    <p className="mt-1 whitespace-pre-wrap text-fg-muted">{item.note}</p>
                  ) : null}
                  <p className="mt-1 text-(length:--fs-xs) text-fg-subtle">
                    {item.changedByName ?? 'Sistema'} ·{' '}
                    {formatDateTime(item.createdAt.toISOString())}
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <Card className="h-fit p-(--card-pad)">
          <h2 className="mb-3 text-(length:--fs-sm) font-semibold">Gerenciar</h2>
          <FeedbackManager feedbackId={feedback.id} status={feedback.status} />
          <Link
            href="/admin/feedbacks"
            className="mt-4 inline-block text-(length:--fs-xs) text-fg-muted hover:text-fg hover:underline"
          >
            Voltar para a lista
          </Link>
        </Card>
      </div>
    </>
  );
}
