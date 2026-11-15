'use client';

import { Plus, Trash2 } from 'lucide-react';
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
import { Card } from '@/components/ui/card';
import { DestructiveAction } from '@/components/ui/destructive-action';
import { Field } from '@/components/ui/field';
import { toast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
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

type ErrosModelo = { nome?: string; medicamento?: string };

const KIND_OPTIONS = (['simples', 'controle_especial'] as Kind[]).map((value) => ({
  value,
  label: KIND_LABEL[value],
}));

export function TemplatesManager({ initial }: { initial: PrescriptionTemplateSummary[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [nome, setNome] = useState('');
  const [categoria, setCategoria] = useState('');
  const [kind, setKind] = useState<Kind>('simples');
  const [meds, setMeds] = useState<Med[]>([{ nome: '' }]);
  const [observacoes, setObservacoes] = useState('');
  // UX-019 — erro no campo (padrão do UX-005), não só no toast que some.
  const [erros, setErros] = useState<ErrosModelo>({});
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
    setErros({});
    setNome('');
    setCategoria('');
    setKind('simples');
    setMeds([{ nome: '' }]);
    setObservacoes('');
  }

  function startEdit(t: PrescriptionTemplateSummary) {
    setEditing({ id: t.id });
    setErros({});
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
    const novos: ErrosModelo = {};
    if (!nome.trim()) novos.nome = 'Dê um nome ao modelo.';
    if (cleaned.length === 0) novos.medicamento = 'Adicione ao menos um medicamento.';
    if (novos.nome || novos.medicamento) {
      setErros(novos);
      const alvo = novos.nome ? 'tpl-nome' : 'tpl-med-0-nome';
      requestAnimationFrame(() => document.getElementById(alvo)?.focus());
      return;
    }
    setErros({});
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

  function limparErro(campo: keyof ErrosModelo) {
    setErros((atual) => {
      if (!atual[campo]) return atual;
      const { [campo]: _removido, ...resto } = atual;
      return resto;
    });
  }

  const vazioPorBusca = initial.length > 0 && filtered.length === 0;

  // UX-019 — fora da migração do v5: classes do DS antigo (`stack`, `cardblock`,
  // `listrow`), largura em `style` e campos com o placeholder como único rótulo
  // (o rótulo sumia ao digitar). Agora: `Field` com rótulo persistente em cada
  // campo, o mesmo desenho da receita do Consultório e só tokens do DS.
  return (
    <div className="flex max-w-190 flex-col gap-(--sp-4)">
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
        <Card className="flex flex-col gap-(--sp-4) p-(--card-pad)">
          <h2 className="text-(length:--fs-h4) font-semibold">
            {editing.id ? 'Editar modelo' : 'Novo modelo'}
          </h2>
          <div className="grid gap-(--sp-3) sm:grid-cols-2">
            <Field label="Nome do modelo" htmlFor="tpl-nome" error={erros.nome} required>
              <Input
                id="tpl-nome"
                value={nome}
                invalid={Boolean(erros.nome)}
                onChange={(e) => {
                  setNome(e.target.value);
                  if (e.target.value.trim()) limparErro('nome');
                }}
                placeholder="Ex.: Amigdalite adulto"
                maxLength={120}
              />
            </Field>
            <Field label="Categoria (opcional)" htmlFor="tpl-categoria">
              <Input
                id="tpl-categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Ex.: Antibióticos"
                maxLength={60}
              />
            </Field>
          </div>

          <Field label="Tipo de receita" group>
            <Segmented
              aria-label="Tipo de receita"
              options={KIND_OPTIONS}
              value={kind}
              onValueChange={setKind}
            />
          </Field>

          <Field label="Medicamentos" group error={erros.medicamento}>
            <div className="flex flex-col gap-(--sp-3)">
              {meds.map((m, i) => (
                <div
                  key={i}
                  className="grid grid-cols-2 gap-2 border-b border-border pb-(--sp-3) last:border-b-0 last:pb-0"
                >
                  <Field
                    label={`Medicamento ${i + 1}`}
                    htmlFor={`tpl-med-${i}-nome`}
                    required
                    className="col-span-2 sm:col-span-1"
                  >
                    <Input
                      id={`tpl-med-${i}-nome`}
                      value={m.nome}
                      invalid={i === 0 && Boolean(erros.medicamento)}
                      onChange={(e) => {
                        updateMed(i, { nome: e.target.value });
                        if (e.target.value.trim()) limparErro('medicamento');
                      }}
                      placeholder="Ex.: Amoxicilina 500mg"
                    />
                  </Field>
                  <Field
                    label="Dosagem"
                    htmlFor={`tpl-med-${i}-dosagem`}
                    className="col-span-2 sm:col-span-1"
                  >
                    <Input
                      id={`tpl-med-${i}-dosagem`}
                      aria-label={`Dosagem ${i + 1}`}
                      value={m.dosagem ?? ''}
                      onChange={(e) => updateMed(i, { dosagem: e.target.value })}
                      placeholder="1 cp"
                    />
                  </Field>
                  <Field
                    label="Posologia"
                    htmlFor={`tpl-med-${i}-posologia`}
                    className="col-span-2"
                  >
                    <Input
                      id={`tpl-med-${i}-posologia`}
                      aria-label={`Posologia ${i + 1}`}
                      value={m.posologia ?? ''}
                      onChange={(e) => updateMed(i, { posologia: e.target.value })}
                      placeholder="8/8h por 7 dias"
                    />
                  </Field>
                  <Field label="Via" htmlFor={`tpl-med-${i}-via`}>
                    <Input
                      id={`tpl-med-${i}-via`}
                      aria-label={`Via ${i + 1}`}
                      value={m.via ?? ''}
                      onChange={(e) => updateMed(i, { via: e.target.value })}
                      placeholder="oral"
                    />
                  </Field>
                  <Field label="Quantidade" htmlFor={`tpl-med-${i}-quantidade`}>
                    <Input
                      id={`tpl-med-${i}-quantidade`}
                      aria-label={`Quantidade ${i + 1}`}
                      value={m.quantidade ?? ''}
                      onChange={(e) => updateMed(i, { quantidade: e.target.value })}
                      placeholder="30"
                    />
                  </Field>
                  {meds.length > 1 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="col-span-2 justify-self-start text-danger-700"
                      onClick={() => setMeds((ms) => ms.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      Remover medicamento {i + 1}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Field>
          <div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setMeds((ms) => [...ms, { nome: '' }])}
            >
              <Plus aria-hidden="true" className="size-3.5" />
              Adicionar medicamento
            </Button>
          </div>

          <Field label="Observações (opcional)" htmlFor="tpl-observacoes">
            <Textarea
              id="tpl-observacoes"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              rows={2}
            />
          </Field>

          <div className="flex gap-2">
            <Button type="button" size="sm" loading={busy} onClick={save}>
              Salvar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-(length:--fs-sm) text-fg-muted">
          {vazioPorBusca
            ? 'Nenhum modelo encontrado para essa busca.'
            : 'Nenhum modelo ainda. Use “Novo modelo” para criar o primeiro.'}
        </p>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-border">
            {filtered.map((t) => (
              <li
                key={t.id}
                data-testid="prescription-template-row"
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-(--card-pad) py-(--sp-3)"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium">{t.nome}</span>
                    {t.categoria ? (
                      <span className="text-(length:--fs-xs) text-fg-subtle">{t.categoria}</span>
                    ) : null}
                  </div>
                  <p className="text-(length:--fs-xs) text-fg-muted">
                    {KIND_LABEL[t.kind]} · {t.medicamentos.length}{' '}
                    {t.medicamentos.length === 1 ? 'medicamento' : 'medicamentos'}
                  </p>
                </div>
                {/* O nome do modelo entra no nome acessível: numa lista, três
                    botões "Editar" iguais não dizem de qual linha são. O texto
                    visível abre o nome (WCAG 2.5.3); `aria-label` e não um
                    `span` oculto, que vira bloco e põe espaço antes dos dois-pontos. */}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar: ${t.nome}`}
                    onClick={() => startEdit(t)}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Duplicar: ${t.nome}`}
                    onClick={() => duplicate(t)}
                    disabled={busy}
                  >
                    Duplicar
                  </Button>
                  <DestructiveAction
                    trigger={
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Excluir: ${t.nome}`}
                        disabled={busy}
                      >
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
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
