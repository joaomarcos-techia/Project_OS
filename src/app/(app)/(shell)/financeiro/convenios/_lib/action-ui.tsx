'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import type { ActionResult } from '@/contexts/health-insurance/actions';
import { uuidv4 } from '@/lib/ui/uuid';

import { toCents } from './batch-ui';

/** Data local (AAAA-MM-DD), não a de UTC: à noite, `toISOString` já seria amanhã. */
const localToday = () => new Date().toLocaleDateString('sv-SE');

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';

function useRunner() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const runAction = (fn: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        after?.();
        router.refresh();
      } else {
        toast.error(r.error);
      }
    });
  return { pending, runAction };
}

/** Botão que dispara uma ação já vinculada aos dados (server action com `.bind`). */
export function ActionButton({
  label,
  success,
  action,
  variant = 'secondary',
}: {
  label: string;
  success: string;
  action: () => Promise<ActionResult<unknown>>;
  variant?: Variant;
}) {
  const { pending, runAction } = useRunner();
  return (
    <Button type="button" size="sm" variant={variant} disabled={pending} onClick={() => runAction(action, success)}>
      {pending ? 'Aguarde…' : label}
    </Button>
  );
}

/** Ação que exige um texto (motivo, evidência): o botão abre o campo; confirmar envia. */
export function TextAction<T extends Record<string, unknown>>({
  label,
  success,
  action,
  base,
  field,
  fieldLabel,
  hint,
  minLength = 10,
  variant = 'secondary',
  extra,
}: {
  label: string;
  success: string;
  action: (input: T) => Promise<ActionResult<unknown>>;
  base: Partial<T>;
  field: string;
  fieldLabel: string;
  hint?: string;
  minLength?: number;
  variant?: Variant;
  /** Campo de data opcional (ex.: data do envio). */
  extra?: { field: string; label: string; type: 'date' };
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [date, setDate] = useState(localToday);
  const { pending, runAction } = useRunner();
  if (!open) {
    return (
      <Button type="button" size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        const input = { ...base, [field]: text.trim(), ...(extra ? { [extra.field]: date } : {}) } as unknown as T;
        runAction(() => action(input), success, () => {
          setOpen(false);
          setText('');
        });
      }}
    >
      <Field label={fieldLabel} htmlFor={`${id}-text`} {...(hint ? { hint } : {})} required>
        <Textarea id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={500} />
      </Field>
      {extra ? (
        <Field label={extra.label} htmlFor={`${id}-date`} required>
          <Input id={`${id}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      ) : null}
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" variant={variant === 'danger' ? 'danger' : 'primary'} disabled={pending || text.trim().length < minLength}>
          {pending ? 'Aguarde…' : 'Confirmar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Recurso: escolher as glosas em aberto da guia e escrever a justificativa (sempre humana). */
export function AppealForm({
  guideId,
  glosses,
  action,
}: {
  guideId: string;
  glosses: Array<{ id: string; label: string }>;
  action: (input: { guideId: string; glossIds: string[]; justification: string; idempotencyKey: string }) => Promise<ActionResult<unknown>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [key] = useState(() => uuidv4());
  const { pending, runAction } = useRunner();
  if (glosses.length === 0) return null;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Preparar recurso
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        runAction(() => action({ guideId, glossIds: chosen, justification: text.trim(), idempotencyKey: key }), 'Recurso preparado', () => setOpen(false));
      }}
    >
      <fieldset className="flex flex-col gap-1">
        <legend className="text-(length:--fs-sm) font-medium">Glosas contestadas neste recurso</legend>
        {glosses.map((g) => (
          <label key={g.id} className="flex items-center gap-2 text-(length:--fs-sm)">
            <input
              type="checkbox"
              checked={chosen.includes(g.id)}
              onChange={(e) => setChosen((c) => (e.target.checked ? [...c, g.id] : c.filter((x) => x !== g.id)))}
            />
            {g.label}
          </label>
        ))}
      </fieldset>
      <Field label="Justificativa" htmlFor={`${id}-j`} hint="Escrita por você: o Qoro não gera justificativa de recurso." required>
        <Textarea id={`${id}-j`} value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={4000} />
      </Field>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" disabled={pending || chosen.length === 0 || text.trim().length < 30}>
          {pending ? 'Aguarde…' : 'Salvar recurso'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Apresentar o recurso: data e protocolo da operadora (ou a evidência do envio). */
export function FileAppealForm({
  appealId,
  version,
  action,
}: {
  appealId: string;
  version: number;
  action: (input: { appealId: string; version: number; filedOn: string; protocol?: string; evidence?: string }) => Promise<ActionResult<unknown>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [protocol, setProtocol] = useState('');
  const [evidence, setEvidence] = useState('');
  const [date, setDate] = useState(localToday);
  const { pending, runAction } = useRunner();
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Registrar envio do recurso
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        runAction(
          () => action({ appealId, version, filedOn: date, ...(protocol.trim() ? { protocol: protocol.trim() } : {}), ...(evidence.trim() ? { evidence: evidence.trim() } : {}) }),
          'Envio do recurso registrado',
          () => setOpen(false),
        );
      }}
    >
      <Field label="Data do envio" htmlFor={`${id}-d`} required>
        <Input id={`${id}-d`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Protocolo da operadora" htmlFor={`${id}-p`}>
        <Input id={`${id}-p`} value={protocol} onChange={(e) => setProtocol(e.target.value)} maxLength={60} />
      </Field>
      <Field label="Ou: como foi enviado (sem protocolo)" htmlFor={`${id}-e`} hint="Ex.: portal da operadora, e-mail ao setor de recursos, com data e hora.">
        <Textarea id={`${id}-e`} value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} maxLength={500} />
      </Field>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" disabled={pending || (!protocol.trim() && evidence.trim().length < 10)}>
          {pending ? 'Aguarde…' : 'Registrar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Resposta da operadora ao recurso: quanto foi aceito em cada glosa. */
export function AnswerAppealForm({
  appealId,
  version,
  glosses,
  action,
}: {
  appealId: string;
  version: number;
  glosses: Array<{ id: string; label: string; amountCents: number }>;
  action: (input: { appealId: string; version: number; answeredOn: string; items: Array<{ glossId: string; acceptedCents: number }>; note?: string }) => Promise<ActionResult<unknown>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(localToday);
  const { pending, runAction } = useRunner();
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Registrar resposta
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        const items = glosses.map((g) => ({ glossId: g.id, acceptedCents: toCents(values[g.id] ?? '0') || 0 }));
        runAction(() => action({ appealId, version, answeredOn: date, items }), 'Resposta registrada', () => setOpen(false));
      }}
    >
      <Field label="Data da resposta" htmlFor={`${id}-d`} required>
        <Input id={`${id}-d`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {glosses.map((g) => (
        <Field key={g.id} label={`Aceito pela operadora — ${g.label}`} htmlFor={`${id}-${g.id}`} hint="Valor revertido a favor da clínica (0 = recurso negado).">
          <Input
            id={`${id}-${g.id}`}
            inputMode="decimal"
            value={values[g.id] ?? ''}
            onChange={(e) => setValues((v) => ({ ...v, [g.id]: e.target.value }))}
            placeholder="0,00"
          />
        </Field>
      ))}
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Aguarde…' : 'Registrar resposta'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Contêiner simples para alinhar ações. */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-start gap-(--sp-2)">{children}</div>;
}
