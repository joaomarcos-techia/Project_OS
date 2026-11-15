'use client';

/**
 * Dados da Guia de Consulta (D11, P4.6): regime, acidente, tipo de consulta, cobertura especial,
 * saúde ocupacional e observação. Os padrões valem até alguém ajustar; o ajuste só existe com a
 * guia em edição (o servidor e o banco conferem de novo). As opções vêm da terminologia da ANS
 * carregada para a guia: a tela não inventa código.
 */
import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { ActionResult } from '@/contexts/health-insurance/actions';

import { useRunner } from './action-ui';

type CodeField =
  | 'regimeAtendimento'
  | 'indicacaoAcidente'
  | 'tipoConsulta'
  | 'coberturaEspecial'
  | 'saudeOcupacional';
type Overrides = Partial<Record<CodeField | 'observacao', string>>;
type Option = { code: string; term: string };

const FIELDS: ReadonlyArray<{
  key: CodeField;
  label: string;
  /** Padrão da D11; sem padrão, o campo fica fora da guia quando não ajustado. */
  defaultCode?: string;
  defaultHint?: string;
}> = [
  { key: 'regimeAtendimento', label: 'Regime de atendimento', defaultCode: '01' },
  { key: 'indicacaoAcidente', label: 'Indicação de acidente', defaultCode: '9' },
  {
    key: 'tipoConsulta',
    label: 'Tipo de consulta',
    defaultCode: '1',
    defaultHint: '2 se for retorno no prazo do contrato',
  },
  { key: 'coberturaEspecial', label: 'Cobertura especial' },
  { key: 'saudeOcupacional', label: 'Saúde ocupacional' },
];

const termOf = (options: Option[] | undefined, code: string): string | null =>
  options?.find((o) => o.code === code)?.term ?? null;

function shown(
  field: (typeof FIELDS)[number],
  options: Option[] | undefined,
  value: string | undefined,
): { text: string; adjusted: boolean } {
  if (value) {
    const term = termOf(options, value);
    return { text: term ? `${value} · ${term}` : value, adjusted: true };
  }
  if (field.defaultCode) {
    const term = termOf(options, field.defaultCode);
    const base = term ? `${field.defaultCode} · ${term}` : field.defaultCode;
    return {
      text: `Padrão: ${base}${field.defaultHint ? ` (${field.defaultHint})` : ''}`,
      adjusted: false,
    };
  }
  return { text: 'Não informada', adjusted: false };
}

export function ConsultaFieldsPanel({
  guideId,
  version,
  overrides,
  options,
  editable,
  issued,
  action,
}: {
  guideId: string;
  version: number;
  overrides: Overrides | null;
  options: Record<CodeField, Option[]> | null;
  /** Gerencia o financeiro e a guia está em edição. */
  editable: boolean;
  /** Já aprovada: o que vale é o conteúdo emitido (PDF). */
  issued: boolean;
  action: (
    input: { guideId: string; version: number } & Partial<Record<CodeField | 'observacao', string>>,
  ) => Promise<ActionResult<number>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const current = overrides ?? {};
  const [values, setValues] = useState<Overrides>(current);
  const { pending, runAction } = useRunner();
  const obs = values.observacao ?? '';

  return (
    <div className="flex flex-col gap-(--sp-3)" data-testid="consulta-fields">
      <dl className="grid grid-cols-1 gap-(--sp-2) text-(length:--fs-sm) sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => {
          const v = shown(f, options?.[f.key], current[f.key]);
          return (
            <div key={f.key} className="min-w-0">
              <dt className="text-fg-muted">{f.label}</dt>
              <dd className="break-words" data-adjusted={v.adjusted ? 'true' : 'false'}>
                {v.text}
                {v.adjusted ? <span className="text-fg-muted"> (ajustado)</span> : null}
              </dd>
            </div>
          );
        })}
        <div className="min-w-0 sm:col-span-2 lg:col-span-3">
          <dt className="text-fg-muted">Observação</dt>
          <dd className="break-words whitespace-pre-line">
            {current.observacao ?? 'Sem observação'}
          </dd>
        </div>
      </dl>
      {issued ? (
        <p className="text-(length:--fs-sm) text-fg-muted">
          Guia aprovada: vale o conteúdo emitido (PDF da guia). Para mudar, use “Devolver para
          correção”: a próxima emissão sai como nova revisão e a anterior fica no histórico.
        </p>
      ) : null}
      {editable && !open ? (
        <div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setValues(current);
              setOpen(true);
            }}
          >
            Ajustar dados da consulta
          </Button>
        </div>
      ) : null}
      {editable && open ? (
        <form
          className="flex flex-col gap-(--sp-3) rounded-(--r-md) border border-border p-(--sp-3)"
          aria-label="Ajustar dados da consulta"
          onSubmit={(e) => {
            e.preventDefault();
            runAction(
              () =>
                action({
                  guideId,
                  version,
                  ...Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key] ?? ''])),
                  observacao: obs,
                }),
              'Dados da consulta salvos',
              () => setOpen(false),
            );
          }}
        >
          <div className="grid grid-cols-1 gap-(--sp-3) sm:grid-cols-2">
            {FIELDS.map((f) => {
              const opts = options?.[f.key] ?? [];
              const defaultTerm = f.defaultCode ? termOf(opts, f.defaultCode) : null;
              return (
                <Field key={f.key} label={f.label} htmlFor={`${id}-${f.key}`}>
                  <Select
                    id={`${id}-${f.key}`}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    <option value="">
                      {f.defaultCode
                        ? `Padrão (${f.defaultCode}${defaultTerm ? ` · ${defaultTerm}` : ''}${f.defaultHint ? `; ${f.defaultHint}` : ''})`
                        : 'Não informar'}
                    </option>
                    {opts.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.code} · {o.term}
                      </option>
                    ))}
                  </Select>
                </Field>
              );
            })}
          </div>
          <Field
            label="Observação"
            htmlFor={`${id}-obs`}
            hint={`${obs.trim().length}/500 (padrão TISS). Não escreva diagnóstico nem dado clínico: a Guia de Consulta não leva CID.`}
          >
            <Textarea
              id={`${id}-obs`}
              value={obs}
              onChange={(e) => setValues((v) => ({ ...v, observacao: e.target.value }))}
              rows={3}
              maxLength={500}
            />
          </Field>
          <div className="flex flex-wrap gap-(--sp-2)">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? 'Aguarde…' : 'Salvar dados da consulta'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Voltar
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
