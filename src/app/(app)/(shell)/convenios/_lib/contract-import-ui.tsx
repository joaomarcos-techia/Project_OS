'use client';

/**
 * P2.7 — importar a tabela contratual de uma operadora por planilha (CSV ou XLSX).
 *
 * Jornada: baixar o modelo → enviar → prévia com o resultado de cada linha → confirmar → aplicar
 * (tudo ou nada) → histórico. A validação é a MESMA da tela de contrato, feita no servidor numa
 * transação desfeita; aplicar revalida contra o estado atual.
 */
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import {
  applyContractImportAction,
  validateContractImportAction,
} from '@/contexts/health-insurance/config-actions';
import type {
  ContractImportHistoryItem,
  ContractImportPreview,
} from '@/contexts/health-insurance/config-queries';

const ACTION_LABEL: Record<string, { label: string; tone: 'green' | 'blue' | 'gray' | 'red' }> = {
  create: { label: 'Novo item', tone: 'green' },
  adjust: { label: 'Reajuste', tone: 'blue' },
  unchanged: { label: 'Sem mudança', tone: 'gray' },
  error: { label: 'Erro', tone: 'red' },
};
const STATUS_LABEL: Record<string, string> = {
  validated: 'Validada',
  applied: 'Aplicada',
  rejected: 'Com erros',
};

const money = (cents: number | null) =>
  cents === null
    ? '—'
    : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const day = (ymd: string | null) => (ymd ? ymd.split('-').reverse().join('/') : '—');

export function ContractImportPanel({
  insurerId,
  templateCsv,
  columns,
  history,
}: {
  insurerId: string;
  templateCsv: string;
  columns: Array<{ name: string; required: boolean; hint: string }>;
  history: ContractImportHistoryItem[];
}) {
  const router = useRouter();
  const fileId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ContractImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyErrors, setApplyErrors] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const downloadTemplate = () => {
    const blob = new Blob(['﻿', templateCsv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-tabela-convenio.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validate = () => {
    if (!file) return;
    setError(null);
    setApplyErrors([]);
    setPreview(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set('insurerId', insurerId);
      fd.set('file', file);
      const r = await validateContractImportAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setPreview(r.data);
      router.refresh();
    });
  };

  const apply = () => {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const r = await applyContractImportAction({ importId: preview.importId });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data.status === 'applied') {
        toast.success(
          'Tabela importada',
          `${r.data.counts.create} item(ns) novo(s), ${r.data.counts.adjust} reajuste(s), ${r.data.counts.unchanged} sem mudança.`,
        );
        setPreview(null);
        setFile(null);
      } else {
        setApplyErrors(r.data.errors.map((e) => `Linha ${e.line}: ${e.messages.join(' ')}`));
        setError(
          'O contrato mudou desde a prévia; nada foi aplicado. Veja as linhas e envie de novo.',
        );
      }
      router.refresh();
    });
  };

  const changes = preview ? preview.counts.create + preview.counts.adjust : 0;
  const canApply =
    preview?.status === 'validated' && changes > 0 && !preview.alreadyAppliedAt && !pending;

  return (
    <div className="flex flex-col gap-(--sp-3)" data-testid="contract-import">
      <p className="text-(length:--fs-sm) text-fg-muted text-pretty">
        Uma planilha por operadora, com os procedimentos TUSS da tabela 22, valores, vigência, plano
        (já cadastrado), autorização, coparticipação e retorno. Cada linha passa pelas mesmas regras
        do cadastro pela tela. Operadoras, planos e credenciamento não são criados por planilha.
      </p>
      <Alert variant="info" title="Como a importação é aplicada">
        Tudo ou nada: se uma linha tiver erro, nada é aplicado; corrija a planilha e envie de novo.
        Linha igual ao item vigente fica &ldquo;sem mudança&rdquo;. Valor novo a partir de uma data
        posterior vira reajuste (o item atual vale até a véspera; o passado e as guias emitidas não
        mudam). A mesma planilha não é aplicada duas vezes.
      </Alert>
      <details className="text-(length:--fs-sm)">
        <summary className="cursor-pointer font-semibold">Colunas do modelo</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {columns.map((c) => (
            <li key={c.name}>
              <code>{c.name}</code>
              {c.required ? ' (obrigatória)' : ''}: {c.hint}
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-end gap-(--sp-2)">
        <Button type="button" variant="secondary" onClick={downloadTemplate}>
          Baixar modelo (CSV)
        </Button>
        <Field label="Planilha (.csv ou .xlsx, até 2 MB)" htmlFor={fileId}>
          <input
            id={fileId}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setError(null);
            }}
            disabled={pending}
            data-testid="contract-import-file"
          />
        </Field>
        <Button
          type="button"
          onClick={validate}
          disabled={!file || pending}
          data-testid="contract-import-validate"
        >
          {pending && !preview ? 'Validando…' : 'Validar planilha'}
        </Button>
      </div>
      {error ? (
        <Alert variant="danger" data-testid="contract-import-error">
          {error}
          {applyErrors.length ? (
            <ul className="mt-1 list-disc pl-5">
              {applyErrors.slice(0, 20).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}
      {preview ? (
        <div
          className="flex flex-col gap-(--sp-2)"
          data-testid="contract-import-preview"
          data-status={preview.status}
        >
          {preview.missingColumns.length ? (
            <Alert variant="danger">
              Faltam colunas obrigatórias: {preview.missingColumns.join(', ')}.
            </Alert>
          ) : null}
          {preview.unknownColumns.length ? (
            <Alert variant="warning">Colunas ignoradas: {preview.unknownColumns.join(', ')}.</Alert>
          ) : null}
          {preview.alreadyAppliedAt ? (
            <Alert variant="warning">
              Esta mesma planilha já foi aplicada nesta operadora; nada seria feito de novo.
            </Alert>
          ) : null}
          <p className="text-(length:--fs-sm)" data-testid="contract-import-counts">
            {preview.counts.rows} linha(s): {preview.counts.create} novo(s), {preview.counts.adjust}{' '}
            reajuste(s), {preview.counts.unchanged} sem mudança, {preview.counts.error} com erro.
          </p>
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Linha</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Guia</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Resultado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r) => (
                  <TableRow key={r.line} data-testid="contract-import-row" data-action={r.action}>
                    <TableCell data-label="Linha" className="font-mono tabular-nums">
                      {r.line}
                    </TableCell>
                    <TableCell data-label="Código" className="font-mono">
                      {r.procedureCode ?? '—'}
                    </TableCell>
                    <TableCell data-label="Guia">
                      {r.guideType === 'sp_sadt' ? 'SP/SADT' : r.guideType ? 'Consulta' : '—'}
                    </TableCell>
                    <TableCell data-label="Plano">{r.planName ?? 'Todos'}</TableCell>
                    <TableCell data-label="Início">{day(r.validFrom)}</TableCell>
                    <TableCell data-label="Valor" className="tabular-nums">
                      {money(r.unitValueCents)}
                    </TableCell>
                    <TableCell data-label="Resultado">
                      <Badge tone={ACTION_LABEL[r.action]!.tone}>
                        {ACTION_LABEL[r.action]!.label}
                      </Badge>
                      {r.messages.length ? (
                        <span className="mt-0.5 block text-(length:--fs-xs) text-danger-600">
                          {r.messages.join(' ')}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
          <div className="flex flex-wrap gap-(--sp-2)">
            <Button
              type="button"
              onClick={apply}
              disabled={!canApply}
              data-testid="contract-import-apply"
            >
              {pending ? 'Aplicando…' : `Aplicar ${changes} alteração(ões)`}
            </Button>
            {preview.status === 'rejected' ? (
              <span className="self-center text-(length:--fs-sm) text-fg-muted">
                Corrija as linhas com erro e envie de novo.
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
      {history.length ? (
        <details className="text-(length:--fs-sm)" data-testid="contract-import-history">
          <summary className="cursor-pointer font-semibold">Importações anteriores</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {history.map((h) => (
              <li key={h.id}>
                {h.createdAt.slice(0, 10).split('-').reverse().join('/')} · {h.fileName} ·{' '}
                {STATUS_LABEL[h.status] ?? h.status} · {h.rowCount} linha(s), {h.rejectedCount} com
                erro
                {h.appliedAt
                  ? ` · aplicada em ${h.appliedAt.slice(0, 10).split('-').reverse().join('/')}`
                  : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
