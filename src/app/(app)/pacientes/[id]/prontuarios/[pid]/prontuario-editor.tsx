'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CLINICAL_TEMPLATES } from '@/contexts/clinical/templates';
import type { ClinicalTemplate, ProntuarioContent, ProntuarioDetail } from '@/contexts/clinical/types';

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
        <div className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          <strong>Prontuário assinado — somente leitura.</strong>
          <div className="mt-1 text-green-800">
            {prontuario.signedDoctorNome ?? '—'}
            {prontuario.signedDoctorCrm
              ? ` — CRM ${prontuario.signedDoctorCrmUf ?? ''} ${prontuario.signedDoctorCrm}`
              : ''}
            {prontuario.signedAt
              ? ` · assinado em ${new Date(prontuario.signedAt).toLocaleString('pt-BR')}`
              : ''}
          </div>
        </div>
      ) : (
        <div className="mb-4 flex items-center justify-between gap-3">
          <label className="text-sm">
            Template:{' '}
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="rounded border border-gray-300 px-2 py-1 text-sm"
            >
              {CLINICAL_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3">
            <span
              className={
                status === 'saved'
                  ? 'text-sm text-green-700'
                  : status === 'error'
                    ? 'text-sm text-red-600'
                    : 'text-sm text-gray-500'
              }
            >
              {STATUS_LABEL[status]}
            </span>
            <button
              type="button"
              onClick={() => void save()}
              disabled={status === 'saving'}
              className="rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-50"
            >
              Salvar agora
            </button>
          </div>
        </div>
      )}

      {conflict ? (
        <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Este prontuário foi alterado em outra janela/dispositivo. Suas mudanças NÃO foram salvas.{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="underline"
          >
            Recarregar
          </button>{' '}
          para ver a versão atual.
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {template.fields.map((f) => (
          <div key={f.key} className="flex flex-col gap-1">
            <label className="text-xs font-semibold uppercase text-gray-500">{f.label}</label>
            <textarea
              value={content[f.key] ?? ''}
              placeholder={f.placeholder}
              disabled={signed}
              rows={3}
              onChange={(e) => setField(f.key, e.target.value)}
              className="rounded border border-gray-300 p-2 text-sm disabled:bg-gray-100"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
