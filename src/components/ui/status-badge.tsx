import type { VariantProps } from 'class-variance-authority';

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

const APPOINTMENT: Record<AppointmentStatus, { tone: Tone; label: string }> = {
  agendado: { tone: 'gray', label: 'Agendado' },
  confirmado: { tone: 'blue', label: 'Confirmado' },
  chegou: { tone: 'teal', label: 'Chegou' },
  em_atendimento: { tone: 'violet', label: 'Em atendimento' },
  atendido: { tone: 'green', label: 'Atendido' },
  cancelado: { tone: 'gray', label: 'Cancelado' },
  faltou: { tone: 'red', label: 'Faltou' },
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

const PAYMENT: Record<PaymentStatus, { tone: Tone; label: string }> = {
  pendente: { tone: 'amber', label: 'Pendente' },
  pago: { tone: 'green', label: 'Pago' },
  parcial: { tone: 'blue', label: 'Parcial' },
  cancelado: { tone: 'gray', label: 'Cancelado' },
  estornado: { tone: 'red', label: 'Estornado' },
};

/**
 * `overdue` NAO e um status armazenado: o Financial deriva "vencido" comparando
 * `due_date` com hoje no fuso da clinica (ver dunning-candidates.ts). A regra e
 * dele; aqui so existe a apresentacao dela, porque um pendente vencido e um
 * pendente no prazo pedem acoes diferentes e a tela precisa distinguir.
 */
export function PaymentStatusBadge({
  status,
  overdue = false,
}: {
  status: PaymentStatus;
  overdue?: boolean;
}) {
  const vencido = overdue && status === 'pendente';
  const { tone, label } = vencido ? { tone: 'red' as Tone, label: 'Vencido' } : PAYMENT[status];
  return (
    <Badge tone={tone} dot>
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
