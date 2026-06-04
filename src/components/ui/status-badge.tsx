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

export type PaymentStatus = 'pendente' | 'pago' | 'parcial' | 'cancelado' | 'estornado';

const PAYMENT: Record<PaymentStatus, { tone: Tone; label: string }> = {
  pendente: { tone: 'amber', label: 'Pendente' },
  pago: { tone: 'green', label: 'Pago' },
  parcial: { tone: 'blue', label: 'Parcial' },
  cancelado: { tone: 'gray', label: 'Cancelado' },
  estornado: { tone: 'red', label: 'Estornado' },
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const { tone, label } = PAYMENT[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}
