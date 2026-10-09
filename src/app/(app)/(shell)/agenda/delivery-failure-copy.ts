/**
 * EC-32 — o texto da faixa e do selo de "mensagem automática não entregue".
 *
 * Copy aprovada pelo usuário em 08/10/2026: cada item diz o que fazer primeiro,
 * depois por que não chegou, com o código da Meta pequeno no fim. Nada aqui
 * promete reenvio: um job `failed` é terminal, e "Esta mensagem não será
 * reenviada" vale para todos.
 *
 * Os códigos seguem a tabela oficial de erros da Cloud API. O 131042 é de
 * CONTA (pagamento da WABA): o aviso da conta é da faixa de saúde do WhatsApp,
 * e aqui o item só diz o que a recepção precisa saber para agir.
 */
import {
  DELIVERY_FAILURE_LIST_LIMIT,
  DELIVERY_FAILURE_WINDOW_DAYS,
  type ProactiveFailureCause,
} from '@/contexts/ai-agent/proactive-jobs/domain/delivery-failure';

import type { AgendaDeliveryFailure, AgendaDeliveryFailureKind } from './delivery-failures';
import { todayYmd, ymdInTz } from './range';

export const NAO_SERA_REENVIADA = 'Esta mensagem não será reenviada.';

/** Nota quando a leitura bate no teto — com os números da própria leitura. */
export const LIMITE_DA_LISTA = `A lista mostra no máximo ${DELIVERY_FAILURE_LIST_LIMIT} mensagens dos últimos ${DELIVERY_FAILURE_WINDOW_DAYS} dias; pode haver outras.`;

export const KIND_LABEL: Record<AgendaDeliveryFailureKind, string> = {
  deposit_link: 'Link do sinal',
  remainder_link: 'Link do saldo',
  reminder: 'Lembrete da consulta',
  no_show_followup: 'Contato após a falta',
  waitlist_offer: 'Oferta de vaga',
  followup: 'Lembrete de retorno',
};

export const BADGE_LABEL: Record<AgendaDeliveryFailureKind, string> = {
  deposit_link: 'Link não entregue',
  remainder_link: 'Link do saldo não entregue',
  reminder: 'Lembrete não entregue',
  no_show_followup: 'Contato não entregue',
  waitlist_offer: 'Oferta não entregue',
  followup: 'Lembrete de retorno não entregue',
};

export const COPY_LINK_LABEL: Partial<Record<AgendaDeliveryFailureKind, string>> = {
  deposit_link: 'Copiar link do sinal',
  remainder_link: 'Copiar link do saldo',
};

/** Sujeito da frase de resumo. */
const WHAT: Record<AgendaDeliveryFailureKind, string> = {
  deposit_link: 'o link do sinal',
  remainder_link: 'o link do saldo',
  reminder: 'o lembrete da consulta',
  no_show_followup: 'o contato após a falta',
  waitlist_offer: 'a oferta de vaga',
  followup: 'o lembrete de retorno',
};

export interface CauseCopy {
  /** Por que não chegou. */
  motivo: string;
  /** O que fazer quanto à causa, quando há algo a fazer. */
  correcao: string | null;
  /** Código da Meta, só dígitos. */
  codigo: string | null;
}

const META_CODES: Record<string, Omit<CauseCopy, 'codigo'>> = {
  '131042': {
    motivo:
      'A conta do WhatsApp Business da clínica está com pendência de pagamento na Meta. Enquanto isso, nenhuma mensagem automática sai.',
    correcao: 'Configure a forma de pagamento na WhatsApp Manager.',
  },
  '131026': {
    motivo:
      'O número do paciente não recebe mensagens pelo WhatsApp: não tem conta, o app está desatualizado ou os termos não foram aceitos.',
    correcao: 'Confirme o número com o paciente.',
  },
  '131047': {
    motivo: 'A janela de 24 h da conversa com o paciente estava fechada.',
    correcao: null,
  },
  '131048': {
    motivo:
      'A Meta limitou os envios deste número porque mensagens anteriores foram bloqueadas ou marcadas como spam.',
    correcao: 'Veja a qualidade do número na WhatsApp Manager.',
  },
  '131049': {
    motivo:
      'A Meta segurou a mensagem para limitar quantas mensagens de empresas o paciente recebe.',
    correcao: null,
  },
  '131056': {
    motivo: 'Foram muitas mensagens para o mesmo paciente em pouco tempo.',
    correcao: null,
  },
};

const TEMPLATE_PROBLEM: Omit<CauseCopy, 'codigo'> = {
  motivo:
    'O modelo da mensagem está com problema na Meta: não aprovado, pausado ou com campos errados.',
  correcao: 'Fale com o suporte do Qoro.',
};

function metaRefusalCopy(code: string | null): CauseCopy {
  if (code === null) {
    return {
      motivo: 'A Meta recusou a mensagem sem informar o motivo.',
      correcao: null,
      codigo: null,
    };
  }
  // 132xxx é a família de erros de template da Cloud API.
  const known = META_CODES[code] ?? (/^132\d{3}$/.test(code) ? TEMPLATE_PROBLEM : null);
  return known
    ? { ...known, codigo: code }
    : { motivo: 'A Meta recusou a mensagem.', correcao: null, codigo: code };
}

export function causeCopy(cause: ProactiveFailureCause): CauseCopy {
  switch (cause.kind) {
    case 'meta_refused':
      return metaRefusalCopy(cause.code);
    case 'unconfirmed':
      return {
        motivo: 'Não foi possível confirmar se a mensagem chegou.',
        correcao: 'Confirme com o paciente.',
        codigo: null,
      };
    case 'number_not_connected':
      return {
        motivo: 'O WhatsApp da clínica não estava conectado.',
        correcao: 'Reconecte em Configurações › WhatsApp.',
        codigo: null,
      };
    case 'template_not_configured':
      return {
        motivo: 'O modelo desta mensagem ainda não está configurado no Qoro.',
        correcao: 'Fale com o suporte do Qoro.',
        codigo: null,
      };
    case 'internal':
      return {
        motivo: 'Erro interno do Qoro ao montar a mensagem.',
        correcao: 'Fale com o suporte do Qoro.',
        codigo: null,
      };
  }
}

/** Texto do `title` do selo: o motivo, com o código quando houver. */
export function badgeTitle(cause: ProactiveFailureCause): string {
  const { motivo, codigo } = causeCopy(cause);
  return codigo ? `${motivo} (${codigo})` : motivo;
}

function hora(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: tz,
  });
}

function diaMes(iso: string, tz: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: tz,
  });
}

/**
 * Prazo legível a partir de agora: "18:00" hoje, "amanhã às 18:00" ou
 * "16/10 às 18:00". O hold dura até 24 h, então "amanhã" é o caso comum.
 */
export function quando(iso: string, tz: string, now: Date): string {
  const alvo = ymdInTz(iso, tz);
  if (alvo === todayYmd(tz, now)) return hora(iso, tz);
  if (alvo === todayYmd(tz, new Date(now.getTime() + 24 * 60 * 60 * 1000))) {
    return `amanhã às ${hora(iso, tz)}`;
  }
  return `${diaMes(iso, tz)} às ${hora(iso, tz)}`;
}

/** "consulta 14/10 10:00", "vaga de 14/10 10:00" ou "retorno em 20/10". */
export function contextCopy(item: AgendaDeliveryFailure, tz: string): string | null {
  if (item.kind === 'followup') {
    if (!item.retornoEm) return null;
    const [, mes, dia] = item.retornoEm.split('-');
    return `retorno em ${dia}/${mes}`;
  }
  if (!item.consultaEm) return null;
  const quandoConsulta = `${diaMes(item.consultaEm, tz)} ${hora(item.consultaEm, tz)}`;
  return item.kind === 'waitlist_offer'
    ? `vaga de ${quandoConsulta}`
    : `consulta ${quandoConsulta}`;
}

/** A primeira linha do item: o que a recepção faz agora. */
export function actionCopy(item: AgendaDeliveryFailure, tz: string, now: Date): string {
  switch (item.kind) {
    case 'deposit_link':
      return item.vagaSeguradaAte
        ? `Envie o link ao paciente por outro canal antes de ${quando(item.vagaSeguradaAte, tz, now)}; depois disso a vaga é liberada.`
        : 'Envie o link ao paciente por outro canal.';
    case 'remainder_link':
      return 'Envie o link do saldo ao paciente por outro canal.';
    case 'reminder':
      return 'Lembre o paciente da consulta por outro canal.';
    case 'no_show_followup':
      return 'Fale com o paciente por outro canal para remarcar a consulta.';
    case 'waitlist_offer':
      return 'Ofereça a vaga ao paciente por outro canal ou chame o próximo da lista.';
    case 'followup':
      return 'Fale com o paciente por outro canal para agendar o retorno.';
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * A frase da faixa. "Não chegou" só quando a falha é certa: entrega sem
 * confirmação é dita como tal, nunca como recusa.
 */
export function summaryCopy(
  items: readonly AgendaDeliveryFailure[],
  tz: string,
  now: Date,
): string {
  const [first] = items;
  if (!first) return '';

  if (items.length === 1) {
    const vaga = first.vagaSeguradaAte
      ? ` · vaga segurada até ${quando(first.vagaSeguradaAte, tz, now)}`
      : '';
    if (first.causa.kind === 'unconfirmed') {
      const para = first.pacienteNome ? ` para ${first.pacienteNome}` : '';
      return `${capitalize(WHAT[first.kind])}${para} ficou sem confirmação de entrega${vaga}`;
    }
    const quem = first.pacienteNome ? `a ${first.pacienteNome}` : 'ao paciente';
    return `${capitalize(WHAT[first.kind])} não chegou ${quem}${vaga}`;
  }

  const semConfirmacao = items.filter((item) => item.causa.kind === 'unconfirmed').length;
  const total = `${items.length} mensagens automáticas`;
  const frase =
    semConfirmacao === 0
      ? `${total} não chegaram aos pacientes`
      : semConfirmacao === items.length
        ? `${total} ficaram sem confirmação de entrega`
        : `${total} não chegaram aos pacientes ou ficaram sem confirmação`;

  // A faixa já vem ordenada por prazo: o primeiro hold é o mais urgente.
  const holds = items.filter((item) => item.vagaSeguradaAte !== null);
  const primeiroHold = holds[0]?.vagaSeguradaAte;
  if (!primeiroHold) return frase;
  return holds.length === 1
    ? `${frase} · 1 vaga segurada até ${quando(primeiroHold, tz, now)}`
    : `${frase} · ${holds.length} vagas seguradas, a primeira até ${quando(primeiroHold, tz, now)}`;
}
