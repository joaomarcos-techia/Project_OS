'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CLINICAL_TEMPLATES } from '@/contexts/clinical/templates';
import type { ClinicalTemplate, ProntuarioContent, ProntuarioDetail } from '@/contexts/clinical/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/ui/cn';

import { autosaveProntuario } from '../actions';

const AUTOSAVE_MS = 10_000;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'conflict' | 'imutavel' | 'error';

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: 'Não salvo',
  saving: 'Salvando…',
  saved: 'Salvo',
  conflict: 'Conflito de versão',
  imutavel: 'Prontuário assinado',
  error: 'Erro ao salvar',
};

export function ProntuarioEditor({ prontuario }: { prontuario: ProntuarioDetail }) {
  const signed = prontuario.status === 'assinado';
  const [content, setContent] = useState<ProntuarioContent>(prontuario.content ?? {});
  const [templateId, setTemplateId] = useState<string>(CLINICAL_TEMPLATES[0]!.id);
  const template = useMemo<ClinicalTemplate>(
    () => CLINICAL_TEMPLATES.find((t) => t.id === templateId) ?? CLINICAL_TEMPLATES[0]!,
    [templateId],
  );
  const [status, setStatus] = useState<SaveStatus>(signed ? 'imutavel' : 'idle');
  const rowVersionRef = useRef(prontuario.rowVersion);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    if (signed || !dirtyRef.current) return;
    setStatus('saving');
    const res = await autosaveProntuario(prontuario.id, content, rowVersionRef.current);
    if (res.ok) {
      rowVersionRef.current = res.rowVersion;
      dirtyRef.current = false;
      setStatus('saved');
    } else {
      setStatus(res.kind === 'conflict' ? 'conflict' : res.kind === 'imutavel' ? 'imutavel' : 'error');
    }
  }, [content, prontuario.id, signed]);

  // Debounce: salva 10s após a última alteração (evita flood de requests).
  useEffect(() => {
    if (signed || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void save();
    }, AUTOSAVE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, save, signed]);

  function setField(key: keyof ProntuarioContent, value: string) {
    if (signed) return;
    dirtyRef.current = true;
    setStatus('idle');
    setContent((c) => ({ ...c, [key]: value }));
  }

  const conflict = status === 'conflict';

  return (
    <div>
      {signed ? (
        <Alert variant="success" title="Prontuário assinado — somente leitura" className="mb-4">
          {prontuario.signedDoctorNome ?? '—'}
          {prontuario.signedDoctorCrm
            ? ` — CRM ${prontuario.signedDoctorCrmUf ?? ''} ${prontuario.signedDoctorCrm}`
            : ''}
          {prontuario.signedAt
            ? ` · assinado em ${new Date(prontuario.signedAt).toLocaleString('pt-BR')}`
            : ''}
        </Alert>
      ) : (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-fg-muted">Template</span>
            <Select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="min-w-55"
            >
              {CLINICAL_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex items-center gap-3">
            <span
              className={cn(
                'text-sm',
                status === 'saved'
                  ? 'text-success-600'
                  : status === 'error'
                    ? 'text-danger-600'
                    : 'text-fg-subtle',
              )}
            >
              {STATUS_LABEL[status]}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void save()}
              disabled={status === 'saving'}
            >
              Salvar agora
            </Button>
          </div>
        </div>
      )}

      {conflict ? (
        <Alert variant="danger" className="mb-4">
          Este prontuário foi alterado em outra janela/dispositivo. Suas mudanças NÃO foram salvas.{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-medium underline"
          >
            Recarregar
          </button>{' '}
          para ver a versão atual.
        </Alert>
      ) : null}

      <div className="flex flex-col gap-4">
        {template.fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-fg-subtle">
              {f.label}
            </label>
            <Textarea
              value={content[f.key] ?? ''}
              placeholder={f.placeholder}
              disabled={signed}
              rows={3}
              onChange={(e) => setField(f.key, e.target.value)}
              className={signed ? 'bg-surface-inset disabled:opacity-100' : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
