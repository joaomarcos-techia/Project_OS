'use client';

import { Stethoscope } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { deactivateProcedure, updateProcedure } from '@/contexts/scheduling/catalog-actions';
import { createProcedureWithTrialLimit } from '../../_actions/create-limited';
import { unwrapAction } from '@/contexts/scheduling/action-result';
import type { ProcedureSummary } from '@/contexts/scheduling/types';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { DestructiveAction } from '@/components/ui/destructive-action';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';
import { FilterBar, SearchField } from '@/components/ui/filter-bar';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableCellStack,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { uuidv4 } from '@/lib/ui/uuid';

type Editing = { id: string | null } | null;

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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
            uuidv4(),
          );
        } else {
          await unwrapAction(
            createProcedureWithTrialLimit(
              {
                codigo: codigo.trim(),
                descricao: descricao.trim(),
                ...(categoria.trim() ? { categoria: categoria.trim() } : {}),
                valorPadrao: valorNum,
                duracaoPadraoMin: duracaoNum,
              },
              uuidv4(),
            ),
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

  function reactivate(p: ProcedureSummary) {
    start(async () => {
      try {
        await updateProcedure(p.id, { ativo: true }, uuidv4());
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao reativar.');
      }
    });
  }

  return (
    <div className="flex max-w-190 flex-col gap-(--sp-4)">
      <FilterBar className="mb-0">
        <SearchField
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por código, descrição ou categoria"
          aria-label="Buscar procedimento"
        />
        <label className="flex cursor-pointer items-center gap-2 text-(length:--fs-body-sm) text-fg-muted">
          <Checkbox
            checked={showInactive}
            onCheckedChange={(value) => setShowInactive(value === true)}
          />
          Mostrar inativos
        </label>
        <Button type="button" onClick={startNew}>
          Novo procedimento
        </Button>
      </FilterBar>

      {editing ? (
        <Card className="flex flex-col gap-(--sp-4) p-(--card-pad)">
          <h2 className="text-(length:--fs-subsection) font-semibold">
            {editing.id ? 'Editar procedimento' : 'Novo procedimento'}
          </h2>
          {/* Rótulo de verdade em cada campo: antes o placeholder fazia as vezes
              de label e sumia ao digitar — quem revisava o formulário preenchido
              perdia a referência do que era cada caixa (P-17). */}
          <div className="grid gap-(--sp-4) sm:grid-cols-2">
            <Field label="Código" htmlFor="proc-codigo" required>
              <Input
                id="proc-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="CONS"
                maxLength={40}
              />
            </Field>
            <Field label="Categoria" htmlFor="proc-categoria">
              <Input
                id="proc-categoria"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                maxLength={60}
              />
            </Field>
          </div>
          <Field label="Descrição" htmlFor="proc-descricao" required>
            <Input
              id="proc-descricao"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Consulta"
              maxLength={160}
            />
          </Field>
          <div className="grid gap-(--sp-4) sm:grid-cols-2">
            <Field label="Valor padrão (R$)" htmlFor="proc-valor">
              <Input
                id="proc-valor"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
              />
            </Field>
            <Field label="Duração (min)" htmlFor="proc-duracao">
              <Input
                id="proc-duracao"
                value={duracao}
                onChange={(e) => setDuracao(e.target.value)}
                placeholder="30"
                inputMode="numeric"
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="button" loading={busy} onClick={save}>
              Salvar
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
          </div>
        </Card>
      ) : null}

      <TableWrap>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Stethoscope />}
            title="Nenhum procedimento no catálogo"
            description="A Agenda precisa de pelo menos um para criar atendimentos."
            action={
              <Button type="button" size="sm" onClick={startNew}>
                Novo procedimento
              </Button>
            }
          />
        ) : (
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Procedimento</TableHead>
                  <TableHead numeric>Valor</TableHead>
                  <TableHead numeric>Duração</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-(length:--fs-xs) text-fg-subtle">
                      {p.codigo}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <TableCellStack main={p.descricao} sub={p.categoria ?? undefined} />
                        {!p.ativo ? <Badge tone="gray">Inativo</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell numeric>{brl(p.valorPadrao)}</TableCell>
                    <TableCell numeric>{p.duracaoPadraoMin} min</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(p)}
                        >
                          Editar
                        </Button>
                        {p.ativo ? (
                          <DestructiveAction
                            trigger={
                              <Button type="button" size="sm" variant="ghost" disabled={busy}>
                                Desativar
                              </Button>
                            }
                            title={`Desativar “${p.descricao}”`}
                            description="O procedimento deixa de aparecer em novos agendamentos. Atendimentos existentes não são alterados."
                            confirmLabel="Desativar procedimento"
                            cancelLabel="Manter ativo"
                            disabled={busy}
                            action={async () => {
                              await deactivateProcedure(p.id, uuidv4());
                              router.refresh();
                            }}
                            onError={(error) =>
                              toast.error(
                                error instanceof Error ? error.message : 'Erro ao desativar.',
                              )
                            }
                          />
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => reactivate(p)}
                            disabled={busy}
                          >
                            Reativar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
        )}
      </TableWrap>
    </div>
  );
}
