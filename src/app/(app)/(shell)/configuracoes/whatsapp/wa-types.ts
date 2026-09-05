/**
 * DTOs/helpers compartilhados da tela /configuracoes/whatsapp entre Server
 * Actions e client (um arquivo `'use server'` só exporta funções async → tipos/
 * consts vivem aqui). Mesmo contrato `ActionResult` do caixa/consultório.
 */
import { MetaConnectError, type MetaConnectFailureStage } from '@/contexts/messaging/errors';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

const META_FAILURE_MESSAGES: Record<MetaConnectFailureStage, string> = {
  authorization:
    'A Meta recusou a autorização. Feche o pop-up, conecte novamente e, se persistir, revise as credenciais do app Meta.',
  permissions:
    'A Meta não concedeu as permissões necessárias ao WhatsApp Business. Revise as permissões do app e conclua o pop-up novamente.',
  // D78 — o pop-up terminou sem dizer QUAL conta foi autorizada. Não há como
  // descobrir isso sem permissão de portfólio, então a orientação é refazer.
  signup_incomplete:
    'O pop-up da Meta terminou sem informar a conta do WhatsApp Business. Refaça a conexão e selecione a conta e o número até o fim do cadastro.',
  account:
    'A Meta não encontrou uma conta ou número WhatsApp autorizado. Confirme a conta empresarial e o número escolhidos no pop-up.',
  // D78 — a ação aqui é ESCOLHER, não reconfirmar a conta.
  phone_ambiguous:
    'A conta autorizada tem mais de um número de WhatsApp e o pop-up não informou qual usar. Refaça a conexão selecionando explicitamente o número da clínica.',
  // D78 — indeterminação da Meta não é negativa: mandar revisar a conta durante
  // uma instabilidade faria o operador procurar um problema que não existe.
  // Só cobre LEITURA, então afirmar "nada foi alterado" é seguro aqui.
  provider_unavailable:
    'A Meta não respondeu a tempo e não foi possível confirmar a conta. Nada foi alterado. Tente novamente em alguns minutos.',
  // D78 — a Meta recusou por excesso de chamadas. O que dá para AFIRMAR é que a
  // conexão local não foi salva; o RFC 6585 descreve o rate limiting mas não
  // garante, de forma genérica, que todo POST assim classificado deixou de ser
  // executado do outro lado. A orientação é esperar, não mexer em credencial.
  provider_rate_limited:
    'A Meta está limitando temporariamente as chamadas deste aplicativo e a conexão não foi salva. Aguarde alguns minutos e tente conectar novamente.',
  // D78 — indeterminação depois de uma MUTAÇÃO. Não existe read-back aqui, então
  // dizer "nada foi alterado" seria inventar. Também não se manda reabrir a
  // tela: sem conexão persistida, `loadWhatsappStatus()` não tem o que sondar e
  // a tela nada diria sobre o estado do lado da Meta. E não se pede repetição
  // imediata: um POST repetido às cegas é exatamente o que se quer evitar.
  provider_outcome_unknown:
    'A Meta não confirmou o resultado desta etapa e a conexão não foi salva. Antes de tentar novamente, confira o número no WhatsApp Manager ou entre em contato com o suporte.',
  phone_registration:
    'A Meta recusou a ativação do número. Confirme a verificação por SMS/voz e use um PIN novo de 6 dígitos, diferente do código recebido.',
  webhook_subscription:
    'O número foi ativado, mas a Meta não autorizou a assinatura do webhook. Revise a configuração de Webhooks do app Meta.',
  // Provisionamento de template nunca aborta o connect (roda depois da resposta,
  // best-effort). A mensagem existe só para a exaustividade do Record.
  template_provisioning:
    'O número foi conectado, mas os modelos de mensagem não puderam ser criados. Cadastre-os na WhatsApp Manager.',
  persistence:
    'Este número já está conectado ou não foi possível salvar a conexão. Tente novamente.',
  unknown: 'Não foi possível conectar o WhatsApp. Tente novamente.',
};

/** Mapeia erros de domínio (por `name`) → ActionResult sem vazar internals. */
export function fail(err: unknown): ActionResult<never> {
  if (err instanceof MetaConnectError) {
    // Código estável para suporte; a mensagem só expõe uma etapa finita e segura.
    return {
      ok: false,
      code: 'META_AUTH_FAILED',
      message: META_FAILURE_MESSAGES[err.stage],
    };
  }
  const name = err instanceof Error ? err.name : '';
  if (name === 'AuthError') {
    return {
      ok: false,
      code: 'forbidden',
      message: 'Você não tem permissão para esta ação.',
    };
  }
  // Erro NÃO mapeado: antes era engolido sem log nenhum (Sentry/Vercel cegos). O log
  // fica — é melhoria permanente e é ELE que torna a exposição na tela desnecessária:
  // o stack chega ao Sentry e ao Better Stack (`message.level:"error"`), que é onde se
  // diagnostica. A mensagem ao usuário volta a ser genérica (V11 da auditoria de
  // segurança: erro cru não vaza para a tela). O `DEBUG <name>: <message>` era
  // declaradamente temporário ("reverter após identificar a causa raiz", 80904fe).
  console.error(
    '[whatsapp action] erro não mapeado:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  return {
    ok: false,
    code: 'error',
    message: 'Não foi possível concluir a ação. Tente novamente.',
  };
}
