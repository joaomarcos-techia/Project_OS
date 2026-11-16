'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { recordConsultaAuthorizationResponseAction } from '@/contexts/health-insurance/actions';
import { todayYmdIn } from '@/lib/format';

import { useRunner } from './action-ui';

type Item = { id: string; label: string; requested: number };

/**
 * P6.3 — registrar a resposta da operadora a um pedido de autorização da Guia de Consulta. O
 * servidor confere estado, versão, evidência, datas e quantidades; aqui só se ajuda a preencher.
 * A senha vai cifrada e não volta à tela.
 */
export function ConsultaAuthorizationResponseForm({
  authorizationId,
  version,
  requestedOn,
  items,
}: {
  authorizationId: string;
  version: number;
  requestedOn: string | null;
  items: Item[];
}) {
  const id = useId();
  const { pending, runAction } = useRunner();
  const [open, setOpen] = useState(false);
  const [decision, setDecision] = useState<'authorized' | 'denied'>('authorized');
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, String(i.requested)])));
  const [f, setF] = useState({
    authorizedOn: todayYmdIn(),
    operatorGuideNumber: '',
    operatorProtocol: '',
    password: '',
    passwordValidUntil: '',
    denialReason: '',
  });

  if (!open) {
    return (
      <Button type="button" size="sm" variant="primary" onClick={() => setOpen(true)}>
        Registrar resposta da operadora
      </Button>
    );
  }

  const noEvidence = decision === 'authorized' && !f.operatorGuideNumber.trim() && !f.password.trim() && !f.operatorProtocol.trim();
  const submit = () => {
    setError(null);
    if (noEvidence) {
      setError('Informe o número da guia na operadora, a senha ou o protocolo. Sem evidência da operadora, não há autorização.');
      return;
    }
    runAction(
      () =>
        decision === 'denied'
          ? recordConsultaAuthorizationResponseAction({ decision: 'denied', authorizationId, version, denialReason: f.denialReason })
          : recordConsultaAuthorizationResponseAction({
              decision: 'authorized',
              authorizationId,
              version,
              authorizedOn: f.authorizedOn,
              operatorGuideNumber: f.operatorGuideNumber.trim() || null,
              operatorProtocol: f.operatorProtocol.trim() || null,
              password: f.password.trim() || null,
              passwordValidUntil: f.passwordValidUntil || null,
              items: items.map((i) => ({ itemId: i.id, quantityAuthorized: Number(q[i.id] ?? 0) })),
            }),
      decision === 'denied' ? 'Negativa registrada' : 'Autorização registrada',
      () => setOpen(false),
      false,
      setError,
    );
  };

  return (
    <form
      aria-label="Resposta da operadora"
      className="flex w-full flex-col gap-(--sp-3) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <fieldset className="flex flex-wrap gap-(--sp-4)">
        <legend className="mb-(--sp-1) text-(length:--fs-sm) font-medium">O que a operadora respondeu</legend>
        <label className="flex items-center gap-(--sp-1) text-(length:--fs-sm)">
          <input type="radio" name={`${id}-decision`} value="authorized" checked={decision === 'authorized'} onChange={() => setDecision('authorized')} />
          Autorizou (no todo ou em parte)
        </label>
        <label className="flex items-center gap-(--sp-1) text-(length:--fs-sm)">
          <input type="radio" name={`${id}-decision`} value="denied" checked={decision === 'denied'} onChange={() => setDecision('denied')} />
          Negou
        </label>
      </fieldset>

      {decision === 'denied' ? (
        <Field label="Motivo informado pela operadora" htmlFor={`${id}-reason`} required>
          <Textarea id={`${id}-reason`} value={f.denialReason} maxLength={500} onChange={(e) => setF({ ...f, denialReason: e.target.value })} />
        </Field>
      ) : (
        <>
          <p className="text-(length:--fs-sm) text-fg-muted">
            Registre exatamente o que a operadora concedeu. Sem número, senha ou protocolo da operadora, não há autorização.
          </p>
          <div className="grid gap-(--sp-3) md:grid-cols-3">
            <Field
              label="Data da autorização"
              htmlFor={`${id}-on`}
              required
              hint={requestedOn ? `Não pode ser antes do pedido nem depois de hoje.` : undefined}
            >
              <Input id={`${id}-on`} type="date" min={requestedOn ?? undefined} value={f.authorizedOn} onChange={(e) => setF({ ...f, authorizedOn: e.target.value })} />
            </Field>
            <Field label="Número da guia na operadora" htmlFor={`${id}-num`}>
              <Input id={`${id}-num`} value={f.operatorGuideNumber} maxLength={20} onChange={(e) => setF({ ...f, operatorGuideNumber: e.target.value })} />
            </Field>
            <Field label="Protocolo" htmlFor={`${id}-prot`}>
              <Input id={`${id}-prot`} value={f.operatorProtocol} maxLength={40} onChange={(e) => setF({ ...f, operatorProtocol: e.target.value })} />
            </Field>
            <Field label="Senha" htmlFor={`${id}-pwd`} hint="Guardada cifrada; não aparece de novo na tela.">
              <Input id={`${id}-pwd`} value={f.password} maxLength={64} autoComplete="off" onChange={(e) => setF({ ...f, password: e.target.value })} />
            </Field>
            <Field label="Validade da senha" htmlFor={`${id}-val`}>
              <Input id={`${id}-val`} type="date" value={f.passwordValidUntil} onChange={(e) => setF({ ...f, passwordValidUntil: e.target.value })} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-(--sp-2)">
            <legend className="text-(length:--fs-sm) font-medium">Quantidade autorizada por procedimento</legend>
            {items.map((i) => (
              <Field key={i.id} label={`${i.label} (pedido: ${i.requested})`} htmlFor={`${id}-q-${i.id}`}>
                <Input
                  id={`${id}-q-${i.id}`}
                  type="number"
                  min={0}
                  max={i.requested}
                  className="w-24"
                  value={q[i.id] ?? ''}
                  onChange={(e) => setQ({ ...q, [i.id]: e.target.value })}
                />
              </Field>
            ))}
          </fieldset>
        </>
      )}

      {error ? (
        <p role="alert" className="text-(length:--fs-sm) text-danger-600">
          {error}
        </p>
      ) : null}
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? 'Aguarde…' : 'Confirmar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}
