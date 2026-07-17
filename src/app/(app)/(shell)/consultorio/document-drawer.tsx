'use client';

import { FileText } from 'lucide-react';
import { useState, useTransition } from 'react';

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
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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

/** Emissão de documento médico em Drawer (atestado/exame/declaração/encaminhamento). */
export function DocumentDrawer({ patientId }: { patientId: string }) {
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
                <Textarea
                  rows={3}
                  value={f('texto')}
                  onChange={(e) => set('texto', e.target.value)}
                />
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
