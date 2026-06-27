'use client';

import { ChevronDown, FileText, Pill, Plus, Trash2, type LucideIcon } from 'lucide-react';
import { useState, useTransition } from 'react';

import type { CreateMedicalDocumentInput, MedicalDocumentType } from '@/contexts/clinical/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/ui/cn';

import { emitDocument, emitPrescription, signConsulta } from './actions';

/** Cartão de ferramenta colapsável (cabeçalho com ícone + chevron que gira). */
function ToolCard({
  icon: Icon,
  title,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
      >
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-fg-muted" />
          {title}
        </span>
        <ChevronDown
          className={cn('size-4 text-fg-subtle transition-transform', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <div className="flex flex-col gap-3 border-t border-border p-4">{children}</div>
      ) : null}
    </div>
  );
}

// --- assinatura inline -----------------------------------------------------

export function SignPanel({
  prontuarioId,
  onSigned,
}: {
  prontuarioId: string;
  onSigned: () => void;
}) {
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
      if (res.ok) onSigned();
      else setError(res.message);
    });
  };

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-sm font-semibold">Assinar prontuário</p>
      <p className="mb-3 text-xs text-fg-muted">
        Após assinar, o prontuário fica imutável (somente leitura).
      </p>
      {error ? (
        <Alert variant="danger" className="mb-3">
          {error}
        </Alert>
      ) : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={needsReturn}
          onChange={(e) => setNeedsReturn(e.target.checked)}
          className="size-4"
        />
        Precisa retornar
      </label>
      {needsReturn ? (
        <Field label="Retornar em (dias)" className="mt-2 max-w-40">
          <Input
            type="number"
            min={1}
            max={3650}
            value={returnDays}
            onChange={(e) => setReturnDays(e.target.value)}
          />
        </Field>
      ) : null}
      <Button className="mt-3" variant="success" loading={pending} onClick={submit}>
        Assinar consulta
      </Button>
    </div>
  );
}

// --- prescrição inline -----------------------------------------------------

type MedRow = { nome: string; dosagem: string; posologia: string };
const emptyMed = (): MedRow => ({ nome: '', dosagem: '', posologia: '' });

export function PrescriptionPanel({
  patientId,
  prontuarioId,
}: {
  patientId: string;
  prontuarioId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [meds, setMeds] = useState<MedRow[]>([emptyMed()]);
  const [observacoes, setObservacoes] = useState('');
  const [kind, setKind] = useState<'simples' | 'controle_especial'>('simples');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const setMed = (i: number, patch: Partial<MedRow>) =>
    setMeds((m) => m.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const submit = () => {
    setError(null);
    const medicamentos = meds
      .filter((m) => m.nome.trim())
      .map((m) => ({
        nome: m.nome.trim(),
        ...(m.dosagem.trim() ? { dosagem: m.dosagem.trim() } : {}),
        ...(m.posologia.trim() ? { posologia: m.posologia.trim() } : {}),
      }));
    if (medicamentos.length === 0) {
      setError('Adicione ao menos um medicamento.');
      return;
    }
    start(async () => {
      const res = await emitPrescription(
        {
          patientId,
          prontuarioId,
          kind,
          medicamentos,
          ...(observacoes.trim() ? { observacoes: observacoes.trim() } : {}),
        },
        crypto.randomUUID(),
      );
      if (res.ok) {
        window.open(`/prescricoes/${res.data.id}/pdf`, '_blank', 'noopener');
        setMeds([emptyMed()]);
        setObservacoes('');
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <ToolCard icon={Pill} title="Emitir prescrição" open={open} onToggle={() => setOpen((v) => !v)}>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <Field label="Tipo de receita">
        <div className="inline-flex w-fit overflow-hidden rounded-md border border-border">
          <button
            type="button"
            onClick={() => setKind('simples')}
            aria-pressed={kind === 'simples'}
            className={cn(
              'px-3 py-1.5 text-sm',
              kind === 'simples' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg',
            )}
          >
            Receita simples
          </button>
          <button
            type="button"
            onClick={() => setKind('controle_especial')}
            aria-pressed={kind === 'controle_especial'}
            className={cn(
              'px-3 py-1.5 text-sm',
              kind === 'controle_especial' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg',
            )}
          >
            Controle especial
          </button>
        </div>
      </Field>
      {kind === 'controle_especial' ? (
        <Alert variant="warning">
          Para benzodiazepínicos e estimulantes (tarja preta) use seu talão oficial. Este
          receituário cobre o controle especial branco de 2 vias (antibióticos, tramadol, codeína e
          a maioria dos psiquiátricos C1). Válido somente com assinatura e carimbo físicos.
        </Alert>
      ) : null}

      {meds.map((m, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <Field label={i === 0 ? 'Medicamento' : undefined} className="min-w-40 flex-1">
            <Input
              value={m.nome}
              onChange={(e) => setMed(i, { nome: e.target.value })}
              placeholder="Ex.: Amoxicilina 500mg"
            />
          </Field>
          <Field label={i === 0 ? 'Dosagem' : undefined} className="w-28">
            <Input
              value={m.dosagem}
              onChange={(e) => setMed(i, { dosagem: e.target.value })}
              placeholder="1 cp"
            />
          </Field>
          <Field label={i === 0 ? 'Posologia' : undefined} className="min-w-40 flex-1">
            <Input
              value={m.posologia}
              onChange={(e) => setMed(i, { posologia: e.target.value })}
              placeholder="8/8h por 7 dias"
            />
          </Field>
          {meds.length > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Remover"
              onClick={() => setMeds((arr) => arr.filter((_, idx) => idx !== i))}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      ))}
      <div>
        <Button size="sm" variant="secondary" onClick={() => setMeds((m) => [...m, emptyMed()])}>
          <Plus /> Adicionar medicamento
        </Button>
      </div>
      <Field label="Observações (opcional)">
        <Textarea rows={2} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </Field>
      <div>
        <Button loading={pending} onClick={submit}>
          Emitir prescrição (PDF)
        </Button>
      </div>
    </ToolCard>
  );
}

// --- documento médico inline -----------------------------------------------

const DOC_LABEL: Record<MedicalDocumentType, string> = {
  atestado: 'Atestado',
  exame: 'Solicitação de exame',
  declaracao: 'Declaração',
  encaminhamento: 'Encaminhamento',
};

export function DocumentPanel({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MedicalDocumentType>('atestado');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const f = (k: string) => fields[k] ?? '';
  const set = (k: string, v: string) => setFields((s) => ({ ...s, [k]: v }));

  function build(): CreateMedicalDocumentInput | null {
    switch (type) {
      case 'atestado': {
        if (!f('descricao').trim()) return null;
        return {
          patientId,
          type: 'atestado',
          content: {
            descricao: f('descricao').trim(),
            ...(f('cid').trim() ? { cid: f('cid').trim() } : {}),
            ...(f('dias').trim() ? { dias: Number(f('dias')) } : {}),
          },
        };
      }
      case 'exame': {
        const exames = f('exames')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (exames.length === 0) return null;
        return {
          patientId,
          type: 'exame',
          content: {
            exames,
            ...(f('indicacao').trim() ? { indicacaoClinica: f('indicacao').trim() } : {}),
          },
        };
      }
      case 'declaracao': {
        if (!f('texto').trim()) return null;
        return {
          patientId,
          type: 'declaracao',
          content: {
            texto: f('texto').trim(),
            ...(f('periodo').trim() ? { periodo: f('periodo').trim() } : {}),
          },
        };
      }
      case 'encaminhamento': {
        if (!f('especialidade').trim() || !f('motivo').trim()) return null;
        return {
          patientId,
          type: 'encaminhamento',
          content: { especialidade: f('especialidade').trim(), motivo: f('motivo').trim() },
        };
      }
    }
  }

  const submit = () => {
    setError(null);
    const input = build();
    if (!input) {
      setError('Preencha os campos obrigatórios do documento.');
      return;
    }
    start(async () => {
      const res = await emitDocument(input, crypto.randomUUID());
      if (res.ok) {
        window.open(`/documentos/${res.data.id}/pdf`, '_blank', 'noopener');
        setFields({});
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <ToolCard
      icon={FileText}
      title="Emitir documento"
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {error ? <Alert variant="danger">{error}</Alert> : null}
      <Field label="Tipo">
        <Select value={type} onChange={(e) => setType(e.target.value as MedicalDocumentType)}>
          {(Object.keys(DOC_LABEL) as MedicalDocumentType[]).map((t) => (
            <option key={t} value={t}>
              {DOC_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>

      {type === 'atestado' ? (
        <>
          <Field label="Descrição">
            <Textarea
              rows={2}
              value={f('descricao')}
              onChange={(e) => set('descricao', e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Field label="Dias de afastamento" className="w-40">
              <Input
                type="number"
                min={0}
                value={f('dias')}
                onChange={(e) => set('dias', e.target.value)}
              />
            </Field>
            <Field label="CID (opcional)" className="w-40">
              <Input value={f('cid')} onChange={(e) => set('cid', e.target.value)} />
            </Field>
          </div>
        </>
      ) : null}

      {type === 'exame' ? (
        <>
          <Field label="Exames (um por linha)">
            <Textarea
              rows={3}
              value={f('exames')}
              onChange={(e) => set('exames', e.target.value)}
            />
          </Field>
          <Field label="Indicação clínica (opcional)">
            <Textarea
              rows={2}
              value={f('indicacao')}
              onChange={(e) => set('indicacao', e.target.value)}
            />
          </Field>
        </>
      ) : null}

      {type === 'declaracao' ? (
        <>
          <Field label="Texto">
            <Textarea rows={3} value={f('texto')} onChange={(e) => set('texto', e.target.value)} />
          </Field>
          <Field label="Período (opcional)">
            <Input value={f('periodo')} onChange={(e) => set('periodo', e.target.value)} />
          </Field>
        </>
      ) : null}

      {type === 'encaminhamento' ? (
        <>
          <Field label="Especialidade">
            <Input
              value={f('especialidade')}
              onChange={(e) => set('especialidade', e.target.value)}
            />
          </Field>
          <Field label="Motivo">
            <Textarea
              rows={2}
              value={f('motivo')}
              onChange={(e) => set('motivo', e.target.value)}
            />
          </Field>
        </>
      ) : null}

      <div>
        <Button loading={pending} onClick={submit}>
          Emitir documento (PDF)
        </Button>
      </div>
    </ToolCard>
  );
}
