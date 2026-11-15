'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  deletePrescriptionTemplate,
  updatePrescriptionTemplate,
} from '@/contexts/clinical/actions-templates';
import {
  createTemplateWithTrialLimit,
  duplicateTemplateWithTrialLimit,
} from '../_actions/create-limited';
import { unwrapAction } from '@/contexts/scheduling/action-result';
import type { PrescriptionTemplateSummary } from '@/contexts/clinical';
import { Button } from '@/components/ui/button';
import { DestructiveAction } from '@/components/ui/destructive-action';
import { toast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { uuidv4 } from '@/lib/ui/uuid';

type Kind = 'simples' | 'controle_especial';
const KIND_LABEL: Record<Kind, string> = {
  simples: 'Receita simples',
  controle_especial: 'Controle especial',
};

interface Med {
  nome: string;
  dosagem?: string | undefined;
  posologia?: string | undefined;
  quantidade?: string | undefined;
  via?: string | undefined;
}

type Editing = { id: string | null } | null;

export function TemplatesManager({ initial }: { initial: PrescriptionTemplateSummary[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [kind, setKind] = useState<Kind>('simples');
  const [meds, setMeds] = useState<Med[]>([{ nome: '' }]);
  const [observacoes, setObservacoes] = useState('');
  const [busy, start] = useTransition();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return initial;
    return initial.filter(
      (t) =>
        t.nome.toLowerCase().includes(term) || (t.categoria ?? '').toLowerCase().includes(term),
    );
  }, [initial, search]);

  const cleaned = meds
    .map((m) => ({
      nome: m.nome.trim(),
      dosagem: m.dosagem?.trim() || undefined,
      posologia: m.posologia?.trim() || undefined,
      quantidade: m.quantidade?.trim() || undefined,
      via: m.via?.trim() || undefined,
    }))
    .filter((m) => m.nome !== '');

  function startNew() {
    setEditing({ id: null });
    setNome('');
    setCategoria('');
    setKind('simples');
    setMeds([{ nome: '' }]);
    setObservacoes('');
  }

  function startEdit(t: PrescriptionTemplateSummary) {
    setEditing({ id: t.id });
    setNome(t.nome);
    setCategoria(t.categoria ?? '');
    setKind(t.kind);
    setMeds(t.medicamentos.length ? t.medicamentos.map((m) => ({ ...m })) : [{ nome: '' }]);
    setObservacoes(t.observacoes ?? '');
  }

  function updateMed(i: number, patch: Partial<Med>) {
    setMeds((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function save() {
    if (!nome.trim()) return toast.error('Dê um nome ao modelo.');
    if (cleaned.length === 0) return toast.error('Adicione ao menos um medicamento.');
    const input = {
      nome: nome.trim(),
      categoria: categoria.trim() || undefined,
      kind,
      medicamentos: cleaned,
      observacoes: observacoes.trim() || undefined,
    };
    start(async () => {
      try {
        if (editing?.id) await updatePrescriptionTemplate(editing.id, input, uuidv4());
        else await unwrapAction(createTemplateWithTrialLimit(input, uuidv4()));
        setEditing(null);
        toast.success('Modelo salvo.');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao salvar.');
      }
    });
  }

  function duplicate(t: PrescriptionTemplateSummary) {
    start(async () => {
      try {
        await unwrapAction(duplicateTemplateWithTrialLimit(t.id, uuidv4()));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao duplicar.');
      }
    });
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar modelo de receita"
          placeholder="Buscar por nome ou categoria"
          className="max-w-xs"
        />
        <Button type="button" size="sm" onClick={startNew}>
          Novo modelo
        </Button>
      </div>

      {editing ? (
        <div className="cardblock wrap-pad flex flex-col gap-3">
          <h4 className="text-sm font-semibold">{editing.id ? 'Editar modelo' : 'Novo modelo'}</h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Nome *"
              maxLength={120}
            />
            <Input
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Categoria (opcional)"
              maxLength={60}
            />
          </div>

          <div className="inline-flex w-fit overflow-hidden rounded-md border border-border">
            {(['simples', 'controle_especial'] as Kind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className={`px-3 py-1.5 text-sm ${
                  kind === k ? 'bg-primary-600 text-white' : 'bg-transparent text-fg'
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>

          {meds.map((m, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 border-b border-border pb-2">
              <Input
                value={m.nome}
                onChange={(e) => updateMed(i, { nome: e.target.value })}
                placeholder="Medicamento *"
              />
              <Input
                value={m.dosagem ?? ''}
                onChange={(e) => updateMed(i, { dosagem: e.target.value })}
                placeholder="Dosagem"
              />
              <Input
                value={m.posologia ?? ''}
                onChange={(e) => updateMed(i, { posologia: e.target.value })}
                placeholder="Posologia"
                className="col-span-2"
              />
              <Input
                value={m.via ?? ''}
                onChange={(e) => updateMed(i, { via: e.target.value })}
                placeholder="Via"
              />
              <Input
                value={m.quantidade ?? ''}
                onChange={(e) => updateMed(i, { quantidade: e.target.value })}
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
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="Observações (opcional)"
            rows={2}
          />

          <div className="flex gap-2">
            <Button type="button" size="sm" loading={busy} onClick={save}>
              Salvar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-sm text-fg-muted">Nenhum modelo. Clique em “Novo modelo” para criar.</p>
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {filtered.map((t) => (
              <div key={t.id} className="listrow" data-testid="prescription-template-row">
                <div className="lr-main">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.nome}</span>
                    {t.categoria ? (
                      <span className="text-xs text-fg-subtle">{t.categoria}</span>
                    ) : null}
                    <span className="text-xs text-fg-muted">
                      {KIND_LABEL[t.kind]} · {t.medicamentos.length} medicamento(s)
                    </span>
                  </div>
                </div>
                <div className="lr-end flex gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(t)}>
                    Editar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => duplicate(t)}
                    disabled={busy}
                  >
                    Duplicar
                  </Button>
                  <DestructiveAction
                    trigger={
                      <Button type="button" size="sm" variant="ghost" disabled={busy}>
                        Excluir
                      </Button>
                    }
                    title={`Excluir “${t.nome}”`}
                    description="O modelo deixa de estar disponível para novas prescrições. Documentos já emitidos não são alterados."
                    confirmLabel="Excluir modelo"
                    cancelLabel="Manter modelo"
                    disabled={busy}
                    action={async () => {
                      await deletePrescriptionTemplate(t.id, uuidv4());
                      router.refresh();
                    }}
                    onError={(error) =>
                      toast.error(error instanceof Error ? error.message : 'Erro ao excluir.')
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
