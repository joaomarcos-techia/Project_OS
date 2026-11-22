import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import type { TrialAccessSnapshot } from '@/lib/trial-access';
import { isTrialResource, TRIAL_RESOURCE_LIMITS } from '@/lib/trial-access/policy';

export function TrialAccessNotice({ snapshot }: { snapshot: TrialAccessSnapshot | null }) {
  if (!snapshot?.restricted) return null;
  return (
    <Alert variant="info" title="Avaliação do sistema">
      <p>
        WhatsApp, conexão com Asaas e convites de equipe serão liberados após a confirmação do
        pagamento da assinatura.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1" aria-label="Uso da avaliação">
        {Object.entries(TRIAL_RESOURCE_LIMITS).map(([metric, definition]) => (
          <li key={metric}>
            {definition.label}:{' '}
            <strong className="tabular-nums">
              {isTrialResource(metric) ? (snapshot.usage[metric] ?? 0) : 0}/{definition.limit}
            </strong>
          </li>
        ))}
      </ul>
      <p className="mt-2">
        As cotas são totais da avaliação; excluir ou cancelar não devolve a cota. Receitas e outros
        documentos compartilham o limite de 15. Após pagar, permanecem as vagas de médicos e equipe
        do plano.
      </p>
      <Link href="/configuracoes/assinatura" className="mt-2 inline-block underline">
        Ver minha assinatura
      </Link>
    </Alert>
  );
}
