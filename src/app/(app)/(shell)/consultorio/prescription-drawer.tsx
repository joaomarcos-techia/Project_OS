'use client';

import { Pill, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';

import { listMyPrescriptionTemplates } from '@/contexts/clinical/actions-templates';
import { createTemplateWithTrialLimit } from '../_actions/create-limited';
import { unwrapAction } from '@/contexts/scheduling/action-result';
import type { PrescriptionTemplateSummary } from '@/contexts/clinical';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

import { emitPrescription } from './actions';
import { uuidv4 } from '@/lib/ui/uuid';

type MedRow = { nome: string; dosagem: string; posologia: string; quantidade: string; via: string };
const emptyMed = (): MedRow => ({ nome: '', dosagem: '', posologia: '', quantidade: '', via: '' });

type Kind = 'simples' | 'controle_especial';
const KIND_LABEL: Record<Kind, string> = {
  simples: 'Receita simples',
  controle_especial: 'Controle especial',
};

/** Emissão de prescrição em Drawer (escada de navegação — nunca rota nova). */
export function PrescriptionDrawer({
  patientId,
  prontuarioId,
  defaultOpen = false,
}: {
  patientId: string;
  prontuarioId: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [meds, setMeds] = useState<MedRow[]>([emptyMed()]);
  const [observacoes, setObservacoes] = useState('');
  const [kind, setKind] = useState<Kind>('simples');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Modelos do médico logado — carregados quando o drawer abre (read action).
  const [templates, setTemplates] = useState<PrescriptionTemplateSummary[]>([]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    listMyPrescriptionTemplates()
      .then((t) => {
        if (alive) setTemplates(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  // Modelos: aplicar (G5 confirma troca de tipo) + salvar.
  const [pendingTemplate, setPendingTemplate] = useState<PrescriptionTemplateSummary | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveNome, setSaveNome] = useState('');
  const [saveCategoria, setSaveCategoria] = useState('');
  const [savingTpl, startTpl] = useTransition();

  const setMed = (i: number, patch: Partial<MedRow>) =>
    setMeds((m) => m.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  function applyTemplate(t: PrescriptionTemplateSummary) {
    setMeds(
      t.medicamentos.length
        ? t.medicamentos.map((m) => ({
            nome: m.nome ?? '',
            dosagem: m.dosagem ?? '',
            posologia: m.posologia ?? '',
            quantidade: m.quantidade ?? '',
            via: m.via ?? '',
          }))
        : [emptyMed()],
    );
    setObservacoes(t.observacoes ?? '');
    setKind(t.kind);
    setPendingTemplate(null);
  }

  function onPickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.kind !== kind) setPendingTemplate(t);
    else applyTemplate(t);
  }

  const cleaned = () =>
    meds
      .filter((m) => m.nome.trim())
      .map((m) => ({
        nome: m.nome.trim(),
        ...(m.dosagem.trim() ? { dosagem: m.dosagem.trim() } : {}),
        ...(m.posologia.trim() ? { posologia: m.posologia.trim() } : {}),
        ...(m.quantidade.trim() ? { quantidade: m.quantidade.trim() } : {}),
        ...(m.via.trim() ? { via: m.via.trim() } : {}),
      }));

  function onSaveTemplate() {
    const nome = saveNome.trim();
    if (!nome) {
      toast.error('Dê um nome ao modelo.');
      return;
    }
    const medicamentos = cleaned();
    if (medicamentos.length === 0) {
      toast.error('Adicione ao menos um medicamento.');
      return;
    }
    startTpl(async () => {
      try {
        await unwrapAction(
          createTemplateWithTrialLimit(
            {
              nome,
              categoria: saveCategoria.trim() || undefined,
              kind,
              medicamentos,
              observacoes: observacoes.trim() || undefined,
            },
            uuidv4(),
          ),
        );
        toast.success(`Modelo "${nome}" salvo.`);
        setSaveOpen(false);
        setSaveNome('');
        setSaveCategoria('');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao salvar modelo.');
      }
    });
  }

  const submit = () => {
    setError(null);
    const medicamentos = cleaned();
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
        uuidv4(),
      );
      if (res.ok) {
        toast.success('Prescrição emitida', 'O PDF abriu em outra aba.');
        window.open(`/prescricoes/${res.data.id}/pdf`, '_blank', 'noopener');
        setMeds([emptyMed()]);
        setObservacoes('');
        setOpen(false);
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="secondary" size="sm">
          <Pill className="size-3.5" />
          Prescrição
        </Button>
      </DrawerTrigger>
      <DrawerContent size="lg">
        <DrawerHeader>
          <DrawerTitle>Emitir prescrição</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-4">
          {error ? <Alert variant="danger">{error}</Alert> : null}

          <div className="flex flex-wrap items-center gap-2">
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
            <Button variant="ghost" size="sm" onClick={() => setSaveOpen((v) => !v)}>
              Salvar como modelo
            </Button>
            <Link href="/modelos-receita" className="text-(length:--fs-sm) text-fg-muted underline">
              Gerenciar
            </Link>
          </div>

          {pendingTemplate ? (
            <Alert variant="warning">
              O modelo <b>{pendingTemplate.nome}</b> é <b>{KIND_LABEL[pendingTemplate.kind]}</b> e
              vai mudar o tipo da receita (atual: {KIND_LABEL[kind]}).
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => applyTemplate(pendingTemplate)}>
                  Aplicar mesmo assim
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPendingTemplate(null)}>
                  Cancelar
                </Button>
              </div>
            </Alert>
          ) : null}

          {saveOpen ? (
            <div className="flex flex-col gap-2 rounded-(--r-md) border border-border p-3">
              <Input
                value={saveNome}
                onChange={(e) => setSaveNome(e.target.value)}
                placeholder="Nome do modelo"
                maxLength={120}
              />
              <Input
                value={saveCategoria}
                onChange={(e) => setSaveCategoria(e.target.value)}
                placeholder="Categoria (opcional)"
                maxLength={60}
              />
              <div className="flex gap-2">
                <Button size="sm" loading={savingTpl} onClick={onSaveTemplate}>
                  Salvar modelo
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSaveOpen(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : null}

          <Field label="Tipo de receita" group>
            <Segmented
              aria-label="Tipo de receita"
              options={[
                { value: 'simples', label: 'Receita simples' },
                { value: 'controle_especial', label: 'Controle especial' },
              ]}
              value={kind}
              onValueChange={setKind}
            />
          </Field>
          {kind === 'controle_especial' ? (
            <Alert variant="warning">
              Para benzodiazepínicos e estimulantes (tarja preta) use seu talão oficial. Este
              receituário cobre o controle especial branco de 2 vias (antibióticos, tramadol,
              codeína e a maioria dos psiquiátricos C1). Válido somente com assinatura e carimbo
              físicos.
            </Alert>
          ) : null}

          {meds.map((m, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2">
              <Field
                label={i === 0 ? 'Medicamento' : undefined}
                htmlFor={`prescription-medication-${i}`}
                className="min-w-40 flex-1"
              >
                <Input
                  id={`prescription-medication-${i}`}
                  aria-label={`Medicamento ${i + 1}`}
                  value={m.nome}
                  onChange={(e) => setMed(i, { nome: e.target.value })}
                  placeholder="Ex.: Amoxicilina 500mg"
                />
              </Field>
              <Field
                label={i === 0 ? 'Dosagem' : undefined}
                htmlFor={`prescription-dosage-${i}`}
                className="w-24"
              >
                <Input
                  id={`prescription-dosage-${i}`}
                  aria-label={`Dosagem ${i + 1}`}
                  value={m.dosagem}
                  onChange={(e) => setMed(i, { dosagem: e.target.value })}
                  placeholder="1 cp"
                />
              </Field>
              <Field
                label={i === 0 ? 'Posologia' : undefined}
                htmlFor={`prescription-directions-${i}`}
                className="min-w-36 flex-1"
              >
                <Input
                  id={`prescription-directions-${i}`}
                  aria-label={`Posologia ${i + 1}`}
                  value={m.posologia}
                  onChange={(e) => setMed(i, { posologia: e.target.value })}
                  placeholder="8/8h por 7 dias"
                />
              </Field>
              <Field
                label={i === 0 ? 'Qtd.' : undefined}
                htmlFor={`prescription-quantity-${i}`}
                className="w-20"
              >
                <Input
                  id={`prescription-quantity-${i}`}
                  aria-label={`Qtd. do medicamento ${i + 1}`}
                  value={m.quantidade}
                  onChange={(e) => setMed(i, { quantidade: e.target.value })}
                  placeholder="30"
                />
              </Field>
              <Field
                label={i === 0 ? 'Via' : undefined}
                htmlFor={`prescription-route-${i}`}
                className="w-20"
              >
                <Input
                  id={`prescription-route-${i}`}
                  aria-label={`Via ${i + 1}`}
                  value={m.via}
                  onChange={(e) => setMed(i, { via: e.target.value })}
                  placeholder="oral"
                />
              </Field>
              {meds.length > 1 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon
                  aria-label="Remover medicamento"
                  onClick={() => setMeds((arr) => arr.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setMeds((m) => [...m, emptyMed()])}
            >
              <Plus className="size-3.5" /> Adicionar medicamento
            </Button>
          </div>
          <Field label="Observações (opcional)" htmlFor="prescription-notes">
            <Textarea
              id="prescription-notes"
              rows={2}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />
          </Field>
        </DrawerBody>
        <DrawerFooter>
          <Button loading={pending} onClick={submit}>
            Emitir prescrição (PDF)
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
