'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import type { SupplierSummary } from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { createSupplierAction, setSupplierAtivoAction, updateSupplierAction } from './actions';

type Draft = { razaoSocial: string; cnpj: string; contato: string; condicaoPagamento: string };
const EMPTY: Draft = { razaoSocial: '', cnpj: '', contato: '', condicaoPagamento: '' };

export function FornecedoresView({
  suppliers,
  canManage,
}: {
  suppliers: SupplierSummary[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null); // null = nenhum form; '' = criar
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const openCreate = () => {
    setEditingId('');
    setDraft(EMPTY);
    setError(null);
  };
  const openEdit = (s: SupplierSummary) => {
    setEditingId(s.id);
    setDraft({
      razaoSocial: s.razaoSocial,
      cnpj: s.cnpj ?? '',
      contato: s.contato ?? '',
      condicaoPagamento: s.condicaoPagamento ?? '',
    });
    setError(null);
  };

  const submit = () => {
    setError(null);
    const input = {
      razaoSocial: draft.razaoSocial.trim(),
      cnpj: draft.cnpj.trim() || null,
      contato: draft.contato.trim() || null,
      condicaoPagamento: draft.condicaoPagamento.trim() || null,
    };
    if (!input.razaoSocial) {
      setError('Razão social é obrigatória.');
      return;
    }
    startTransition(async () => {
      const r =
        editingId
          ? await updateSupplierAction(editingId, input, crypto.randomUUID())
          : await createSupplierAction(input, crypto.randomUUID());
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  };

  const toggle = (s: SupplierSummary) => {
    setError(null);
    startTransition(async () => {
      const r = await setSupplierAtivoAction(s.id, !s.ativo, crypto.randomUUID());
      if (!r.ok) {
        setError(r.message);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <Alert variant="danger">{error}</Alert> : null}

      {canManage && editingId === null ? (
        <div>
          <Button size="sm" onClick={openCreate}>
            Novo fornecedor
          </Button>
        </div>
      ) : null}

      {editingId !== null ? (
        <Card>
          <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Razão social" className="sm:col-span-2">
              <Input
                value={draft.razaoSocial}
                onChange={(e) => setDraft((d) => ({ ...d, razaoSocial: e.target.value }))}
                maxLength={160}
              />
            </Field>
            <Field label="CNPJ">
              <Input value={draft.cnpj} onChange={(e) => setDraft((d) => ({ ...d, cnpj: e.target.value }))} maxLength={18} />
            </Field>
            <Field label="Contato">
              <Input
                value={draft.contato}
                onChange={(e) => setDraft((d) => ({ ...d, contato: e.target.value }))}
                maxLength={160}
              />
            </Field>
            <Field label="Condição de pagamento" className="sm:col-span-2">
              <Input
                value={draft.condicaoPagamento}
                onChange={(e) => setDraft((d) => ({ ...d, condicaoPagamento: e.target.value }))}
                maxLength={120}
                placeholder="Ex.: 30 dias, à vista…"
              />
            </Field>
            <div className="flex gap-2 sm:col-span-2">
              <Button size="sm" variant="success" loading={pending} onClick={submit}>
                {editingId ? 'Salvar' : 'Criar'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} disabled={pending}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {suppliers.length === 0 ? (
        <EmptyState title="Nenhum fornecedor" description="Cadastre fornecedores para lançar contas a pagar." />
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {suppliers.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{s.razaoSocial}</span>
                    {!s.ativo ? <Badge tone="gray">Inativo</Badge> : null}
                  </div>
                  <div className="truncate text-xs text-fg-subtle">
                    {[s.cnpj, s.contato, s.condicaoPagamento].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(s)} disabled={pending}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(s)} disabled={pending}>
                      {s.ativo ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
