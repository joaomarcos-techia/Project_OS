import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/ui/page-header';
import type { Crumb } from '@/components/ui/breadcrumbs';

/**
 * Estado "Sem acesso" de uma página tenant.
 *
 * O menu do painel não filtra por permissão — todo módulo aparece para todo
 * mundo e a autorização mora na rota (ADR-047). Sem um estado desenhado, a
 * alternativa vira `AuthError` num Server Component, ou seja, HTTP 500 numa
 * navegação perfeitamente esperada (`OBS-001`).
 *
 * O texto é deliberadamente genérico: não confirma se o recurso existe, quem
 * é o paciente nem qual dado ficou do outro lado. Negativa não é oráculo.
 */
export function PageNoAccess({
  title,
  crumbs,
  description = 'Seu perfil não tem permissão para esta área. Fale com um gestor da clínica se precisar de acesso.',
}: {
  title: string;
  crumbs?: Crumb[];
  description?: string;
}) {
  return (
    <>
      <PageHeader {...(crumbs ? { crumbs } : {})} title={title} />
      <Alert variant="warning" title="Sem acesso">
        {description}
      </Alert>
    </>
  );
}
