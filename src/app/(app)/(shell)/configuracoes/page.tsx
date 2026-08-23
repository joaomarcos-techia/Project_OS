import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { SummaryList, type SummaryRow } from '@/components/ui/summary-list';
import { requireUser } from '@/lib/auth/tenant-context';

import { loadSettingsStatuses } from './settings-data';
import { SettingsSection } from './settings-item';
import { visibleSettingsNavigation } from './settings-navigation';
import { SettingsSectionNav } from './settings-section-nav';

export const dynamic = 'force-dynamic';

/**
 * Hub de configurações.
 *
 * Antes esta rota era um `redirect` para a primeira configuração acessível, e a
 * navegação entre as demais morava numa barra lateral própria — a segunda de uma
 * tela que já tinha uma. Quem chegava aqui caía dentro de um formulário sem
 * nunca ver o mapa do que dá para configurar.
 *
 * Agora ela é o mapa: seções por domínio, uma linha por configuração, status
 * onde existe status. Nenhuma rota mudou de lugar — o hub só torna visível o
 * que já existia, e cada gate de permissão continua sendo aplicado pela página
 * de destino. O filtro daqui é de ANÚNCIO (não oferecer o que não se pode
 * abrir), nunca de autorização.
 */
export default async function ConfiguracoesPage() {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );
  const visibleHrefs = new Set(groups.flatMap((group) => group.items.map((item) => item.href)));
  const statuses = await loadSettingsStatuses(visibleHrefs, user.role);

  // A visão geral não é um resumo inventado da tela: são exatamente os itens que
  // reportam estado real. Sem status disponível, a seção não aparece.
  const overview: SummaryRow[] = groups
    .flatMap((group) => group.items)
    .flatMap((item) => {
      const status = statuses[item.href];
      if (!status) return [];
      return [
        {
          label: item.label,
          value: (
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
          ),
        },
      ];
    });

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Gerencie as configurações da sua clínica e personalize como o Qoro funciona para a sua equipe."
        className="mb-(--sp-4)"
      />

      <SettingsSectionNav sections={groups.map(({ id, label }) => ({ id, label }))} />

      {overview.length > 0 ? (
        <section aria-labelledby="settings-overview-title" className="mt-(--sp-6)">
          <h2
            id="settings-overview-title"
            className="text-(length:--fs-section) font-semibold tracking-tight"
          >
            Visão geral
          </h2>
          <Card className="mt-(--sp-3) px-(--card-pad) py-(--sp-3)">
            <SummaryList rows={overview} />
          </Card>
        </section>
      ) : null}

      <div className="mt-(--sp-8) flex flex-col gap-(--sp-8)">
        {groups.map((group) => (
          <SettingsSection key={group.id} group={group} statuses={statuses} />
        ))}
      </div>
    </>
  );
}
