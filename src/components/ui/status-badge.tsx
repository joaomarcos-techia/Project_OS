import type { VariantProps } from 'class-variance-authority';
import { Ban, CircleCheck, CircleDashed, CircleDot, RotateCcw, TriangleAlert } from 'lucide-react';
import type { ComponentType } from 'react';

import { Badge } from './badge';
import type { badgeVariants } from './badge';

type Tone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

/**
 * Mapeamento status do domínio → tom + rótulo. A label/cor é decisão de UI, por
 * isso vive aqui (componentes não importam contexts — boundaries). Os valores
 * espelham a state machine de Scheduling (C6) e os status de lançamento (C9).
 */
export type AppointmentStatus =
  | 'agendado'
  | 'confirmado'
  | 'chegou'
  | 'em_atendimento'
  | 'atendido'
  | 'cancelado'
  | 'faltou';

/**
 * Rótulos NOMINAIS e no feminino, concordando com "a consulta" — é assim que a
 * referência escreve, e o registro importa: o badge qualifica a linha ("consulta
 * Finalizada"), não narra o que o paciente fez ("Atendido", "Faltou").
 *
 * `chegou` é "Aguardando" e não "Chegou" pelo mesmo motivo: quem lê a agenda
 * precisa saber o que está acontecendo AGORA — que há alguém esperando —, não
 * registrar um fato que já passou.
 *
 * Tons do app v5 (novembro/2026), os mesmos em Agenda, Consultório e Dashboard:
 * confirmada é verde (a boa notícia do dia), em atendimento é o azul da marca,
 * finalizada é marinho (concluída, sem pedir nada), falta é laranja e só
 * aguardando/falta ganham fundo colorido — são as que pedem alguém agir.
 * Cancelada é só contorno: saiu da conta do dia.
 */
const APPOINTMENT: Record<AppointmentStatus, { tone: Tone; label: string }> = {
  agendado: { tone: 'gray', label: 'Agendada' },
  confirmado: { tone: 'green', label: 'Confirmada' },
  chegou: { tone: 'amber', label: 'Aguardando' },
  em_atendimento: { tone: 'blue', label: 'Em atendimento' },
  atendido: { tone: 'navy', label: 'Finalizada' },
  cancelado: { tone: 'line', label: 'Cancelada' },
  faltou: { tone: 'orange', label: 'Falta' },
};

export function AppointmentStatusBadge({ status }: { status: AppointmentStatus }) {
  const { tone, label } = APPOINTMENT[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/**
 * ADR-049 — estado do SINAL do agendamento. Dimensao ORTOGONAL ao status: um
 * agendamento pode estar `agendado` com sinal pendente, pago ou vencido.
 *
 * `none` nao tem badge de proposito. A grande maioria das clinicas nao usa
 * sinal, e um rotulo "sem sinal" em toda consulta seria ruido que treina o
 * operador a nao olhar — e ai ele tambem nao olha quando importa.
 */
export type DepositStatus = 'none' | 'pending' | 'paid' | 'expired' | 'refunded';

const DEPOSIT: Record<Exclude<DepositStatus, 'none'>, { tone: Tone; label: string }> = {
  // Ambar, e nao cinza: a vaga esta SEGURADA e vai ser cancelada se ninguem
  // pagar. E o unico estado em que a recepcao ainda pode agir.
  pending: { tone: 'amber', label: 'Sinal pendente' },
  paid: { tone: 'green', label: 'Sinal pago' },
  expired: { tone: 'gray', label: 'Sinal vencido' },
  refunded: { tone: 'blue', label: 'Sinal estornado' },
};

export function DepositStatusBadge({ status }: { status: DepositStatus }) {
  if (status === 'none') return null;
  const { tone, label } = DEPOSIT[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

export type PaymentStatus = 'pendente' | 'pago' | 'parcial' | 'cancelado' | 'estornado';

type Glyph = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

/**
 * Cada status ganha um icone proprio, e nao o mesmo ponto colorido. Caixa e
 * Financeiro mostram estas fichas em fila: so a cor obriga a comparar dois
 * badges lado a lado para saber qual e qual, e falha de vez para quem nao
 * distingue ambar de verde.
 */
const PAYMENT: Record<PaymentStatus, { tone: Tone; label: string; icon: Glyph }> = {
  pendente: { tone: 'amber', label: 'Pendente', icon: CircleDashed },
  pago: { tone: 'green', label: 'Pago', icon: CircleCheck },
  parcial: { tone: 'blue', label: 'Parcial', icon: CircleDot },
  cancelado: { tone: 'gray', label: 'Cancelado', icon: Ban },
  estornado: { tone: 'red', label: 'Estornado', icon: RotateCcw },
};

/**
 * `overdue` NAO e um status armazenado: o Financial deriva "vencido" comparando
 * `due_date` com hoje no fuso da clinica (ver dunning-candidates.ts). A regra e
 * dele; aqui so existe a apresentacao dela, porque um lancamento em aberto fora
 * do prazo e um no prazo pedem acoes diferentes e a tela precisa distinguir.
 *
 * Vale para `pendente` E `parcial` — os dois estados em aberto. Um parcial que
 * passou do vencimento tem saldo devedor atrasado igual, e chama-lo so de
 * "Parcial" esconderia justamente a parte acionavel.
 *
 * `overdueDays` troca "Vencido" por "Vencido ha N dias": o operador precisa da
 * ordem de grandeza para priorizar, e ela ja esta calculada de qualquer jeito.
 */
export function PaymentStatusBadge({
  status,
  overdue = false,
  overdueDays = 0,
}: {
  status: PaymentStatus;
  overdue?: boolean;
  overdueDays?: number;
}) {
  const vencido = overdue && (status === 'pendente' || status === 'parcial');
  const { tone, label, icon } = vencido
    ? {
        tone: 'red' as Tone,
        label:
          overdueDays > 0
            ? `Vencido há ${overdueDays} ${overdueDays === 1 ? 'dia' : 'dias'}`
            : 'Vencido',
        icon: TriangleAlert as Glyph,
      }
    : PAYMENT[status];
  const Icon = icon;
  return (
    <Badge tone={tone}>
      <Icon aria-hidden="true" className="size-3 shrink-0" />
      {label}
    </Badge>
  );
}

/** Prontuario — o dominio tem DOIS estados (schema.ts: prontuarioStatus). */
export type ProntuarioStatus = 'rascunho' | 'assinado';

const PRONTUARIO: Record<ProntuarioStatus, { tone: Tone; label: string }> = {
  rascunho: { tone: 'amber', label: 'Rascunho' },
  assinado: { tone: 'green', label: 'Assinado' },
};

export function ProntuarioStatusBadge({ status }: { status: ProntuarioStatus }) {
  const { tone, label } = PRONTUARIO[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/**
 * Paciente nao tem enum de status: o que existe e `deletedAt` (soft delete).
 * O badge traduz isso para a linguagem da tela sem inventar um estado novo.
 */
export function PatientStatusBadge({ deletedAt }: { deletedAt: string | null }) {
  return deletedAt ? (
    <Badge tone="gray">Inativo</Badge>
  ) : (
    <Badge tone="green" dot>
      Ativo
    </Badge>
  );
}
