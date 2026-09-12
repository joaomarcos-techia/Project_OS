import {
  CircleCheck,
  CircleSlash,
  Hand,
  Lock,
  Sparkles,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';

import type { AIConversationStatus } from '@/contexts/ai-agent/types';

/**
 * Como uma conversa se anuncia na fila.
 *
 * O estado NÃO é um badge: é ícone + texto coloridos, em linha. A distinção
 * importa porque a linha já carrega um badge — o do SLA — e dois badges lado a
 * lado competem pela mesma leitura. Aqui o estado é o rótulo e o prazo é o
 * alarme.
 *
 * Três cores com significado fixo no produto: magenta é IA, índigo é humano,
 * âmbar é "espera por alguém". Cinza é o que já não pede ação.
 */
export type StatusTone = 'ai' | 'human' | 'attention' | 'muted';

export interface StatusPresentation {
  Icon: LucideIcon;
  label: string;
  tone: StatusTone;
  /** Badge complementar quando o estado, sozinho, não diz o que trava a ação. */
  badge?: { label: string; tone: 'muted' } | undefined;
}

export function apresentacaoDoStatus(conversa: {
  status: AIConversationStatus;
  windowOpen: boolean;
  assignedToName?: string | null;
}): StatusPresentation {
  if (conversa.status === 'closed') {
    return { Icon: CircleCheck, label: 'Encerrada', tone: 'muted' };
  }
  if (conversa.status === 'abandoned') {
    return { Icon: CircleSlash, label: 'Abandonada', tone: 'muted' };
  }
  // Conversa ATIVA com janela fechada: o estado útil não é "o agente está
  // respondendo" — é que ninguém pode responder em texto livre até o paciente
  // escrever de novo. Em `handoff` a regra se inverte e o prazo continua no
  // comando: lá a fila humana é o que o operador precisa ver primeiro.
  if (conversa.status === 'active' && !conversa.windowOpen) {
    return {
      Icon: Lock,
      label: 'Janela de 24 h expirada',
      tone: 'muted',
      badge: { label: 'Sem resposta livre', tone: 'muted' },
    };
  }
  if (conversa.status === 'handoff') {
    return conversa.assignedToName
      ? {
          Icon: UserRoundCheck,
          label: `Atendimento humano · ${conversa.assignedToName}`,
          tone: 'human',
        }
      : { Icon: Hand, label: 'Aguardando humano', tone: 'attention' };
  }
  return { Icon: Sparkles, label: 'Agente respondendo', tone: 'ai' };
}

/**
 * Prazo do SLA em tempo RELATIVO ("há 6 min", "em 9 min").
 *
 * Um horário absoluto ("até 13:58") obriga quem lê a fazer a subtração de
 * cabeça, e a pergunta que a fila responde é "quanto tempo esta pessoa já
 * esperou" — não "que horas eram".
 */
export function prazoRelativo(dueAt: string, agora = new Date()): string {
  const minutos = Math.round((new Date(dueAt).getTime() - agora.getTime()) / 60_000);
  const atrasado = minutos < 0;
  const abs = Math.abs(minutos);
  const quanto =
    abs < 60
      ? `${abs} min`
      : abs < 1440
        ? `${Math.round(abs / 60)} h`
        : `${Math.round(abs / 1440)} d`;
  return atrasado ? `SLA vencido há ${quanto}` : `SLA em ${quanto}`;
}
