'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useActionFeedback } from '@/components/ui/use-action-feedback';
import type { AppointmentRecoveryKind } from '@/contexts/scheduling/recovery-policy';
import { uuidv4 } from '@/lib/ui/uuid';

import { corrigirAtendimentoAction, type AgendaOperationState } from './actions';
import type { AgendaAppt, DoctorOption } from './data';

const LABELS: Record<AppointmentRecoveryKind, string> = {
  interrupt: 'Interromper atendimento e voltar para a espera',
  exceptional_cancel: 'Cancelar excepcionalmente',
  reopen: 'Reabrir atendimento',
  transfer: 'Transferir para outro profissional',
};

export function AppointmentCorrectionDialog({
  appointment,
  doctors,
}: {
  appointment: AgendaAppt;
  doctors: DoctorOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<AppointmentRecoveryKind>(appointment.recoveryKinds[0]!);
  const [idempotencyKey, setIdempotencyKey] = useState(uuidv4);
  const [state, action, pending] = useActionState<AgendaOperationState, FormData>(
    corrigirAtendimentoAction,
    null,
  );
  const kindId = useId();
  const doctorId = useId();
  const reasonId = useId();

  useActionFeedback(state, (result) =>
    result === null
      ? null
      : result.ok
        ? { type: 'success', title: 'Agenda corrigida', description: result.message }
        : { type: 'error', title: 'Não foi possível corrigir', description: result.message },
  );

  useEffect(() => {
    if (!state?.ok) return;
    setOpen(false);
    setIdempotencyKey(uuidv4());
    router.refresh();
  }, [router, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm" className="min-h-10">
          Corrigir
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <DialogHeader>
            <div>
              <DialogTitle>Corrigir atendimento</DialogTitle>
              <DialogDescription className="text-pretty">
                A correção fica registrada com status anterior, novo status, responsável e motivo.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <input type="hidden" name="appointmentId" value={appointment.id} />
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <Field label="Correção" htmlFor={kindId} required>
              <Select
                id={kindId}
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as AppointmentRecoveryKind)}
                disabled={pending}
              >
                {appointment.recoveryKinds.map((value) => (
                  <option key={value} value={value}>
                    {LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === 'transfer' ? (
              <Field label="Novo profissional" htmlFor={doctorId} required>
                <Select id={doctorId} name="newDoctorId" required disabled={pending}>
                  <option value="">Selecione</option>
                  {doctors
                    .filter((doctor) => doctor.id !== appointment.doctorId)
                    .map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.nome}
                      </option>
                    ))}
                </Select>
              </Field>
            ) : null}
            <Field
              label="Motivo"
              htmlFor={reasonId}
              hint="Explique o fato que exige a correção excepcional."
              required
            >
              <Textarea
                id={reasonId}
                name="reason"
                minLength={1}
                maxLength={500}
                required
                disabled={pending}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Voltar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Registrando…' : 'Registrar correção'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
