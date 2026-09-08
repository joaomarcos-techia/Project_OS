'use client';

import { FileCheck, FileText, FlaskConical, Share2 } from 'lucide-react';
import { useState, useTransition, type ReactNode } from 'react';

import type { CreateMedicalDocumentInput, MedicalDocumentType } from '@/contexts/clinical/types';
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
import { FormSection } from '@/components/ui/form-section';
import { OptionCardGroup } from '@/components/ui/option-card-group';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

import { emitDocument } from './actions';
import { uuidv4 } from '@/lib/ui/uuid';

const DOC_LABEL: Record<MedicalDocumentType, string> = {
  atestado: 'Atestado',
  exame: 'Solicitação de exame',
  declaracao: 'Declaração',
  encaminhamento: 'Encaminhamento',
};

/** O que cada tipo serve para — a descrição existe porque o rótulo sozinho não
 *  distingue atestado de declaração para quem não emite documento todo dia. */
const DOC_DESCRIPTION: Record<MedicalDocumentType, string> = {
  atestado: 'Justificar afastamento ou incapacidade.',
  exame: 'Pedir exames ou procedimentos complementares.',
  declaracao: 'Comprovar comparecimento ou acompanhamento.',
  encaminhamento: 'Encaminhar para outro profissional.',
};

const DOC_ICON: Record<MedicalDocumentType, ReactNode> = {
  atestado: <FileCheck />,
  exame: <FlaskConical />,
  declaracao: <FileText />,
  encaminhamento: <Share2 />,
};

/** Emissão de documento médico em Drawer (atestado/exame/declaração/encaminhamento). */
export function DocumentDrawer({
  patientId,
  defaultOpen = false,
}: {
  patientId: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
      const res = await emitDocument(input, uuidv4());
      if (res.ok) {
        toast.success(`${DOC_LABEL[type]} emitido`, 'O PDF abriu em outra aba.');
        window.open(`/documentos/${res.data.id}/pdf`, '_blank', 'noopener');
        setFields({});
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
          <FileText className="size-3.5" />
          Documento
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Emitir documento</DrawerTitle>
        </DrawerHeader>
        <DrawerBody className="flex flex-col gap-4">
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <FormSection label="Tipo de documento">
            <OptionCardGroup
              name="document-type"
              aria-label="Tipo de documento"
              value={type}
              onValueChange={setType}
              options={(Object.keys(DOC_LABEL) as MedicalDocumentType[]).map((t) => ({
                value: t,
                label: DOC_LABEL[t],
                description: DOC_DESCRIPTION[t],
                icon: DOC_ICON[t],
              }))}
            />
          </FormSection>

          {type === 'atestado' ? (
            <>
              <Field label="Descrição" htmlFor="document-description">
                <Textarea
                  id="document-description"
                  rows={2}
                  value={f('descricao')}
                  onChange={(e) => set('descricao', e.target.value)}
                />
              </Field>
              <div className="flex gap-2">
                <Field label="Dias de afastamento" htmlFor="document-days" className="w-40">
                  <Input
                    id="document-days"
                    type="number"
                    min={0}
                    value={f('dias')}
                    onChange={(e) => set('dias', e.target.value)}
                  />
                </Field>
                <Field label="CID (opcional)" htmlFor="document-cid" className="w-40">
                  <Input
                    id="document-cid"
                    value={f('cid')}
                    onChange={(e) => set('cid', e.target.value)}
                  />
                </Field>
              </div>
            </>
          ) : null}

          {type === 'exame' ? (
            <>
              <Field label="Exames (um por linha)" htmlFor="document-exams">
                <Textarea
                  id="document-exams"
                  rows={3}
                  value={f('exames')}
                  onChange={(e) => set('exames', e.target.value)}
                />
              </Field>
              <Field label="Indicação clínica (opcional)" htmlFor="document-indication">
                <Textarea
                  id="document-indication"
                  rows={2}
                  value={f('indicacao')}
                  onChange={(e) => set('indicacao', e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {type === 'declaracao' ? (
            <>
              <Field label="Texto" htmlFor="document-text">
                <Textarea
                  id="document-text"
                  rows={3}
                  value={f('texto')}
                  onChange={(e) => set('texto', e.target.value)}
                />
              </Field>
              <Field label="Período (opcional)" htmlFor="document-period">
                <Input
                  id="document-period"
                  value={f('periodo')}
                  onChange={(e) => set('periodo', e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {type === 'encaminhamento' ? (
            <>
              <Field label="Especialidade" htmlFor="document-specialty">
                <Input
                  id="document-specialty"
                  value={f('especialidade')}
                  onChange={(e) => set('especialidade', e.target.value)}
                />
              </Field>
              <Field label="Motivo" htmlFor="document-reason">
                <Textarea
                  id="document-reason"
                  rows={2}
                  value={f('motivo')}
                  onChange={(e) => set('motivo', e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </DrawerBody>
        <DrawerFooter>
          <Button loading={pending} onClick={submit}>
            Emitir documento (PDF)
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
