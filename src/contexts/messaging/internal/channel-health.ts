/**
 * META-001 — saúde REAL do canal WhatsApp.
 *
 * O pentest encontrou a WABA da Clínica A com `subscribed_apps` VAZIO enquanto o
 * banco dizia `active=true, connection_status='connected'`. Nesse estado a Meta
 * não entrega webhook nenhum: o paciente manda mensagem e nada acontece, mas a
 * tela afirma que está tudo certo. O health anterior só testava a raiz do Graph,
 * que responde 200 mesmo com o app desinscrito — por isso não via nada.
 *
 * Este módulo é PURO de propósito: a decisão "posso exibir conectado?" precisa
 * ser testável nos onze cenários exigidos sem rede. O I/O fica em
 * `meta-onboarding.probeMetaChannel()`; aqui só se interpreta o resultado.
 *
 * Distinção central: uma NEGATIVA do provedor (4xx, `is_valid=false`, lista de
 * apps sem o nosso) prova que o canal está quebrado; um Graph inalcançável
 * (timeout/5xx) NÃO prova nada. Degradar a conexão de todas as clínicas durante
 * uma instabilidade da Meta seria trocar uma mentira por outra.
 */

/** Resultado de UMA verificação. `unknown` = não deu para checar, não é veredito. */
export type MetaProbeOutcome = 'ok' | 'failed' | 'unknown';

/** Leitura crua do canal. Só outcomes — nenhum ID, token ou corpo do Graph. */
export interface MetaChannelProbe {
  /** `debug_token` diz que a credencial é válida. */
  token: MetaProbeOutcome;
  /** Os dois escopos obrigatórios de WhatsApp Business estão concedidos. */
  scopes: MetaProbeOutcome;
  /** O `phone_number_id` persistido é alcançável por este token. */
  phone: MetaProbeOutcome;
  /** A WABA persistida é alcançável por este token. */
  waba: MetaProbeOutcome;
  /** O NOSSO app está em `subscribed_apps` — é o que habilita o webhook. */
  appSubscription: MetaProbeOutcome;
  /**
   * O número está `CONNECTED` na Meta. Alcançar o `phone_number_id` (acima) NÃO
   * é a mesma coisa: um número existe e responde 200 mesmo quando saiu do ar
   * para envio. A doc é explícita — só `CONNECTED` envia e recebe pela API.
   */
  phoneStatus: MetaProbeOutcome;
  /**
   * `account_review_status` da WABA. Só `REJECTED` conta como negativa: uma
   * conta em `PENDING`/`DEFERRED` está em fila de revisão e continua servindo,
   * então rebaixá-la marcaria como quebrada uma clínica que funciona.
   *
   * A Meta NÃO expõe método de pagamento no nó da WABA (os campos legíveis são
   * id, name, timezone_id, message_template_namespace, account_review_status,
   * business_verification_status, country, ownership_type e
   * primary_business_location). Não dá para sondar crédito diretamente; esta é
   * a negativa documentada mais próxima.
   */
  accountReview: MetaProbeOutcome;
}

/**
 * Códigos ESTÁVEIS para UI/log/audit. Não carregam WABA id, phone id, token,
 * app id nem corpo do Graph: a tela precisa dizer o que fazer, não expor a
 * topologia da integração.
 */
export const CHANNEL_HEALTH_REASONS = [
  'token_invalid',
  'scopes_missing',
  'phone_unreachable',
  'waba_unreachable',
  'app_not_subscribed',
  'phone_not_connected',
  'account_rejected',
  'probe_unavailable',
] as const;
export type ChannelHealthReason = (typeof CHANNEL_HEALTH_REASONS)[number];

/**
 * - `healthy`: tudo verificado e aprovado — só aqui `connected` é honesto.
 * - `broken`: o provedor negou alguma exigência; o canal não funciona.
 * - `indeterminate`: faltou evidência; preserva-se o estado anterior.
 */
export type ChannelHealthVerdict = 'healthy' | 'broken' | 'indeterminate';

export interface ChannelHealth {
  verdict: ChannelHealthVerdict;
  reasons: ChannelHealthReason[];
}

/** Ordem de exibição: a causa mais fundamental primeiro. */
const CHECK_ORDER: Array<{ key: keyof MetaChannelProbe; reason: ChannelHealthReason }> = [
  { key: 'token', reason: 'token_invalid' },
  { key: 'scopes', reason: 'scopes_missing' },
  { key: 'accountReview', reason: 'account_rejected' },
  { key: 'waba', reason: 'waba_unreachable' },
  { key: 'phone', reason: 'phone_unreachable' },
  { key: 'phoneStatus', reason: 'phone_not_connected' },
  { key: 'appSubscription', reason: 'app_not_subscribed' },
];

/**
 * Decide o veredito do canal. Fail-closed sobre NEGATIVA, fail-open sobre
 * INDETERMINAÇÃO — nesta ordem, porque um `failed` continua valendo mesmo que
 * outra sonda tenha ficado `unknown` (token inválido explica os `unknown`
 * seguintes e não deve ser rebaixado a "não consegui verificar").
 */
export function evaluateChannelHealth(probe: MetaChannelProbe): ChannelHealth {
  const failed = CHECK_ORDER.filter(({ key }) => probe[key] === 'failed').map((c) => c.reason);
  if (failed.length > 0) return { verdict: 'broken', reasons: failed };

  const unknown = CHECK_ORDER.some(({ key }) => probe[key] === 'unknown');
  if (unknown) return { verdict: 'indeterminate', reasons: ['probe_unavailable'] };

  return { verdict: 'healthy', reasons: [] };
}

/**
 * Traduz o veredito para a máquina de estados JÁ existente
 * (`whatsapp_connection_status`, migration 0033) — sem enum novo, sem migration.
 * `failed` é o estado de "conectado no papel, inoperante na prática" e já é
 * renderizado pela tela; `indeterminate` devolve `null` = não escreva nada.
 */
export function connectionStatusForHealth(
  verdict: ChannelHealthVerdict,
): 'connected' | 'failed' | null {
  if (verdict === 'healthy') return 'connected';
  if (verdict === 'broken') return 'failed';
  return null;
}

/** Mensagem para o operador. Curta, acionável e sem identificadores externos. */
export function describeChannelHealthReason(reason: ChannelHealthReason): string {
  switch (reason) {
    case 'token_invalid':
      return 'A autorização do WhatsApp expirou ou foi revogada na Meta.';
    case 'scopes_missing':
      return 'A conexão perdeu as permissões de gerência ou de mensageria do WhatsApp Business.';
    case 'waba_unreachable':
      return 'A conta WhatsApp Business não está mais acessível por esta conexão.';
    case 'phone_unreachable':
      return 'O número conectado não está mais acessível por esta conexão.';
    case 'app_not_subscribed':
      return 'A Meta não está entregando mensagens para o ClinicaOS: as mensagens recebidas não chegam até a clínica.';
    case 'phone_not_connected':
      return 'O número não está ativo na Meta: ele não envia nem recebe mensagens neste estado.';
    case 'account_rejected':
      return 'A Meta reprovou a conta WhatsApp Business desta clínica. Resolva a pendência na WhatsApp Manager.';
    case 'probe_unavailable':
      return 'Não foi possível confirmar o estado da conexão com a Meta agora.';
  }
}
