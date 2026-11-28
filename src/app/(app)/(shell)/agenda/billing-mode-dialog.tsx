'use client';

/**
 * P4.3 — "Forma de atendimento": trocar particular ↔ convênio de um atendimento já criado,
 * até a chegada do paciente. Não é troca de etiqueta: o servidor confere guia, coparticipação
 * e pagamento do paciente, troca a modalidade e registra (ou cancela, sem apagar) a cobertura
 * numa transação, com o motivo na auditoria. Virando convênio, o link particular ainda aberto
 * é anulado; nenhuma cobrança é criada pela troca.
 */
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
import { useActionFeedback, type ActionFeedback } from '@/components/ui/use-action-feedback';
import type { SchedulingInsuranceOptions } from '@/contexts/health-insurance/config-queries';
import { uuidv4 } from '@/lib/ui/uuid';

import { trocarFormaDeAtendimentoAction } from './actions';
import type { AgendaAppt } from './data';
import {
  InsuranceBillingFields,
  emptyBilling,
  type BillingValue,
} from './insurance-billing-fields';

type Outcome = { ok: true; message: string } | { ok: false; message: string } | null;

export function BillingModeDialog({
  appointment,
  insurance,
}: {
  appointment: AgendaAppt;
  insurance: SchedulingInsuranceOptions | null | undefined;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const isConvenio = appointment.convenio !== null;
  const target: 'particular' | 'convenio' = isConvenio ? 'particular' : 'convenio';
  const [billing, setBilling] = useState<BillingValue>({ ...emptyBilling(), mode: 'convenio' });
  const [reason, setReason] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(uuidv4);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonId = useId();

  useActionFeedback(
    outcome,
    (o): ActionFeedback =>
      o === null
        ? null
        : o.ok
          ? { type: 'success', title: 'Forma de atendimento alterada', description: o.message }
          : null,
  );

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await trocarFormaDeAtendimentoAction({
        appointmentId: appointment.id,
        to: target,
        insurerId: target === 'convenio' ? billing.insurerId || null : null,
        planId: target === 'convenio' ? billing.planId || null : null,
        membershipId: target === 'convenio' ? billing.membershipId || null : null,
        guideType: billing.guideType,
        reason,
        idempotencyKey,
      });
      if (!result.ok) {
        setError(result.error);
        setOutcome({ ok: false, message: result.error });
        return;
      }
      const pendencias = result.data.issues.length
        ? ` Pendências da cobertura: ${result.data.issues.join(' ')}`
        : '';
      setOutcome({
        ok: true,
        message:
          result.data.to === 'convenio'
            ? `Agora é convênio. O paciente não recebe cobrança da consulta; só a coparticipação confirmada.${pendencias}`
            : 'Agora é particular. A cobertura foi encerrada (fica no histórico) e nenhuma cobrança foi criada.',
      });
      setOpen(false);
      setReason('');
      setIdempotencyKey(uuidv4());
      router.refresh();
    });
  };

  const canSubmit =
    !pending && reason.trim().length >= 10 && (target === 'particular' || billing.insurerId !== '');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-10"
          data-testid="billing-mode-open"
        >
          {isConvenio ? 'Mudar para particular' : 'Mudar para convênio'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <div>
            <DialogTitle>Forma de atendimento</DialogTitle>
            <DialogDescription className="text-pretty">
              {isConvenio
                ? `Hoje: convênio${appointment.convenio?.insurerName ? ` (${appointment.convenio.insurerName})` : ''}. A cobertura é encerrada sem ser apagada e a autorização não é consumida. Nenhuma cobrança é criada agora: o valor particular entra no Caixa na conclusão.`
                : 'Hoje: particular. Um link de pagamento ainda aberto é anulado. Se o paciente já pagou, a troca é recusada até o Caixa decidir o dinheiro.'}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4" data-testid="billing-mode-dialog">
          {target === 'convenio' ? (
            insurance?.enabled ? (
              <InsuranceBillingFields
                options={insurance}
                patientId={appointment.patientId}
                value={billing}
                onChange={(next) => setBilling({ ...next, mode: 'convenio' })}
              />
            ) : (
              <Alert variant="warning">Convênios não está habilitado para esta clínica.</Alert>
            )
          ) : null}
          <Field
            label="Motivo da troca"
            htmlFor={reasonId}
            hint="Fica na auditoria. Ex.: paciente apresentou a carteirinha na recepção."
            required
          >
            <Textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={10}
              maxLength={500}
              required
              disabled={pending}
            />
          </Field>
          {error ? (
            <Alert variant="danger" data-testid="billing-mode-error">
              {error}
            </Alert>
          ) : null}
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
          <Button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            data-testid="billing-mode-submit"
          >
            {pending
              ? 'Alterando…'
              : target === 'convenio'
                ? 'Mudar para convênio'
                : 'Mudar para particular'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
