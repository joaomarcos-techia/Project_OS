'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  createSubstituteGuideAction,
  readGuideCancellationXmlAction,
  recordGuideCancellationReceiptAction,
  requestGuideCancellationAction,
} from '@/contexts/health-insurance/actions';
import { todayYmdIn } from '@/lib/format';
import { uuidv4 } from '@/lib/ui/uuid';

import { useRunner } from './action-ui';
import { CANCELLATION_CHANNEL_LABELS, TABLE_46_LABELS } from './constants';

/**
 * P7.5 — pedido de cancelamento à operadora. O Qoro gera o `cancelaGuia` validado no XSD oficial,
 * mas não transmite: a clínica envia pelo canal combinado com a operadora e registra o recibo.
 */
export function CancellationRequestForm({ guideId }: { guideId: string }) {
  const id = useId();
  const { pending, runAction } = useRunner();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => uuidv4());
  const [f, setF] = useState({ channel: 'portal', requestedOn: todayYmdIn(), reason: '', operatorGuideNumber: '', generateXml: true });
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Pedir o cancelamento à operadora
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      aria-label="Pedido de cancelamento à operadora"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        runAction(
          () =>
            requestGuideCancellationAction({
              guideId,
              purpose: 'substitution',
              channel: f.channel as 'portal',
              requestedOn: f.requestedOn,
              reason: f.reason,
              operatorGuideNumber: f.operatorGuideNumber.trim() || null,
              idempotencyKey: `cancelamento:${key}`,
              generateXml: f.generateXml,
            }),
          'Pedido de cancelamento registrado',
          () => setOpen(false),
          false,
          setError,
        );
      }}
    >
      <Field label="Canal" htmlFor={`${id}-c`} required>
        <Select id={`${id}-c`} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
          {Object.entries(CANCELLATION_CHANNEL_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Data do pedido" htmlFor={`${id}-d`} required>
        <Input id={`${id}-d`} type="date" value={f.requestedOn} onChange={(e) => setF({ ...f, requestedOn: e.target.value })} />
      </Field>
      <Field label="Número da guia na operadora (se houver)" htmlFor={`${id}-n`}>
        <Input id={`${id}-n`} maxLength={20} value={f.operatorGuideNumber} onChange={(e) => setF({ ...f, operatorGuideNumber: e.target.value })} />
      </Field>
      <Field label="Motivo" htmlFor={`${id}-m`} hint="10 a 500 caracteres. Ex.: guia enviada com o tipo de consulta errado." required>
        <Textarea id={`${id}-m`} rows={2} maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <label className="flex items-center gap-(--sp-2) text-(length:--fs-sm)" htmlFor={`${id}-x`}>
        <input id={`${id}-x`} type="checkbox" checked={f.generateXml} onChange={(e) => setF({ ...f, generateXml: e.target.checked })} />
        Gerar o XML do pedido (cancelaGuia, validado no XSD oficial)
      </label>
      {error ? (
        <p role="alert" className="text-(length:--fs-sm) text-danger-600">
          {error}
        </p>
      ) : null}
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" variant="primary" disabled={pending || f.reason.trim().length < 10}>
          {pending ? 'Aguarde…' : 'Registrar o pedido'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** P7.5 — recibo da operadora (Tabela 46). Sem protocolo nem comprovante, não há recibo. */
export function CancellationReceiptForm({ cancellationId }: { cancellationId: string }) {
  const id = useId();
  const { pending, runAction } = useRunner();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => uuidv4());
  const [f, setF] = useState({ statusCode: '1', receivedOn: todayYmdIn(), operatorProtocol: '', operatorMessage: '', evidenceSha256: '' });
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Registrar o recibo da operadora
      </Button>
    );
  }
  const noEvidence = !f.operatorProtocol.trim() && !f.evidenceSha256.trim();
  return (
    <form
      className="flex flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      aria-label="Recibo do cancelamento"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (noEvidence) {
          setError('Informe o protocolo da operadora ou o SHA-256 do comprovante: sem evidência, não há recibo.');
          return;
        }
        runAction(
          () =>
            recordGuideCancellationReceiptAction({
              cancellationId,
              statusCode: f.statusCode as '1',
              receivedOn: f.receivedOn,
              operatorProtocol: f.operatorProtocol.trim() || null,
              operatorMessage: f.operatorMessage.trim() || null,
              evidenceSha256: f.evidenceSha256.trim().toLowerCase() || null,
              idempotencyKey: `recibo-cancelamento:${key}`,
            }),
          'Recibo registrado',
          () => setOpen(false),
          false,
          setError,
        );
      }}
    >
      <Field label="Situação informada pela operadora (Tabela 46)" htmlFor={`${id}-s`} required>
        <Select id={`${id}-s`} value={f.statusCode} onChange={(e) => setF({ ...f, statusCode: e.target.value })}>
          {Object.entries(TABLE_46_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Data do recibo" htmlFor={`${id}-d`} required>
        <Input id={`${id}-d`} type="date" value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} />
      </Field>
      <Field label="Protocolo da operadora" htmlFor={`${id}-p`} hint="Até 12 caracteres.">
        <Input id={`${id}-p`} maxLength={12} value={f.operatorProtocol} onChange={(e) => setF({ ...f, operatorProtocol: e.target.value })} />
      </Field>
      <Field label="SHA-256 do comprovante (opcional)" htmlFor={`${id}-h`} hint="Do arquivo do recibo guardado pela clínica.">
        <Input id={`${id}-h`} maxLength={64} value={f.evidenceSha256} onChange={(e) => setF({ ...f, evidenceSha256: e.target.value })} />
      </Field>
      <Field label="Mensagem da operadora (opcional)" htmlFor={`${id}-m`}>
        <Textarea id={`${id}-m`} rows={2} maxLength={500} value={f.operatorMessage} onChange={(e) => setF({ ...f, operatorMessage: e.target.value })} />
      </Field>
      {error ? (
        <p role="alert" className="text-(length:--fs-sm) text-danger-600">
          {error}
        </p>
      ) : null}
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" variant="primary" disabled={pending}>
          {pending ? 'Aguarde…' : 'Registrar o recibo'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Baixa o `cancelaGuia` guardado (ISO-8859-1, como o padrão exige). */
export function CancellationXmlButton({ cancellationId }: { cancellationId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-(--sp-1)">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await readGuideCancellationXmlAction({ cancellationId });
            if (!r.ok) {
              setError(r.error);
              return;
            }
            const bytes = Uint8Array.from(r.data.xml, (ch) => ch.charCodeAt(0) & 0xff);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/xml' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = r.data.fileName;
            a.click();
            URL.revokeObjectURL(url);
          } finally {
            setBusy(false);
          }
        }}
      >
        Baixar o XML do pedido
      </Button>
      {error ? (
        <span role="alert" className="text-(length:--fs-sm) text-danger-600">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** Rascunho da substituta (cópia da original para corrigir). Aprovar exige o recibo 1 — regra do banco. */
export function CreateSubstituteButton({ originalGuideId }: { originalGuideId: string }) {
  const router = useRouter();
  const { pending, runAction } = useRunner();
  const [key] = useState(() => uuidv4());
  return (
    <Button
      type="button"
      size="sm"
      variant="primary"
      disabled={pending}
      onClick={() =>
        runAction(
          async () => {
            const r = await createSubstituteGuideAction({ originalGuideId, idempotencyKey: `substituta:${key}` });
            if (r.ok) router.push(`/convenios/guias/${r.data}`);
            return r;
          },
          'Substituta criada para conferir',
        )
      }
    >
      Criar a guia substituta
    </Button>
  );
}
