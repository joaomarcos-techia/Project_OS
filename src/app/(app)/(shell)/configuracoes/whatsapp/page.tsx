import { embeddedSignupConfig, env } from '@/lib/env';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';

import { readWhatsappProfileAction } from './actions';
import { loadWhatsappStatus } from './data';
import { WhatsappConnect } from './whatsapp-connect';
import { WhatsappProfile, type PerfilCarregado } from './whatsapp-profile';

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
        crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'WhatsApp' }]}
        title="WhatsApp"
        description="Seu perfil não tem permissão para gerenciar as configurações da clínica. Fale com um gestor se precisar de acesso."
      />
    );
  }
  const status = await loadWhatsappStatus();

  // §33.5 — sem número ativo, a seção de perfil nem aparece: não há o que
  // configurar, e oferecer um formulário para um número inexistente seria
  // prometer uma escrita que a action recusaria.
  //
  // O gatilho é `hasActiveNumber`, e NÃO `connected`: um canal degradado
  // (número ativo, webhook caído) continua tendo perfil público — o paciente vê
  // a mesma foto e o mesmo recado. Esconder a seção ali deixaria a clínica sem
  // como corrigir o que o paciente enxerga justamente quando algo está errado.
  const perfil: PerfilCarregado | null = status.hasActiveNumber ? await carregarPerfil() : null;

  const appId = env.META_APP_ID ?? null;
  const signup = embeddedSignupConfig();
  const configId = signup?.configId ?? null;
  const ready = Boolean(appId && configId && env.META_APP_SECRET);

  return (
    // `min-w-0` também aqui: sem ele, um endereço longo no perfil empurraria a
    // largura da coluna do shell em vez de quebrar linha.
    <div className="min-w-0">
      <WhatsappConnect
        status={status}
        appId={appId}
        configId={configId}
        signupVersion={signup?.version ?? 'legacy'}
        graphVersion={env.META_GRAPH_API_VERSION}
        ready={ready}
      />
      {perfil ? <WhatsappProfile inicial={perfil} /> : null}
    </div>
  );
}

/**
 * Lê o perfil na Meta para a carga da página.
 *
 * A falha é CAPTURADA aqui, e não propagada: uma indisponibilidade da Meta não
 * pode derrubar a tela inteira de configuração do WhatsApp, que é exatamente
 * onde a pessoa vai quando desconfia que algo está errado com o canal. O que
 * sobe para o componente é "não consegui ler", que tem ramo próprio — e que
 * nunca vira formulário vazio (§33.5).
 */
async function carregarPerfil(): Promise<PerfilCarregado> {
  const r = await readWhatsappProfileAction();
  return r.ok ? { ok: true, lido: r.data } : { ok: false, message: r.message };
}
