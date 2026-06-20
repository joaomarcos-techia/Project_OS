import { Badge } from '@/components/ui/badge';

import type { HealthStatus } from '../_lib/dto';

/**
 * Mapeamento status → COR vive AQUI (camada de UI — review #10). Os serviços
 * devolvem só semântica ('ok'|'degraded'|'down', status de clínica, etc.).
 */
type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'teal' | 'violet';

const HEALTH_TONE: Record<HealthStatus, Tone> = { ok: 'green', degraded: 'amber', down: 'red' };
const HEALTH_LABEL: Record<HealthStatus, string> = {
  ok: 'Operacional',
  degraded: 'Instável',
  down: 'Fora do ar',
};

export function HealthBadge({ status }: { status: HealthStatus }) {
  return (
    <Badge tone={HEALTH_TONE[status]} dot>
      {HEALTH_LABEL[status]}
    </Badge>
  );
}

function clinicTone(status: string): Tone {
  if (status === 'active') return 'green';
  if (status === 'trial') return 'blue';
  if (status === 'cancelled') return 'red';
  if (status === 'pending_payment' || status.startsWith('suspended')) return 'amber';
  return 'gray';
}

export function ClinicStatusBadge({ status }: { status: string }) {
  return <Badge tone={clinicTone(status)}>{status}</Badge>;
}

function billingTone(status: string): Tone {
  if (status === 'active') return 'green';
  if (status === 'trial') return 'blue';
  if (status === 'past_due') return 'amber';
  if (status === 'cancelled') return 'red';
  return 'gray';
}

export function BillingBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-fg-subtle">—</span>;
  return <Badge tone={billingTone(status)}>{status}</Badge>;
}
