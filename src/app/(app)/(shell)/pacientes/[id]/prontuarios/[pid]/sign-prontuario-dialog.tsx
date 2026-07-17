'use client';

import { PenLine } from 'lucide-react';
import { useActionState, useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderIcon,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { signProntuarioForm, type FormState } from '../actions';
import { uuidv4 } from '@/lib/ui/uuid';

const INITIAL: FormState = { error: null };

/**
 * Assinatura do prontuário em Dialog crítico (?assinar=1 abre direto) — a rota
 * /assinar foi aposentada; o contexto do documento permanece na tela. O gate
 * sign:prontuario e a auditoria vivem na Server Action (inalterada).
 */
export function SignProntuarioDialog({
  patientId,
  prontuarioId,
  defaultOpen = false,
  empty = false,
}: {
  patientId: string;
  prontuarioId: string;
  defaultOpen?: boolean;
  /** prontuário sem conteúdo — bloqueia a confirmação com aviso. */
  empty?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [state, action, pending] = useActionState(signProntuarioForm, INITIAL);
  const key = useMemo(() => uuidv4(), []);
  const [needsReturn, setNeedsReturn] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <PenLine className="size-3.5" />
          Assinar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form action={action}>
          <input type="hidden" name="patientId" value={patientId} />
          <input type="hidden" name="prontuarioId" value={prontuarioId} />
          <input type="hidden" name="idempotencyKey" value={key} />

          <DialogHeader>
            <DialogHeaderIcon>
              <PenLine />
            </DialogHeaderIcon>
            <div className="min-w-0">
              <DialogTitle>Assinar prontuário</DialogTitle>
              <DialogDescription>
                Ao assinar, o prontuário torna-se <b>imutável</b>. Correções posteriores ficam
                registradas no histórico (com motivo).
              </DialogDescription>
            </div>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-3">
            {empty ? (
              <Alert variant="danger">
                O prontuário está vazio — preencha o conteúdo antes de assinar.
              </Alert>
            ) : null}
            <label className="flex cursor-pointer items-center gap-2.5 text-(length:--fs-sm)">
              <Checkbox
                name="needsReturn"
                checked={needsReturn}
                onCheckedChange={(v) => setNeedsReturn(v === true)}
              />
              Paciente precisa retornar
            </label>
            {needsReturn ? (
              <Field label="Retornar em (dias)" className="max-w-40">
                <Input type="number" name="returnDays" min={1} max={3650} defaultValue={90} />
              </Field>
            ) : null}
            {state.error ? <p className="text-sm text-danger-600">{state.error}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" type="button">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" loading={pending} disabled={empty}>
              Assinar prontuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
