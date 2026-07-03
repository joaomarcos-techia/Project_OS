'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import {
  createProcedure,
  deactivateProcedure,
  updateProcedure,
} from '@/contexts/scheduling/catalog-actions';
import type { ProcedureSummary } from '@/contexts/scheduling/types';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Editing = { id: string | null } | null;

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function ProceduresManager({ initial }: { initial: ProcedureSummary[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Editing>(null);
  const [codigo, setCodigo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [categoria, setCategoria] = useState('');
  const [valor, setValor] = useState('');
  const [duracao, setDuracao] = useState('30');
  const [busy, start] = useTransition();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return initial.filter((p) => {
      if (!showInactive && !p.ativo) return false;
      if (!term) return true;
      return (
        p.descricao.toLowerCase().includes(term) ||
        p.codigo.toLowerCase().includes(term) ||
        (p.categoria ?? '').toLowerCase().includes(term)
      );
    });
  }, [initial, search, showInactive]);

  function startNew() {
    setEditing({ id: null });
    setCodigo('');
    setDescricao('');
    setCategoria('');
    setValor('');
    setDuracao('30');
  }

  function startEdit(p: ProcedureSummary) {
    setEditing({ id: p.id });
    setCodigo(p.codigo);
    setDescricao(p.descricao);
    setCategoria(p.categoria ?? '');
    setValor(String(p.valorPadrao));
    setDuracao(String(p.duracaoPadraoMin));
  }

  function save() {
    const valorNum = Number(valor.replace(',', '.'));
    const duracaoNum = Number(duracao);
    if (!codigo.trim()) return toast.error('Informe o código.');
    if (!descricao.trim()) return toast.error('Informe a descrição.');
    if (!Number.isFinite(valorNum) || valorNum < 0) return toast.error('Valor inválido.');
    if (!Number.isInteger(duracaoNum) || duracaoNum < 1) {
      return toast.error('Duração inválida (minutos).');
    }

    start(async () => {
      try {
        if (editing?.id) {
          await updateProcedure(
            editing.id,
            {
              codigo: codigo.trim(),
              descricao: descricao.trim(),
              categoria: categoria.trim() || null,
              valorPadrao: valorNum,
              duracaoPadraoMin: duracaoNum,
            },
            crypto.randomUUID(),
          );
        } else {
          await createProcedure(
            {
              codigo: codigo.trim(),
              descricao: descricao.trim(),
              ...(categoria.trim() ? { categoria: categoria.trim() } : {}),
              valorPadrao: valorNum,
              duracaoPadraoMin: duracaoNum,
            },
            crypto.randomUUID(),
          );
        }
        setEditing(null);
        toast.success('Procedimento salvo.');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao salvar.');
      }
    });
  }

  function deactivate(p: ProcedureSummary) {
    if (!confirm(`Desativar "${p.descricao}"? Atendimentos existentes não são afetados.`)) return;
    start(async () => {
      try {
        await deactivateProcedure(p.id, crypto.randomUUID());
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao desativar.');
      }
    });
  }

  function reactivate(p: ProcedureSummary) {
    start(async () => {
      try {
        await updateProcedure(p.id, { ativo: true }, crypto.randomUUID());
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao reativar.');
      }
    });
  }

  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, descrição ou categoria"
          className="max-w-xs"
        />
        <label className="flex items-center gap-1.5 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="size-4"
          />
          Mostrar inativos
        </label>
        <Button type="button" size="sm" onClick={startNew}>
          Novo procedimento
        </Button>
      </div>


      {editing ? (
        <div className="cardblock wrap-pad flex flex-col gap-3">
          <h4 className="text-sm font-semibold">
            {editing.id ? 'Editar procedimento' : 'Novo procedimento'}
          </h4>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Código * (ex: CONS)" maxLength={40} />
            <Input
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Categoria (opcional)"
              maxLength={60}
            />
          </div>
          <Input
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição * (ex: Consulta)"
            maxLength={160}
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">Valor padrão (R$)</span>
              <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" inputMode="decimal" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-fg-muted">Duração (min)</span>
              <Input value={duracao} onChange={(e) => setDuracao(e.target.value)} placeholder="30" inputMode="numeric" />
            </label>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" loading={busy} onClick={save}>
              Salvar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-sm text-fg-muted">
          Nenhum procedimento. Clique em “Novo procedimento” para cadastrar o catálogo (necessário
          para criar atendimentos na Agenda).
        </p>
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {filtered.map((p) => (
              <div key={p.id} className="listrow">
                <div className="lr-main">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-fg-subtle">{p.codigo}</span>
                    <span className="font-medium">{p.descricao}</span>
                    {p.categoria ? <span className="text-xs text-fg-subtle">{p.categoria}</span> : null}
                    <span className="text-xs text-fg-muted">
                      {brl(p.valorPadrao)} · {p.duracaoPadraoMin}min
                    </span>
                    {!p.ativo ? <Badge tone="gray">inativo</Badge> : null}
                  </div>
                </div>
                <div className="lr-end flex gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(p)}>
                    Editar
                  </Button>
                  {p.ativo ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => deactivate(p)} disabled={busy}>
                      Desativar
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => reactivate(p)} disabled={busy}>
                      Reativar
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
