/**
 * Registry de templates Meta (C14). A CHAVE canônica + a ordem das variáveis do
 * body vivem em código; o NOME aprovado na Meta vem do ENV por ambiente
 * (PlanoAção §14.18 — congelado). Cloud API envia por NOME (não ID opaco).
 *
 * ponytail: ENV é a decisão congelada. Lifecycle de template (v2 sem deploy)
 * vira tabela de config só quando os templates churnarem de verdade — YAGNI hoje.
 */
import { env } from '@/lib/env';

import type {
  DepositLinkPayload,
  DunningPayload,
  FollowupPayload,
  ReminderPayload,
  WaitlistOfferPayload,
} from '../domain/types';
import type { ProactiveJobType } from '../schema';

/** Config não-encontrada = erro de operação NÃO-retryável (job → failed). */
export class TemplateNotConfiguredError extends Error {
  constructor(public readonly type: ProactiveJobType) {
    super(`[c14] template Meta não configurado para "${type}" (ver META_TEMPLATE_*_ID)`);
    this.name = 'TemplateNotConfiguredError';
  }
}

export interface ProactiveTemplate {
  templateName: string;
  languageCode: string;
  variables: string[];
}

// --- formatação das variáveis ------------------------------------------------

const timeFmtCache = new Map<string, Intl.DateTimeFormat>();
function horarioLocal(scheduledAtIso: string, tz: string): string {
  let f = timeFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFmtCache.set(tz, f);
  }
  return f.format(new Date(scheduledAtIso));
}

/** 'YYYY-MM-DD' (data-calendário) → 'DD/MM/YYYY'. */
function dataBr(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

const dateFmtCache = new Map<string, Intl.DateTimeFormat>();
/** Instante UTC → 'DD/MM' no fuso da clínica (a vaga é sempre próxima). */
function dataLocalBr(iso: string, tz: string): string {
  let f = dateFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' });
    dateFmtCache.set(tz, f);
  }
  return f.format(new Date(iso));
}

const moneyFmt = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * O link é a razão de existir desta mensagem — sem ele não há o que enviar.
 *
 * Lança em vez de cair para string vazia: a Meta recusa variável vazia, mas o
 * modo de falha ruim seria o oposto — a mensagem SAIR com "pague neste link:"
 * seguido de nada, para um paciente que perde a consulta se não pagar.
 */
function requireInvoiceUrl(url: string | undefined): string {
  if (!url) throw new Error('[c14] deposit_link exige invoiceUrl resolvido no send-time');
  return url;
}

// --- builders ----------------------------------------------------------------

function envName(type: ProactiveJobType): string {
  const name =
    type === 'reminder'
      ? env.META_TEMPLATE_CONFIRMATION_REMINDER_ID
      : type === 'dunning'
        ? env.META_TEMPLATE_DUNNING_FRIENDLY_ID
        : type === 'waitlist_offer'
          ? env.META_TEMPLATE_WAITLIST_OFFER_ID
          : type === 'deposit_link'
            ? env.META_TEMPLATE_DEPOSIT_LINK_ID
            : env.META_TEMPLATE_FOLLOWUP_RETURN_ID;
  if (!name) throw new TemplateNotConfiguredError(type);
  return name;
}

/**
 * Monta o template do job. `patientNome` vem do contato resolvido no send-time
 * (nunca do payload — PII). `tz` formata o horário local do lembrete.
 */
export function buildProactiveTemplate(
  type: ProactiveJobType,
  payload:
    | ReminderPayload
    | DunningPayload
    | FollowupPayload
    | WaitlistOfferPayload
    | DepositLinkPayload,
  patientNome: string,
  tz: string,
  /**
   * 1.6a — o link do sinal. Resolvido no SEND-TIME e passado como argumento, e
   * nao lido do payload: link de pagamento nao fica em repouso na fila.
   */
  extra?: { invoiceUrl?: string },
): ProactiveTemplate {
  const languageCode = env.META_TEMPLATE_LANG;
  const templateName = envName(type);

  let variables: string[];
  if (type === 'reminder') {
    const p = payload as ReminderPayload;
    // "Olá {nome}, lembramos sua consulta amanhã {horario} com Dr {nome}. Confirma? SIM/NÃO."
    variables = [patientNome, horarioLocal(p.scheduledAt, tz), p.doctorNome];
  } else if (type === 'dunning') {
    const p = payload as DunningPayload;
    // "Olá {nome}, sua consulta de {data} ainda tem pagamento pendente de R$ {valor}. Pode pagar via PIX?"
    variables = [patientNome, dataBr(p.dueDate), moneyFmt.format(p.valor)];
  } else if (type === 'waitlist_offer') {
    const p = payload as WaitlistOfferPayload;
    // "Oi {nome}, abriu um horário em {data} às {hora} com Dr {nome}. Quer ficar com ele?"
    variables = [
      patientNome,
      dataLocalBr(p.scheduledAt, tz),
      horarioLocal(p.scheduledAt, tz),
      p.doctorNome ?? 'nossa equipe',
    ];
  } else if (type === 'deposit_link') {
    const p = payload as DepositLinkPayload;
    // O prazo vai com DATA e hora, não só hora: o hold pode vencer amanhã, e
    // "até as 14:00" num aviso recebido hoje diria a coisa errada. Prazo errado
    // numa mensagem de pagamento é pior que prazo nenhum.
    variables = [
      patientNome,
      moneyFmt.format(p.amount),
      `${dataLocalBr(p.holdExpiresAt, tz)} às ${horarioLocal(p.holdExpiresAt, tz)}`,
      requireInvoiceUrl(extra?.invoiceUrl),
    ];
  } else {
    const p = payload as FollowupPayload;
    // "Oi {nome}, Dr {nome} pediu retorno. Quer marcar pra essa semana?"
    variables = [patientNome, p.doctorNome ?? 'seu médico'];
  }

  return { templateName, languageCode, variables };
}
