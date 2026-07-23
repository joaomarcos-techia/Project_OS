'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import type { SupplierSummary } from '@/contexts/financial/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';

import { createSupplierAction, setSupplierAtivoAction, updateSupplierAction } from './actions';
import { maskCnpj, maskPhoneBR } from '@/lib/masks';
import { uuidv4 } from '@/lib/ui/uuid';

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
  const [editingId, setEditingId] = useState<string | null>(null); // null = fechado; '' = criar
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
      cnpj: maskCnpj(s.cnpj ?? ''),
      contato: maskPhoneBR(s.contato ?? ''),
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
      const r = editingId
        ? await updateSupplierAction(editingId, input, uuidv4())
        : await createSupplierAction(input, uuidv4());
      if (!r.ok) {
        setError(r.message);
        return;
      }
      toast.success(editingId ? 'Fornecedor atualizado' : 'Fornecedor criado');
      setEditingId(null);
      router.refresh();
    });
  };

  const toggle = (s: SupplierSummary) => {
    startTransition(async () => {
      const r = await setSupplierAtivoAction(s.id, !s.ativo, uuidv4());
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      toast.success(s.ativo ? 'Fornecedor desativado' : 'Fornecedor ativado');
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {canManage ? (
        <div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-3.5" />
            Novo fornecedor
          </Button>
        </div>
      ) : null}

      <Dialog open={editingId !== null} onOpenChange={(v) => !v && setEditingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Editar fornecedor' : 'Novo fornecedor'}</DialogTitle>
          </DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-2">
            {error ? (
              <Alert variant="danger" className="sm:col-span-2">
                {error}
              </Alert>
            ) : null}
            <Field label="Razão social" required className="sm:col-span-2">
              <Input
                value={draft.razaoSocial}
                onChange={(e) => setDraft((d) => ({ ...d, razaoSocial: e.target.value }))}
                maxLength={160}
              />
            </Field>
            <Field label="CNPJ">
              <Input
                value={draft.cnpj}
                onChange={(e) => setDraft((d) => ({ ...d, cnpj: maskCnpj(e.target.value) }))}
                maxLength={18}
                inputMode="numeric"
                placeholder="00.000.000/0001-00"
              />
            </Field>
            <Field label="Telefone">
              <Input
                value={draft.contato}
                onChange={(e) => setDraft((d) => ({ ...d, contato: maskPhoneBR(e.target.value) }))}
                type="tel"
                inputMode="tel"
                maxLength={16}
                placeholder="(11) 99999-9999"
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
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" type="button" disabled={pending}>
                Cancelar
              </Button>
            </DialogClose>
            <Button loading={pending} onClick={submit}>
              {editingId ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {suppliers.length === 0 ? (
        <EmptyState
          title="Nenhum fornecedor"
          description="Cadastre fornecedores para lançar contas a pagar."
        />
      ) : (
        <Card>
          <ul className="flex flex-col">
            {suppliers.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-(--card-pad) py-3 last:border-b-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <b className="truncate text-(length:--fs-sm)">{s.razaoSocial}</b>
                    {!s.ativo ? <Badge tone="gray">Inativo</Badge> : null}
                  </div>
                  <span className="block truncate text-(length:--fs-xs) text-fg-subtle">
                    {[s.cnpj, s.contato, s.condicaoPagamento].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>
                {canManage ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(s)} disabled={pending}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(s)} disabled={pending}>
                      {s.ativo ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
