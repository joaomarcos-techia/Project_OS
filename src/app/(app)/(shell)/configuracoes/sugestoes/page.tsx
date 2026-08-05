import { Lightbulb } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { listOwnFeedbackSuggestions } from '@/contexts/feedback/internal/suggestions';

import { FeedbackForm } from './feedback-form';

export const dynamic = 'force-dynamic';

const STATUS: Record<
  string,
  { label: string; tone: 'gray' | 'blue' | 'amber' | 'violet' | 'green' | 'red' }
> = {
  received: { label: 'Recebido', tone: 'gray' },
  under_review: { label: 'Em análise', tone: 'blue' },
  planned: { label: 'Planejado', tone: 'violet' },
  in_development: { label: 'Em desenvolvimento', tone: 'amber' },
  completed: { label: 'Concluído', tone: 'green' },
  rejected: { label: 'Recusado', tone: 'red' },
  archived: { label: 'Arquivado', tone: 'gray' },
};

export default async function SugestoesPage() {
  const user = await requireUser();
  const clinicId = await requireClinicId();
  const suggestions = await listOwnFeedbackSuggestions(clinicId, user.userId);

  return (
    <>
      <PageHeader
        title="Sugestões"
        description="Envie ideias, melhorias ou bugs diretamente para o time do ClinicaOS."
      />
      <div className="grid gap-(--sp-5) xl:grid-cols-[minmax(0,1fr)_minmax(20rem,0.72fr)]">
        <Card>
          <CardContent>
            <FeedbackForm />
          </CardContent>
        </Card>
        <section aria-labelledby="feedback-history" className="flex flex-col gap-3">
          <div>
            <h2 id="feedback-history" className="text-(length:--fs-lg) font-semibold">
              Seus envios
            </h2>
            <p className="text-(length:--fs-sm) text-fg-muted">
              Apenas você visualiza este histórico.
            </p>
          </div>
          {suggestions.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-fg-muted">
                <Lightbulb className="size-6 text-primary" />
                <p className="text-(length:--fs-sm)">Nenhuma sugestão enviada ainda.</p>
              </CardContent>
            </Card>
          ) : (
            suggestions.map((suggestion) => {
              const status = STATUS[suggestion.status] ?? STATUS.received!;
              return (
                <Card key={suggestion.id}>
                  <CardContent className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-(length:--fs-sm) font-semibold">
                        {suggestion.title}
                      </h3>
                      <p className="mt-1 text-(length:--fs-xs) text-fg-muted">
                        {new Intl.DateTimeFormat('pt-BR').format(new Date(suggestion.createdAt))}
                      </p>
                    </div>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </CardContent>
                </Card>
              );
            })
          )}
        </section>
      </div>
    </>
  );
}
