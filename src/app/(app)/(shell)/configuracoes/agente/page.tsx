import type { Metadata } from 'next';
/**
 * /configuracoes/agente — comportamento do Agente de IA (RBAC-001).
 *
 * Gateada em `manage:agent`, NÃO em `manage:settings`: administrar o que o
 * agente pode fazer e dizer em nome da clínica é capacidade distinta de
 * administrar a identidade e as integrações dela. Aliasar as duas é exatamente
 * o que o achado proíbe.
 */
import { PageNoAccess } from '@/components/shared/page-no-access';
import { getAgentConfig } from '@/contexts/ai-agent/config-actions';
import { pageGate } from '@/lib/auth/page-guard';
import { PERMISSIONS } from '@/lib/auth/permissions';

import { AgentConfigForm } from './agent-config-form';

export const metadata: Metadata = { title: 'Agente de IA' };

export const dynamic = 'force-dynamic';

export default async function AgentSettingsPage() {
  const gate = await pageGate([PERMISSIONS.MANAGE_AGENT]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'Agente de IA' }]}
        title="Agente de IA"
        description="Seu perfil não tem permissão para gerenciar o Agente de IA. Fale com um gestor se precisar de acesso."
      />
    );
  }
  // O gate precede a leitura: sem `manage:agent` nem a configuração atual é
  // consultada.
  const config = await getAgentConfig();
  return <AgentConfigForm initial={config} />;
}
