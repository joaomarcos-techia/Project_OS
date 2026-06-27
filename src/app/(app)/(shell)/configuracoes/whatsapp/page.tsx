import { env } from '@/lib/env';

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
