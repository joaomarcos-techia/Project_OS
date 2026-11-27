'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CLINICAL_TEMPLATES } from '@/contexts/clinical/templates';
import type {
  ClinicalTemplate,
  ProntuarioContent,
  ProntuarioDetail,
} from '@/contexts/clinical/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/ui/cn';

import { registerPendingWork } from '@/app/(app)/_lib/pending-work';

import { autosaveProntuario, type AutosaveResult } from '../actions';

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

// Cadência do "tempo desde o último salvamento" — re-renderiza o rótulo relativo.
const SAVED_TICK_MS = 10_000;

/**
 * Rótulo relativo do autosave (spec C8): "Salvo agora" (<10s) → "Salvo há N
 * segundos" (<60s) → "Salvo há N minuto(s)". `savedAt`/`now` em ms epoch.
 */
function savedLabel(savedAt: number | null, now: number): string {
  if (savedAt == null) return STATUS_LABEL.saved;
  const secs = Math.max(0, Math.round((now - savedAt) / 1000));
  if (secs < 10) return 'Salvo agora';
  if (secs < 60) return `Salvo há ${secs} segundos`;
  const mins = Math.round(secs / 60);
  return mins <= 1 ? 'Salvo há 1 minuto' : `Salvo há ${mins} minutos`;
}

export function ProntuarioEditor({
  prontuario,
  canEdit = true,
}: {
  prontuario: ProntuarioDetail;
  /**
   * AUTHZ-003 — falso quando a sessão não tem `create:prontuario`. O editor
   * era sempre editável e só a action negava, produzindo a combinação que o
   * pentest registrou: tela dizendo "somente leitura" com textarea habilitado.
   * Somar aqui em `signed` deixa UMA porta de imutabilidade, não duas.
   */
  canEdit?: boolean;
}) {
  // "Imutável" tem duas origens — assinado (contrato clínico) e sem permissão
  // de escrita (RBAC) — e o editor trata as duas igual: não digita, não
  // autosalva, não avisa de saída suja.
  const signed = prontuario.status === 'assinado' || !canEdit;
  const [content, setContent] = useState<ProntuarioContent>(prontuario.content ?? {});
  const [templateId, setTemplateId] = useState<string>(CLINICAL_TEMPLATES[0]!.id);
  const template = useMemo<ClinicalTemplate>(
    () => CLINICAL_TEMPLATES.find((t) => t.id === templateId) ?? CLINICAL_TEMPLATES[0]!,
    [templateId],
  );
  const [status, setStatus] = useState<SaveStatus>(signed ? 'imutavel' : 'idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [nowTs, setNowTs] = useState(() => Date.now());
  const rowVersionRef = useRef(prontuario.rowVersion);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const contentRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // contentRef sempre com o conteúdo mais recente — usado pelo flush no unmount
  // (que não pode depender do closure do effect).
  contentRef.current = content;

  // persist: salva o conteúdo ATUAL (via ref, nunca stale). Reivindica as edições
  // ANTES do await (dirty=false); se o usuário digitar durante o save lento, o
  // setField re-marca dirty → o autosave seguinte persiste o que faltou (corrige a
  // corrida "salvou e perdeu o que digitei no meio"). Falha → mantém dirty p/ retry.
  // Rede caída faz a chamada da action REJEITAR (não volta `{ ok: false }`): sem o catch, `savingRef` ficava preso
  // em true e o editor nunca mais salvava (nem no aviso de inatividade da S2). Rejeição = erro de salvamento.
  const persist = useCallback(async (): Promise<void> => {
    if (signed || savingRef.current || !dirtyRef.current) return;
    savingRef.current = true;
    dirtyRef.current = false;
    setStatus('saving');
    let res: AutosaveResult;
    try {
      res = await autosaveProntuario(prontuario.id, contentRef.current, rowVersionRef.current);
    } catch {
      res = { ok: false, kind: 'error', message: 'Falha de rede ao salvar.' };
    }
    savingRef.current = false;
    if (res.ok) {
      rowVersionRef.current = res.rowVersion;
      setSavedAt(Date.now());
      setNowTs(Date.now());
      setStatus(dirtyRef.current ? 'idle' : 'saved');
    } else {
      dirtyRef.current = true;
      setStatus(
        res.kind === 'conflict' ? 'conflict' : res.kind === 'imutavel' ? 'imutavel' : 'error',
      );
    }
  }, [prontuario.id, signed]);

  // "Salvar agora": força persistir o conteúdo atual mesmo se o tracking de dirty
  // se perdeu — o clique explícito SEMPRE tenta salvar (nada de no-op silencioso).
  const saveNow = useCallback(() => {
    if (signed) return;
    dirtyRef.current = true;
    void persist();
  }, [persist, signed]);

  // Debounce: salva 10s após a última alteração (evita flood de requests).
  useEffect(() => {
    if (signed || !dirtyRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void persist();
    }, AUTOSAVE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [content, persist, signed]);

  // S2 (requisito 83): antes do bloqueio por inatividade o guarda pede para salvar o que falta. Espera um save em
  // andamento terminar, salva o pendente e responde se ficou tudo no servidor (nada vai para o navegador).
  useEffect(() => {
    if (signed) return;
    return registerPendingWork(async () => {
      for (let i = 0; i < 50 && savingRef.current; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (dirtyRef.current) await persist();
      return !dirtyRef.current && !savingRef.current;
    });
  }, [persist, signed]);

  // Flush no unmount: ao TROCAR de paciente (ou fechar), o cleanup do debounce
  // cancelaria o autosave pendente e perderia o texto. Aqui salvamos as edições
  // pendentes (fire-and-forget) com o conteúdo/rowVersion mais recentes (refs).
  useEffect(() => {
    return () => {
      if (!signed && dirtyRef.current) {
        autosaveProntuario(prontuario.id, contentRef.current, rowVersionRef.current).catch(() => {
          /* fire-and-forget: rede caída aqui não tem tela para avisar; o texto não sobe */
        });
      }
    };
    // refs são sempre atuais; deps vazias = roda só no unmount real.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Enquanto "Salvo", re-renderiza o rótulo relativo ("há N segundos") sem refetch.
  useEffect(() => {
    if (status !== 'saved') return;
    const t = setInterval(() => setNowTs(Date.now()), SAVED_TICK_MS);
    return () => clearInterval(t);
  }, [status]);

  function setField(key: keyof ProntuarioContent, value: string) {
    if (signed) return;
    dirtyRef.current = true;
    setStatus('idle');
    setContent((c) => ({ ...c, [key]: value }));
  }

  const conflict = status === 'conflict';

  return (
    <div>
      {prontuario.status === 'assinado' ? (
        <Alert variant="success" title="Prontuário assinado — somente leitura" className="mb-4">
          {prontuario.signedDoctorNome ?? '—'}
          {prontuario.signedDoctorCrm
            ? ` — CRM ${prontuario.signedDoctorCrmUf ?? ''} ${prontuario.signedDoctorCrm}`
            : ''}
          {prontuario.signedAt
            ? ` · assinado em ${new Date(prontuario.signedAt).toLocaleString('pt-BR')}`
            : ''}
        </Alert>
      ) : signed ? (
        // Rascunho que ESTA sessão não pode editar. Dizer "assinado" aqui seria
        // mentira clínica; o rótulo precisa nomear a causa real.
        <Alert variant="warning" title="Somente leitura" className="mb-4">
          Seu perfil não tem permissão para editar prontuários.
        </Alert>
      ) : (
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-(length:--fs-xs) font-medium text-fg-muted">Template</span>
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
              {status === 'saved' ? savedLabel(savedAt, nowTs) : STATUS_LABEL[status]}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={saveNow}
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
            <label className="text-(length:--fs-2xs) font-semibold uppercase tracking-(--tracking-label) text-fg-subtle">
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
