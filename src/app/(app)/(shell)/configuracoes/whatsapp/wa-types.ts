/**
 * DTOs/helpers compartilhados da tela /configuracoes/whatsapp entre Server
 * Actions e client (um arquivo `'use server'` só exporta funções async → tipos/
 * consts vivem aqui). Mesmo contrato `ActionResult` do caixa/consultório.
 */
import { ZodError } from 'zod';

import {
  MessagingRateLimitedError,
  MetaConnectError,
  NumberNotConnectedError,
  type MetaConnectFailureStage,
} from '@/contexts/messaging/errors';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: string;
      message: string;
      /**
       * Mensagem por CAMPO, quando a recusa foi de validação (§33.5: "4xx →
       * mensagem por campo, nada foi alterado"). Um resumo genérico obrigaria a
       * pessoa a caçar qual dos seis campos estourou o limite.
       */
      fields?: Record<string, string>;
    };

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
  // Coexistência — como o provisionamento de template, roda depois da resposta
  // e nunca aborta o connect. A mensagem existe para a exaustividade do Record.
  coexistence_sync:
    'O WhatsApp Business foi conectado, mas a sincronização com o app do celular não foi confirmada. Fale com o suporte em até 24 horas.',
  // §33 — só chegam aqui quando a classe é `denied`, ou seja, a Meta recusou de
  // verdade. Indeterminação e throttling viram as etapas de provedor acima.
  // Na LEITURA é seguro afirmar que nada mudou, e é obrigatório dizer para a
  // pessoa não concluir que o perfil está vazio (§33.5).
  profile_read:
    'Não foi possível ler o perfil do WhatsApp agora. Nada foi alterado — tente novamente antes de editar, para não sobrescrever o que já está publicado.',
  // Na ESCRITA a Meta recusou o conteúdo. Não repetimos o texto cru do provedor
  // (pode refletir o request); o que ajuda é dizer onde olhar.
  profile_write:
    'A Meta recusou os dados do perfil. Revise o recado, a descrição, o endereço, o e-mail e os sites — e confira se algum texto foi rejeitado por conteúdo.',
  persistence:
    'Este número já está conectado ou não foi possível salvar a conexão. Tente novamente.',
  unknown: 'Não foi possível conectar o WhatsApp. Tente novamente.',
};

/**
 * Primeira mensagem de cada campo recusado pelo Zod.
 *
 * `issue.path[0]` é o nome do campo; em `websites` o path é `['websites', 0]` e
 * o índice é descartado de propósito — a tela mostra os dois sites juntos, e um
 * erro apontando para "websites.1" não teria onde aparecer.
 */
function camposDoZod(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const campo = typeof issue.path[0] === 'string' ? issue.path[0] : '_';
    fields[campo] ??= issue.message;
  }
  return fields;
}

/** Mapeia erros de domínio (por `name`) → ActionResult sem vazar internals. */
export function fail(err: unknown): ActionResult<never> {
  if (err instanceof ZodError) {
    const fields = camposDoZod(err);
    // "Revise os campos destacados" só é verdade se algum campo FOI destacado.
    // Uma recusa de raiz — corpo com chave desconhecida, que é o caminho de
    // adulteração — não destaca nada, e a frase mandaria a pessoa procurar um
    // realce que não existe.
    const temCampo = Object.keys(fields).some((k) => k !== '_');
    return {
      ok: false,
      code: 'validation',
      message: temCampo
        ? 'Revise os campos destacados. Nada foi alterado.'
        : 'Os dados enviados não foram aceitos. Nada foi alterado.',
      fields,
    };
  }
  if (err instanceof MessagingRateLimitedError) {
    // Fomos NÓS que recusamos, não a Meta — e por isso "nada foi enviado" é
    // afirmação segura, diferente de `provider_rate_limited`.
    //
    // Leitura e escrita têm frases distintas porque a do outro caso seria
    // falsa: dizer "muitas alterações seguidas" a quem só abriu a tela manda
    // procurar uma alteração que ninguém fez.
    return {
      ok: false,
      code: 'rate_limited',
      message:
        err.operacao === 'write'
          ? 'Muitas alterações seguidas no perfil. Nada foi enviado à Meta. Aguarde alguns minutos e tente de novo.'
          : 'O perfil foi consultado muitas vezes seguidas. Aguarde alguns minutos e recarregue.',
    };
  }
  if (err instanceof NumberNotConnectedError) {
    return {
      ok: false,
      code: 'number_not_connected',
      message: 'Nenhum número de WhatsApp está conectado nesta clínica.',
    };
  }
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
