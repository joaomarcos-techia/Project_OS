'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { createSaasPilotInviteAction } from '../../actions/saas-pilot';

export function PilotInviteForm() {
  const [state, action, pending] = useActionState(createSaasPilotInviteAction, { error: null });
  return (
    <form action={action} className="space-y-3">
      <p>
        Convite individual para o Consultório: 1 médico, até 3 administrativos, R$ 197/mês. Preparar
        o convite não cria cobrança nem libera o plano pago.
      </p>
      <div>
        <Label htmlFor="pilot-clinic">Clínica</Label>
        <Input id="pilot-clinic" name="clinicName" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="pilot-owner">Titular</Label>
        <Input id="pilot-owner" name="ownerName" required maxLength={120} />
      </div>
      <div>
        <Label htmlFor="pilot-email">E-mail do titular</Label>
        <Input id="pilot-email" name="email" type="email" required maxLength={160} />
      </div>
      <Button type="submit" loading={pending}>
        Preparar convite do piloto
      </Button>
      {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
      {state.existing ? (
        <Alert variant="info">
          O convite já existe. Use o link previamente emitido; nenhuma duplicação foi criada.
        </Alert>
      ) : null}
      {state.link ? (
        <div>
          <Label htmlFor="pilot-link">Link individual — guarde em local protegido</Label>
          <Input id="pilot-link" value={state.link} readOnly autoComplete="off" />
          <p className="text-sm text-fg-muted">
            O link é mostrado uma vez. Abra no mesmo domínio e navegador em que fará o cadastro.
            Nenhum e-mail foi enviado automaticamente.
          </p>
        </div>
      ) : null}
    </form>
  );
}
