'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState, useTransition } from 'react';

import { createPrescriptionTemplate } from '@/contexts/clinical/actions-templates';
import type { PrescriptionTemplateSummary } from '@/contexts/clinical';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { createPrescriptionForm, type FormState } from '../actions';

const INITIAL: FormState = { error: null };

interface Med {
  nome: string;
  dosagem?: string | undefined;
  posologia?: string | undefined;
  quantidade?: string | undefined;
  via?: string | undefined;
}

type Kind = 'simples' | 'controle_especial';
const KIND_LABEL: Record<Kind, string> = {
  simples: 'Receita simples',
  controle_especial: 'Controle especial',
};

export function PrescriptionForm({
  patientId,
  prontuarioId,
  templates = [],
}: {
  patientId: string;
  prontuarioId: string;
  templates?: PrescriptionTemplateSummary[];
}) {
  const [state, action, pending] = useActionState(createPrescriptionForm, INITIAL);
  const key = useMemo(() => crypto.randomUUID(), []);
  const [meds, setMeds] = useState<Med[]>([{ nome: '' }]);
  const [observacoes, setObservacoes] = useState('');
  const [kind, setKind] = useState<Kind>('simples');

  // Aplicar modelo (G5: confirma se o modelo muda o tipo da receita).
  const [pendingTemplate, setPendingTemplate] = useState<PrescriptionTemplateSummary | null>(null);
  // Salvar como modelo.
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveNome, setSaveNome] = useState('');
  const [saveCategoria, setSaveCategoria] = useState('');
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, startSave] = useTransition();

  const cleaned = meds
    .map((m) => ({
      nome: m.nome.trim(),
      dosagem: m.dosagem?.trim() || undefined,
      posologia: m.posologia?.trim() || undefined,
      quantidade: m.quantidade?.trim() || undefined,
      via: m.via?.trim() || undefined,
    }))
    .filter((m) => m.nome !== '');

  function update(i: number, patch: Partial<Med>) {
    setMeds((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function applyTemplate(t: PrescriptionTemplateSummary) {
    setMeds(t.medicamentos.length ? t.medicamentos.map((m) => ({ ...m })) : [{ nome: '' }]);
    setObservacoes(t.observacoes ?? '');
    setKind(t.kind);
    setPendingTemplate(null);
  }

  function onPickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.kind !== kind) setPendingTemplate(t); // precisa confirmar (G5)
    else applyTemplate(t);
  }

  function onSaveTemplate() {
    setSaveMsg(null);
    const nome = saveNome.trim();
    if (!nome) return setSaveMsg({ ok: false, text: 'Dê um nome ao modelo.' });
    if (cleaned.length === 0) return setSaveMsg({ ok: false, text: 'Adicione ao menos um medicamento.' });
    startSave(async () => {
      try {
        await createPrescriptionTemplate(
          {
            nome,
            categoria: saveCategoria.trim() || undefined,
            kind,
            medicamentos: cleaned,
            observacoes: observacoes.trim() || undefined,
          },
          crypto.randomUUID(),
        );
        setSaveMsg({ ok: true, text: `Modelo "${nome}" salvo.` });
        setSaveOpen(false);
        setSaveNome('');
        setSaveCategoria('');
      } catch (err) {
        setSaveMsg({ ok: false, text: err instanceof Error ? err.message : 'Erro ao salvar modelo.' });
      }
    });
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="patientId" value={patientId} />
      <input type="hidden" name="prontuarioId" value={prontuarioId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="medicamentos" value={JSON.stringify(cleaned)} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="observacoes" value={observacoes} />

      {/* Modelos de receita */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-subtle p-2">
        <Select
          aria-label="Aplicar modelo"
          value=""
          onChange={(e) => {
            onPickTemplate(e.target.value);
            e.currentTarget.value = '';
          }}
          disabled={templates.length === 0}
          className="max-w-56"
        >
          <option value="">
            {templates.length === 0 ? 'Nenhum modelo salvo' : 'Aplicar modelo…'}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
              {t.categoria ? ` · ${t.categoria}` : ''} ({KIND_LABEL[t.kind]})
            </option>
          ))}
        </Select>
        <button
          type="button"
          onClick={() => setSaveOpen((v) => !v)}
          className="text-sm font-medium text-primary-600 underline"
        >
          Salvar como modelo
        </button>
        <Link href="/modelos-receita" className="text-sm text-fg-muted underline">
          Gerenciar modelos
        </Link>
      </div>

      {pendingTemplate ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          O modelo <b>{pendingTemplate.nome}</b> é <b>{KIND_LABEL[pendingTemplate.kind]}</b> e vai
          mudar o tipo da receita (atual: {KIND_LABEL[kind]}). Altera: ✓ medicamentos ✓ observações
          ⚠ tipo.
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={() => applyTemplate(pendingTemplate)}>
              Aplicar mesmo assim
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPendingTemplate(null)}
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {saveOpen ? (
        <div className="flex flex-col gap-2 rounded border border-border p-2">
          <Input
            value={saveNome}
            onChange={(e) => setSaveNome(e.target.value)}
            placeholder="Nome do modelo (ex.: Sertralina início)"
            maxLength={120}
          />
          <Input
            value={saveCategoria}
            onChange={(e) => setSaveCategoria(e.target.value)}
            placeholder="Categoria (opcional, ex.: Psiquiatria)"
            maxLength={60}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" loading={saving} onClick={onSaveTemplate}>
              Salvar modelo
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
      {saveMsg ? (
        <p className={`text-sm ${saveMsg.ok ? 'text-success-600' : 'text-danger-600'}`}>
          {saveMsg.text}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-fg-muted">Tipo de receita</span>
        <div className="inline-flex w-fit overflow-hidden rounded-md border border-border">
          <button
            type="button"
            onClick={() => setKind('simples')}
            aria-pressed={kind === 'simples'}
            className={`px-3 py-1.5 text-sm ${
              kind === 'simples' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg'
            }`}
          >
            Receita simples
          </button>
          <button
            type="button"
            onClick={() => setKind('controle_especial')}
            aria-pressed={kind === 'controle_especial'}
            className={`px-3 py-1.5 text-sm ${
              kind === 'controle_especial' ? 'bg-primary-600 text-white' : 'bg-transparent text-fg'
            }`}
          >
            Controle especial
          </button>
        </div>
      </div>

      {kind === 'controle_especial' ? (
        <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Para benzodiazepínicos e estimulantes (tarja preta) use seu talão oficial. Este
          receituário cobre o controle especial branco de 2 vias (antibióticos, tramadol, codeína e
          a maioria dos psiquiátricos C1). Válido somente com assinatura e carimbo físicos.
        </p>
      ) : null}

      {meds.map((m, i) => (
        <div key={i} className="grid grid-cols-2 gap-2 border-b border-border pb-3">
          <Input
            value={m.nome}
            onChange={(e) => update(i, { nome: e.target.value })}
            placeholder="Medicamento *"
          />
          <Input
            value={m.dosagem ?? ''}
            onChange={(e) => update(i, { dosagem: e.target.value })}
            placeholder="Dosagem (ex.: 500mg)"
          />
          <Input
            value={m.posologia ?? ''}
            onChange={(e) => update(i, { posologia: e.target.value })}
            placeholder="Posologia (ex.: 1 cp 8/8h por 7 dias)"
            className="col-span-2"
          />
          <Input
            value={m.via ?? ''}
            onChange={(e) => update(i, { via: e.target.value })}
            placeholder="Via (ex.: oral)"
          />
          <Input
            value={m.quantidade ?? ''}
            onChange={(e) => update(i, { quantidade: e.target.value })}
            placeholder="Quantidade"
          />
          {meds.length > 1 ? (
            <button
              type="button"
              onClick={() => setMeds((ms) => ms.filter((_, idx) => idx !== i))}
              className="col-span-2 text-left text-xs text-danger-600 underline"
            >
              remover
            </button>
          ) : null}
        </div>
      ))}

      <button
        type="button"
        onClick={() => setMeds((ms) => [...ms, { nome: '' }])}
        className="self-start text-sm font-medium text-primary-600 underline"
      >
        + medicamento
      </button>

      <Textarea
        placeholder="Observações (opcional)"
        rows={2}
        value={observacoes}
        onChange={(e) => setObservacoes(e.target.value)}
      />

      <Button type="submit" className="self-start" loading={pending} disabled={cleaned.length === 0}>
        Emitir prescrição (PDF)
      </Button>
      {state.error ? <p className="text-sm text-danger-600">{state.error}</p> : null}
    </form>
  );
}
