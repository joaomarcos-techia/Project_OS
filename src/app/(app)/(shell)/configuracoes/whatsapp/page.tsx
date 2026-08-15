import { env } from '@/lib/env';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';

import { loadWhatsappStatus } from './data';
import { WhatsappConnect } from './whatsapp-connect';

export const dynamic = 'force-dynamic';

/**
 * /configuracoes/whatsapp — conexão self-service do WhatsApp (Meta Embedded
 * Signup). `META_APP_ID`/`META_CONFIG_ID` são públicos (≠ META_APP_SECRET) e vão
 * ao client por PROPS — sem NEXT_PUBLIC_. Se faltarem, a tela degrada graciosamente
 * (botão desabilitado); a Server Action ainda faz o hard-guard server-side.
 */
export default async function WhatsappSettingsPage() {
  // AUTHZ-006 — `loadWhatsappStatus()` exigia só `requireClinicId()`, então um
  // médico sem `manage:settings` via número mascarado, data de conexão e o
  // botão "Desconectar". As actions já eram fresh-gated, mas metadado de
  // integração é informação administrativa: o gate precede a leitura. As
  // demais subrotas de Configurações (Perfil, Assinatura) já faziam isto.
  const gate = await pageGate([PERMISSIONS.MANAGE_SETTINGS]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Configurações' }, { label: 'WhatsApp' }]}
        title="WhatsApp"
        description="Seu perfil não tem permissão para gerenciar as configurações da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }
  const status = await loadWhatsappStatus();
  const appId = env.META_APP_ID ?? null;
  const configId = env.META_CONFIG_ID ?? null;
  const ready = Boolean(appId && configId && env.META_APP_SECRET);

  return (
    <WhatsappConnect
      status={status}
      appId={appId}
      configId={configId}
      graphVersion={env.META_GRAPH_API_VERSION}
      ready={ready}
    />
  );
}
