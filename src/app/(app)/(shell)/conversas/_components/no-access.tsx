import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';

/**
 * Painel "sem acesso" (ADR-047). O menu do painel não filtra por permissão —
 * todo módulo aparece para todo mundo e a autorização mora na rota. Sem isto,
 * um perfil sem `view:conversations` (ex.: financial) clicaria em "Conversas IA"
 * e receberia um 500 (AuthError não capturado no Server Component). O padrão do
 * repo p/ página que exige permission é renderizar aviso, não lançar — igual a
 * configuracoes/horarios.
 */
export function ConversasNoAccess() {
  return (
    <>
      <PageHeader crumbs={[{ label: 'Gestão' }, { label: 'Conversas IA' }]} title="Conversas IA" />
      <Alert variant="warning" title="Sem acesso">
        Seu perfil não tem permissão para ver as conversas do agente de IA. Fale com um gestor da
        clínica se precisar de acesso.
      </Alert>
    </>
  );
}
