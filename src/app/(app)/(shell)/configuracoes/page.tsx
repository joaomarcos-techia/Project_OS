import { requireUser } from '@/lib/auth/tenant-context';
import { PageHeader } from '@/components/ui/page-header';

import { SettingsGroupSection } from './settings-category';
import { loadChannelStatuses, loadGestaoStatuses, loadSettingsMetas } from './settings-data';
import { visibleSettingsNavigation } from './settings-navigation';
import styles from './settings.module.css';

export const dynamic = 'force-dynamic';

/**
 * `/configuracoes` — todas as categorias EMPILHADAS, como na referência de
 * setembro/2026.
 *
 * Antes esta rota era só um `redirect` para a primeira categoria acessível, e o
 * operador tinha de adivinhar em qual aba estava cada coisa. Empilhar responde
 * "o que dá para configurar aqui?" numa rolagem; as rotas de categoria seguem
 * existindo e continuam sendo o destino de cada cartão.
 *
 * O filtro é de ANÚNCIO — não oferecer o que não se pode abrir. O gate real
 * continua em cada rota de destino.
 */
export default async function ConfiguracoesPage() {
  const user = await requireUser();
  const groups = visibleSettingsNavigation(
    user.permissions,
    user.isSuperAdmin && user.aal === 'aal2',
  );

  // Duas dimensões por linha: o STATUS (badge, "preciso olhar isso?") e o META
  // (número, "o que tem lá dentro?"). Vêm de fontes diferentes e cada uma
  // degrada sozinha — sem status a linha perde o selo, sem meta perde o número,
  // e em nenhum dos casos a lista deixa de navegar.
  const [canais, gestao, metas] = await Promise.all([
    loadChannelStatuses(),
    loadGestaoStatuses(),
    loadSettingsMetas(),
  ]);
  const statuses = { ...canais.statuses, ...gestao };
  const rowMetas = { ...metas, ...canais.metas };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administração' }, { label: 'Configurações' }]}
        title="Configurações"
        description="Clínica, operação, integrações, conformidade e conta"
      />
      <div className={styles.groupStack ?? ''}>
        {groups.map((group) => (
          <SettingsGroupSection key={group.id} group={group} statuses={statuses} metas={rowMetas} />
        ))}
      </div>
    </>
  );
}
