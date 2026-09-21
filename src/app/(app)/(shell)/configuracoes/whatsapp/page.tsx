import { env } from '@/lib/env';
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

  // §33.5 — sem numero ativo, a secao de perfil nem aparece: nao ha o que
  // configurar, e oferecer um formulario para um numero inexistente seria
  // prometer uma escrita que a action recusaria.
  //
  // O gatilho e `hasActiveNumber`, e NAO `connected`: um canal degradado
  // (numero ativo, webhook caido) continua tendo perfil publico — o paciente ve
  // a mesma foto e o mesmo recado. Esconder a secao ali deixaria a clinica sem
  // como corrigir o que o paciente enxerga justamente quando algo esta errado.
  const perfil: PerfilCarregado | null = status.hasActiveNumber ? await carregarPerfil() : null;

  const appId = env.META_APP_ID ?? null;
  const configId = env.META_CONFIG_ID ?? null;
  const ready = Boolean(appId && configId && env.META_APP_SECRET);

  return (
    <>
      <WhatsappConnect
        status={status}
        appId={appId}
        configId={configId}
        graphVersion={env.META_GRAPH_API_VERSION}
        ready={ready}
      />
      {perfil ? <WhatsappProfile inicial={perfil} /> : null}
    </>
  );
}

/**
 * Le o perfil na Meta para a carga da pagina.
 *
 * A falha e CAPTURADA aqui, e nao propagada: uma indisponibilidade da Meta nao
 * pode derrubar a tela inteira de configuracao do WhatsApp, que e exatamente
 * onde a pessoa vai quando desconfia que algo esta errado com o canal. O que
 * sobe para o componente e "nao consegui ler", que tem ramo proprio — e que
 * nunca vira formulario vazio (§33.5).
 */
async function carregarPerfil(): Promise<PerfilCarregado> {
  const r = await readWhatsappProfileAction();
  return r.ok ? { ok: true, lido: r.data } : { ok: false, message: r.message };
}
