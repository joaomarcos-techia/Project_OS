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
  account:
    'A Meta não encontrou uma conta ou número WhatsApp autorizado. Confirme a conta empresarial e o número escolhidos no pop-up.',
  phone_registration:
    'A Meta recusou a ativação do número. Confirme a verificação por SMS/voz e use um PIN novo de 6 dígitos, diferente do código recebido.',
  webhook_subscription:
    'O número foi ativado, mas a Meta não autorizou a assinatura do webhook. Revise a configuração de Webhooks do app Meta.',
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
