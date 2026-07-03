'use client';

import { PenLine } from 'lucide-react';
import { useState, useTransition } from 'react';

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
import { toast } from '@/components/ui/use-toast';

import { signConsulta } from './actions';

/**
 * Assinatura do prontuário — ação crítica em Dialog de confirmação (ADR-031).
 * Após assinar, o prontuário fica imutável; a auditoria vive na action.
 */
export function SignDialog({
  prontuarioId,
  onSigned,
}: {
  prontuarioId: string;
  onSigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [needsReturn, setNeedsReturn] = useState(false);
  const [returnDays, setReturnDays] = useState('30');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    setError(null);
    start(async () => {
      const res = await signConsulta(
        prontuarioId,
        { needsReturn, returnDays: needsReturn ? Number(returnDays) : null },
        crypto.randomUUID(),
      );
      if (res.ok) {
        toast.success('Prontuário assinado', 'O documento agora é imutável.');
        setOpen(false);
        onSigned();
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="success" size="sm">
          <PenLine className="size-3.5" />
          Assinar consulta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogHeaderIcon>
            <PenLine />
          </DialogHeaderIcon>
          <div className="min-w-0">
            <DialogTitle>Assinar prontuário</DialogTitle>
            <DialogDescription>
              Após assinar, o prontuário fica <b>imutável</b> (somente leitura). Confira o conteúdo
              antes de confirmar.
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <label className="flex cursor-pointer items-center gap-2.5 text-(length:--fs-sm)">
            <Checkbox
              checked={needsReturn}
              onCheckedChange={(v) => setNeedsReturn(v === true)}
            />
            Precisa retornar
          </label>
          {needsReturn ? (
            <Field label="Retornar em (dias)" className="max-w-40">
              <Input
                type="number"
                min={1}
                max={3650}
                value={returnDays}
                onChange={(e) => setReturnDays(e.target.value)}
              />
            </Field>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" type="button">
              Cancelar
            </Button>
          </DialogClose>
          <Button variant="success" loading={pending} onClick={submit}>
            Assinar consulta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
