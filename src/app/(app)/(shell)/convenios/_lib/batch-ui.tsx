'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import {
  allocatePaymentAction,
  createBatchAction,
  recordBatchProtocolAction,
  recordGlossAction,
  recordPaymentAction,
} from '@/contexts/health-insurance/actions';
import { uuidv4 } from '@/lib/ui/uuid';

/** '1.500,00' e '150,5' (pt-BR) ou '150.50': com vírgula, o ponto é milhar; sem vírgula, é decimal. */
export function toCents(v: string): number {
  const t = v.trim();
  const n = t.includes(',') ? Number(t.replace(/\./gu, '').replace(',', '.')) : Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}
const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const today = () => new Date().toLocaleDateString('sv-SE');

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    submit: <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success: string, after?: (data: T) => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error);
          return;
        }
        toast.success(success);
        after?.(r.data);
        router.refresh();
      }),
  };
}

/** Lote novo: uma operadora, guias APROVADAS dela (máximo 100 por lote, regra do TISS). */
export function NewBatchForm({
  candidates,
}: {
  candidates: Array<{ insurerId: string; name: string; guides: Array<{ id: string; number: string; guideType: string; patientName: string | null; totalValueCents: number }> }>;
}) {
  const id = useId();
  const router = useRouter();
  const [insurerId, setInsurerId] = useState(candidates.find((c) => c.guides.length > 0)?.insurerId ?? '');
  const [chosen, setChosen] = useState<string[]>([]);
  const [guideType, setGuideType] = useState<'consulta' | 'sp_sadt'>('consulta');
  const [key] = useState(() => uuidv4());
  const { pending, submit } = useSubmit();
  const current = candidates.find((c) => c.insurerId === insurerId);
  // Um lote tem um tipo de guia só (padrão TISS): Consulta ou SP/SADT.
  const consulta = useMemo(() => (current?.guides ?? []).filter((g) => g.guideType === guideType), [current, guideType]);
  const total = consulta.filter((g) => chosen.includes(g.id)).reduce((s, g) => s + g.totalValueCents, 0);
  if (!candidates.some((c) => c.guides.length > 0)) {
    return <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma guia aprovada esperando lote.</p>;
  }
  return (
    <form
      className="flex flex-col gap-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => createBatchAction({ insurerId, guideType, guideIds: chosen, idempotencyKey: key }), 'Lote montado', (batchId) => router.push(`/convenios/lotes/${batchId}`));
      }}
    >
      <Field label="Operadora" htmlFor={`${id}-ins`} required>
        <Select
          id={`${id}-ins`}
          value={insurerId}
          onChange={(e) => {
            setInsurerId(e.target.value);
            setChosen([]);
          }}
        >
          {candidates.map((c) => (
            <option key={c.insurerId} value={c.insurerId}>
              {c.name} ({c.guides.length} aprovadas)
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Tipo de guia" htmlFor={`${id}-type`} required>
        <Select
          id={`${id}-type`}
          value={guideType}
          onChange={(e) => {
            setGuideType(e.target.value === 'sp_sadt' ? 'sp_sadt' : 'consulta');
            setChosen([]);
          }}
        >
          <option value="consulta">Consulta</option>
          <option value="sp_sadt">SP/SADT</option>
        </Select>
      </Field>
      <fieldset className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-(--r-md) border border-border p-(--sp-2)">
        <legend className="px-1 text-(length:--fs-sm) font-medium">{guideType === 'consulta' ? 'Guias de consulta aprovadas' : 'Guias SP/SADT aprovadas'}</legend>
        <label className="flex items-center gap-2 text-(length:--fs-sm) font-medium">
          <input
            type="checkbox"
            checked={consulta.length > 0 && chosen.length === Math.min(consulta.length, 100)}
            onChange={(e) => setChosen(e.target.checked ? consulta.slice(0, 100).map((g) => g.id) : [])}
          />
          Todas (até 100)
        </label>
        {consulta.map((g) => (
          <label key={g.id} className="flex items-center gap-2 text-(length:--fs-sm)">
            <input
              type="checkbox"
              checked={chosen.includes(g.id)}
              disabled={!chosen.includes(g.id) && chosen.length >= 100}
              onChange={(e) => setChosen((c) => (e.target.checked ? [...c, g.id] : c.filter((x) => x !== g.id)))}
            />
            <span className="tabular-nums">{g.number}</span>
            <span className="text-fg-muted">{g.patientName ?? ''}</span>
            <span className="ml-auto tabular-nums">{brl(g.totalValueCents)}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center justify-between">
        <span className="text-(length:--fs-sm) text-fg-muted">
          {chosen.length} guia(s) · {brl(total)}
        </span>
        <Button type="submit" disabled={pending || chosen.length === 0}>
          {pending ? 'Montando…' : 'Montar lote'}
        </Button>
      </div>
    </form>
  );
}

/** Protocolo: número da operadora + recibo anexado (o SHA-256 do recibo vira a evidência). */
export function ProtocolForm({ batchId, version }: { batchId: string; version: number }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const { pending, submit } = useSubmit();
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Registrar protocolo
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        fd.set('batchId', batchId);
        fd.set('version', String(version));
        submit(() => recordBatchProtocolAction(fd), 'Protocolo registrado', () => setOpen(false));
      }}
    >
      <Field label="Protocolo da operadora" htmlFor={`${id}-p`} hint="Numérico, até 12 dígitos (padrão TISS; o recurso de glosa usa este número)." required>
        <Input id={`${id}-p`} name="protocol" inputMode="numeric" pattern="[0-9]{1,12}" maxLength={12} required />
      </Field>
      <Field label="Data do recebimento pela operadora" htmlFor={`${id}-d`} required>
        <Input id={`${id}-d`} name="receivedOn" type="date" defaultValue={today()} required />
      </Field>
      <Field label="Recibo emitido pela operadora" htmlFor={`${id}-f`} hint="PDF ou imagem do comprovante; o Qoro registra a impressão digital (SHA-256) dele." required>
        <Input id={`${id}-f`} name="receipt" type="file" accept="application/pdf,image/*" required />
      </Field>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Aguarde…' : 'Registrar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

type GuideOption = { id: string; number: string; pendingCents: number };

/**
 * Pagamento da operadora: valor, data e referência do demonstrativo. Sem alocação, o Qoro
 * rateia só se o valor for exatamente o saldo do lote; senão fica "não conciliado".
 */
export function PaymentForm({ insurerId, batchId, guides }: { insurerId: string; batchId: string; guides: GuideOption[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [ref, setRef] = useState('');
  const [perGuide, setPerGuide] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'batch' | 'guides'>('batch');
  const [key] = useState(() => uuidv4());
  const { pending, submit } = useSubmit();
  const allocated = Object.values(perGuide).reduce((s, v) => s + (toCents(v) || 0), 0);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Registrar pagamento
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        const allocations =
          mode === 'guides'
            ? guides.filter((g) => toCents(perGuide[g.id] ?? '') > 0).map((g) => ({ guideId: g.id, batchId, amountCents: toCents(perGuide[g.id]!) }))
            : undefined;
        const amountCents = mode === 'guides' ? allocated : toCents(amount);
        submit(
          () => recordPaymentAction({ insurerId, batchId, paidOn, amountCents, ...(ref.trim() ? { statementRef: ref.trim() } : {}), ...(allocations ? { allocations } : {}), idempotencyKey: key }),
          'Pagamento registrado',
          () => setOpen(false),
        );
      }}
    >
      <div className="flex gap-(--sp-3) text-(length:--fs-sm)">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'batch'} onChange={() => setMode('batch')} /> Valor do lote
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'guides'} onChange={() => setMode('guides')} /> Por guia
        </label>
      </div>
      {mode === 'batch' ? (
        <Field label="Valor pago (R$)" htmlFor={`${id}-a`} hint="Rateado só se for exatamente o saldo do lote; senão fica para conciliar." required>
          <Input id={`${id}-a`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
        </Field>
      ) : (
        <fieldset className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {guides.filter((g) => g.pendingCents > 0).map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-(length:--fs-sm)">
              <span className="w-28 tabular-nums">Guia {g.number}</span>
              <span className="w-32 text-fg-muted">saldo {brl(g.pendingCents)}</span>
              <Input
                aria-label={`Valor pago na guia ${g.number}`}
                inputMode="decimal"
                value={perGuide[g.id] ?? ''}
                onChange={(e) => setPerGuide((v) => ({ ...v, [g.id]: e.target.value }))}
                placeholder="0,00"
              />
            </label>
          ))}
          <span className="text-(length:--fs-sm) font-medium">Total: {brl(allocated)}</span>
        </fieldset>
      )}
      <Field label="Data do pagamento" htmlFor={`${id}-d`} required>
        <Input id={`${id}-d`} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </Field>
      <Field label="Referência do demonstrativo" htmlFor={`${id}-r`} hint="O mesmo demonstrativo não entra duas vezes.">
        <Input id={`${id}-r`} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} />
      </Field>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" disabled={pending || (mode === 'batch' ? !(toCents(amount) > 0) : allocated <= 0)}>
          {pending ? 'Aguarde…' : 'Registrar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Glosa informada pela operadora fora do demonstrativo eletrônico (registro manual). */
export function GlossForm({ batchId, guides }: { batchId: string; guides: GuideOption[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [guideId, setGuideId] = useState(guides[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  const [key] = useState(() => uuidv4());
  const { pending, submit } = useSubmit();
  if (guides.length === 0) return null;
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Registrar glosa
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        submit(() => recordGlossAction({ batchId, guideId, code: code.trim(), amountCents: toCents(amount), idempotencyKey: key }), 'Glosa registrada', () => setOpen(false));
      }}
    >
      <Field label="Guia" htmlFor={`${id}-g`} required>
        <Select id={`${id}-g`} value={guideId} onChange={(e) => setGuideId(e.target.value)}>
          {guides.map((g) => (
            <option key={g.id} value={g.id}>
              {g.number} (saldo {brl(g.pendingCents)})
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Código da glosa (tabela 38)" htmlFor={`${id}-c`} required>
        <Input id={`${id}-c`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={4} inputMode="numeric" />
      </Field>
      <Field label="Valor glosado (R$)" htmlFor={`${id}-v`} required>
        <Input id={`${id}-v`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" />
      </Field>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" disabled={pending || !/^\d{4}$/u.test(code.trim()) || !(toCents(amount) > 0)}>
          {pending ? 'Aguarde…' : 'Registrar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

/** Conciliação: alocar o dinheiro ainda não conciliado de um pagamento às guias. */
export function AllocateForm({ paymentId, unreconciledCents, guides }: { paymentId: string; unreconciledCents: number; guides: Array<GuideOption & { batchId: string }> }) {
  const [open, setOpen] = useState(false);
  const [perGuide, setPerGuide] = useState<Record<string, string>>({});
  const [key] = useState(() => uuidv4());
  const { pending, submit } = useSubmit();
  const allocated = Object.values(perGuide).reduce((s, v) => s + (toCents(v) || 0), 0);
  if (!open) {
    return (
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Alocar às guias
      </Button>
    );
  }
  return (
    <form
      className="flex w-full flex-col gap-(--sp-2) rounded-(--r-md) border border-border p-(--sp-3)"
      onSubmit={(e) => {
        e.preventDefault();
        const allocations = guides.filter((g) => toCents(perGuide[g.id] ?? '') > 0).map((g) => ({ guideId: g.id, batchId: g.batchId, amountCents: toCents(perGuide[g.id]!) }));
        submit(() => allocatePaymentAction({ paymentId, allocations, idempotencyKey: key }), 'Pagamento alocado', () => setOpen(false));
      }}
    >
      <fieldset className="flex max-h-64 flex-col gap-1 overflow-y-auto">
        {guides.map((g) => (
          <label key={g.id} className="flex items-center gap-2 text-(length:--fs-sm)">
            <span className="w-28 tabular-nums">Guia {g.number}</span>
            <span className="w-32 text-fg-muted">saldo {brl(g.pendingCents)}</span>
            <Input aria-label={`Alocar à guia ${g.number}`} inputMode="decimal" value={perGuide[g.id] ?? ''} onChange={(e) => setPerGuide((v) => ({ ...v, [g.id]: e.target.value }))} placeholder="0,00" />
          </label>
        ))}
      </fieldset>
      <span className="text-(length:--fs-sm)">
        Alocando {brl(allocated)} de {brl(unreconciledCents)} disponíveis
      </span>
      <div className="flex gap-(--sp-2)">
        <Button type="submit" size="sm" disabled={pending || allocated <= 0 || allocated > unreconciledCents}>
          {pending ? 'Aguarde…' : 'Alocar'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Voltar
        </Button>
      </div>
    </form>
  );
}

type ImportSummary = {
  kind: 'analysis' | 'payment';
  numeroDemonstrativo: string;
  batches: Array<{ number: string; glosses: number; payments: number }>;
  divergences: Array<{ code: string; message: string }>;
  alreadyImported: boolean;
};

/** Importar demonstrativo XML da operadora (análise de conta ou pagamento). */
export function StatementImportForm({
  insurers,
  action,
}: {
  insurers: Array<{ id: string; name: string }>;
  action: (form: FormData) => Promise<{ ok: true; data: ImportSummary } | { ok: false; error: string }>;
}) {
  const id = useId();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ImportSummary | null>(null);
  if (insurers.length === 0) return <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma operadora cadastrada.</p>;
  return (
    <div className="flex flex-col gap-(--sp-3)">
      <form
        className="grid gap-(--sp-2) md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await action(fd);
            if (!r.ok) {
              toast.error(r.error);
              return;
            }
            setResult(r.data);
            toast.success(r.data.alreadyImported ? 'Demonstrativo já importado: nada novo aplicado' : 'Demonstrativo importado');
            router.refresh();
          });
        }}
      >
        <Field label="Operadora" htmlFor={`${id}-i`} required>
          <Select id={`${id}-i`} name="insurerId" defaultValue={insurers[0]!.id}>
            {insurers.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Recebido em" htmlFor={`${id}-d`} required>
          <Input id={`${id}-d`} name="receivedOn" type="date" defaultValue={today()} required />
        </Field>
        <Field label="Arquivo XML (TISS 4.03.00)" htmlFor={`${id}-f`} required>
          <Input id={`${id}-f`} name="file" type="file" accept=".xml,application/xml,text/xml" required />
        </Field>
        <Button type="submit" disabled={pending}>
          {pending ? 'Conferindo…' : 'Importar'}
        </Button>
      </form>
      {result ? (
        <div className="rounded-(--r-md) border border-border p-(--sp-3) text-(length:--fs-sm)" role="status">
          <p className="font-medium">
            {result.kind === 'analysis' ? 'Análise de conta' : 'Pagamento'} {result.numeroDemonstrativo}
            {result.alreadyImported ? ' — já importado antes' : ''}
          </p>
          <ul className="mt-1">
            {result.batches.map((b) => (
              <li key={b.number}>
                Lote {b.number}: {b.glosses} glosa(s), {b.payments} pagamento(s)
              </li>
            ))}
          </ul>
          {result.divergences.length > 0 ? (
            <>
              <p className="mt-2 font-medium text-warning-700">Divergências (nada aplicado nesses pontos):</p>
              <ul className="list-disc pl-5">
                {result.divergences.map((d, i) => (
                  <li key={`${d.code}-${i}`}>{d.message}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
