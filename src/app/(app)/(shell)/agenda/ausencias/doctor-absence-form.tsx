'use client';

import { useActionState, useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useActionFeedback } from '@/components/ui/use-action-feedback';
import { uuidv4 } from '@/lib/ui/uuid';

import { criarAusenciaMedicaAction, type AgendaOperationState } from '../actions';
import type { DoctorOption } from '../data';

export function DoctorAbsenceForm({ doctors }: { doctors: DoctorOption[] }) {
  const [strategy, setStrategy] = useState<'cancel' | 'transfer'>('transfer');
  const [doctorId, setDoctorId] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(uuidv4);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<AgendaOperationState, FormData>(
    criarAusenciaMedicaAction,
    null,
  );

  useActionFeedback(state, (result) =>
    result === null
      ? null
      : result.ok
        ? { type: 'success', title: 'Ausência registrada', description: result.message }
        : { type: 'error', title: 'Não foi possível registrar', description: result.message },
  );

  useEffect(() => {
    if (!state?.ok) return;
    formRef.current?.reset();
    setDoctorId('');
    setStrategy('transfer');
    setIdempotencyKey(uuidv4());
  }, [state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-4">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Alert variant="warning" title="A agenda será reorganizada imediatamente">
        Atendimentos agendados ou confirmados dentro do período serão transferidos ou cancelados em
        uma única operação. Revise o período e a estratégia antes de confirmar.
      </Alert>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Profissional ausente" required>
          <Select
            name="doctorId"
            value={doctorId}
            onChange={(event) => setDoctorId(event.target.value)}
            required
            disabled={pending}
          >
            <option value="">Selecione</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.nome}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estratégia" required>
          <Select
            name="strategy"
            value={strategy}
            onChange={(event) => setStrategy(event.target.value as 'cancel' | 'transfer')}
            disabled={pending}
          >
            <option value="transfer">Transferir atendimentos</option>
            <option value="cancel">Cancelar atendimentos</option>
          </Select>
        </Field>
        <Field label="Início no fuso da clínica" required>
          <Input type="datetime-local" name="startsAt" required disabled={pending} />
        </Field>
        <Field label="Fim no fuso da clínica" required>
          <Input type="datetime-local" name="endsAt" required disabled={pending} />
        </Field>
        {strategy === 'transfer' ? (
          <Field label="Profissional substituto" required className="md:col-span-2">
            <Select name="replacementDoctorId" required disabled={pending}>
              <option value="">Selecione</option>
              {doctors
                .filter((doctor) => doctor.id !== doctorId)
                .map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.nome}
                  </option>
                ))}
            </Select>
          </Field>
        ) : null}
        <Field label="Motivo" required className="md:col-span-2">
          <Textarea name="reason" required maxLength={500} disabled={pending} />
        </Field>
      </div>
      <Button
        type="submit"
        disabled={pending || doctors.length === 0}
        className="min-h-10 self-start"
      >
        {pending ? 'Reorganizando…' : 'Registrar e reorganizar agenda'}
      </Button>
    </form>
  );
}
