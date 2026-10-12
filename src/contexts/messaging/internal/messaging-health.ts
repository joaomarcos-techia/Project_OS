/**
 * Saúde de ENVIO da conta WhatsApp: o `health_status` da Meta lido para as
 * mensagens que a CLÍNICA inicia — lembrete, link do sinal, cobrança, oferta de
 * vaga, todas templates da fila C14.
 *
 * Por que existe (08/10/2026, DEV): a WABA de teste não tinha forma de
 * pagamento. A Cloud API aceitava cada template (devolvia o wamid) e a Meta o
 * recusava depois, no callback, com 131042. As respostas dentro da janela de
 * 24 h continuavam chegando, então a clínica via a IA funcionando enquanto
 * nenhum lembrete chegava ao paciente. O motivo só aparecia no Graph:
 * `health_status` com `can_send_message: BLOCKED` e o erro 141006. O EC-32 marca
 * cada recusa DEPOIS que ela acontece; este módulo avisa ANTES.
 *
 * É PURO de propósito: interpreta o corpo do Graph. O I/O fica em
 * `meta-onboarding.readMessagingHealth()`.
 *
 * Três regras, todas tiradas das respostas reais:
 *  1. O agregado do topo NÃO serve. No exemplo oficial da Meta, um problema só
 *     de chamadas (SIP) põe o topo em BLOCKED com todas as entidades em
 *     `can_send_message: AVAILABLE`. O veredito sai entidade a entidade.
 *  2. Erro de chamada não é erro de mensagem. A família 138xxx é a das chamadas:
 *     138000–138023 na página de troubleshooting de Calling, 138024/138025 (SIP)
 *     na de Health Status. No DEV o número veio LIMITED com 138024 e o APP
 *     AVAILABLE com 138025.
 *  3. Só erro conta. Um LIMITED sem código de mensagem não gera aviso: no DEV, o
 *     número estava LIMITED porque o nome de exibição ainda não foi aprovado, e
 *     a Meta só diz isso em `additional_info`, sem código. Já BLOCKED gera aviso
 *     sempre: a Meta documenta que BLOCKED traz `errors`, e um bloqueio sem
 *     código continua sendo um bloqueio.
 */
import { normalizeProviderDeliveryStatus, providerFailureCode } from './delivery-status';

export const MESSAGING_HEALTH_STATES = ['available', 'limited', 'blocked'] as const;
/** Os valores de `can_send_message` da Meta, em minúsculas. */
export type MessagingHealthState = (typeof MESSAGING_HEALTH_STATES)[number];

export interface MessagingHealth {
  /** Pode enviar mensagens iniciadas pela clínica? Sem o ruído das chamadas. */
  state: MessagingHealthState;
  /** Códigos da Meta que explicam o estado, sem os de chamada. Ordenados, sem repetição. */
  codes: number[];
}

/** Família de erros da API de chamadas (Calling/SIP). Nunca afeta mensagens. */
export function isCallingErrorCode(code: number): boolean {
  return code >= 138_000 && code <= 138_999;
}

/**
 * Forma de pagamento ou moeda: 141006 no `health_status`; 131042 no callback de
 * um envio recusado ("Business eligibility payment issue").
 */
export const PAYMENT_ERROR_CODES: ReadonlySet<number> = new Set([131042, 141006]);

/** Negócio sem verificação: a Meta limita o volume de envios (LIMITED). */
export const BUSINESS_VERIFICATION_ERROR_CODES: ReadonlySet<number> = new Set([141010]);

const SEVERITY: Record<MessagingHealthState, number> = { available: 0, limited: 1, blocked: 2 };

function normalizeState(value: unknown): MessagingHealthState | null {
  if (typeof value !== 'string') return null;
  const state = value.trim().toLowerCase();
  return state === 'available' || state === 'limited' || state === 'blocked' ? state : null;
}

/** `errors[].error_code` como inteiros positivos. A Meta manda número; dígitos em texto também valem. */
function errorCodes(errors: unknown): number[] {
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((error: unknown) => {
    const raw =
      typeof error === 'object' && error !== null
        ? (error as { error_code?: unknown }).error_code
        : undefined;
    const code =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d{1,10}$/.test(raw.trim())
          ? Number(raw.trim())
          : Number.NaN;
    return Number.isSafeInteger(code) && code > 0 ? [code] : [];
  });
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * Interpreta `GET /{nó}?fields=health_status`. `null` quando a resposta não tem a
 * forma documentada: o chamador trata como "não verificado" e preserva o último
 * estado gravado, em vez de inventar um veredito.
 */
export function parseMessagingHealth(body: unknown): MessagingHealth | null {
  const healthStatus = field(body, 'health_status');
  const entities = field(healthStatus, 'entities');
  if (!Array.isArray(entities)) return null;

  let state: MessagingHealthState = 'available';
  const codes = new Set<number>();
  let readable = 0;
  for (const entity of entities) {
    const entityState = normalizeState(field(entity, 'can_send_message'));
    if (!entityState) continue;
    readable++;
    if (entityState === 'available') continue;

    const messagingCodes = errorCodes(field(entity, 'errors')).filter(
      (code) => !isCallingErrorCode(code),
    );
    // Regra 3: LIMITED só pesa quando um código de mensagem o explica.
    if (entityState === 'limited' && messagingCodes.length === 0) continue;
    for (const code of messagingCodes) codes.add(code);
    if (SEVERITY[entityState] > SEVERITY[state]) state = entityState;
  }

  if (readable === 0) {
    // Sem entidade legível não há como separar mensagem de chamada (regra 1).
    // Só o "tudo disponível" do topo é aproveitável.
    return normalizeState(field(healthStatus, 'can_send_message')) === 'available'
      ? { state: 'available', codes: [] }
      : null;
  }
  return { state, codes: [...codes].sort((a, b) => a - b) };
}

/**
 * Recusas de envio que pedem reler o `health_status` na hora: as de forma de
 * pagamento. Texto, porque é assim que o código chega do callback.
 */
export const HEALTH_RECHECK_DELIVERY_CODES: ReadonlySet<string> = new Set(['131042', '141006']);

/** O callback de status é um `failed` por forma de pagamento? */
export function deliveryFailureNeedsHealthCheck(status: string, raw: unknown): boolean {
  if (normalizeProviderDeliveryStatus(status) !== 'failed') return false;
  const code = providerFailureCode(raw);
  return code !== null && HEALTH_RECHECK_DELIVERY_CODES.has(code);
}

const ACTION_PAYMENT = 'Adicione uma forma de pagamento à sua conta do WhatsApp Business na Meta.';
const ACTION_VERIFICATION = 'Conclua a verificação da empresa no gerenciador de negócios da Meta.';
const ACTION_REVIEW = 'Confira as pendências da conta no WhatsApp Manager da Meta.';

/** O que a tela e o painel dizem quando a Meta bloqueia ou limita os envios. */
export interface MessagingHealthNotice {
  state: Exclude<MessagingHealthState, 'available'>;
  title: string;
  summary: string;
  /** O que a clínica faz, começando pelo que destrava mais. */
  actions: string[];
  /** Uma linha para o painel. */
  headline: string;
}

/**
 * Texto para a clínica, sem identificador nenhum da integração. `null` quando
 * não há o que avisar.
 */
export function describeMessagingHealth(health: MessagingHealth): MessagingHealthNotice | null {
  if (health.state === 'available') return null;

  const actions: string[] = [];
  if (health.codes.some((code) => PAYMENT_ERROR_CODES.has(code))) actions.push(ACTION_PAYMENT);
  if (health.codes.some((code) => BUSINESS_VERIFICATION_ERROR_CODES.has(code))) {
    actions.push(ACTION_VERIFICATION);
  }
  const unexplained = health.codes.some(
    (code) => !PAYMENT_ERROR_CODES.has(code) && !BUSINESS_VERIFICATION_ERROR_CODES.has(code),
  );
  if (actions.length === 0 || unexplained) actions.push(ACTION_REVIEW);

  if (health.state === 'blocked') {
    return {
      state: 'blocked',
      title: 'Mensagens automáticas bloqueadas pela Meta',
      summary:
        'Lembretes de consulta, links de sinal, cobranças e ofertas de vaga não estão chegando aos pacientes. As respostas nas conversas continuam funcionando.',
      actions,
      headline:
        'A Meta bloqueou as mensagens automáticas do WhatsApp: lembretes e links de sinal não chegam aos pacientes',
    };
  }
  return {
    state: 'limited',
    title: 'Mensagens automáticas limitadas pela Meta',
    summary:
      'Os lembretes e links continuam saindo, mas a Meta restringe o volume de envios até a pendência ser resolvida.',
    actions,
    headline: 'A Meta está limitando as mensagens automáticas do WhatsApp',
  };
}
