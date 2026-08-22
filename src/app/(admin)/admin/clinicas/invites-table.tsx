'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TableToolbar } from '@/components/ui/table-toolbar';
import { cn } from '@/lib/ui/cn';

import type { InviteListItem } from '../_lib/repositories/invites.repo';
import { CancelInviteButton } from './cancel-invite-button';

const PER_PAGE = 6;

function inviteTone(s: string): 'blue' | 'amber' | 'green' | 'gray' | 'red' {
  if (s === 'completed') return 'green';
  if (s === 'started') return 'amber';
  if (s === 'cancelled') return 'red';
  if (s === 'expired') return 'gray';
  return 'blue'; // pending
}

const pagerBtn = cn(
  'inline-flex h-(--hit-target) min-w-(--hit-target) items-center justify-center rounded-(--r-sm) px-2 text-(length:--fs-sm) tabular-nums',
  'text-fg-muted transition-[background-color,color] duration-(--dur-fast) hover:bg-surface-hover hover:text-fg',
  'disabled:pointer-events-none disabled:opacity-40',
);

/**
 * Convites do onboarding — paginação LOCAL (6/página, sem navegação): os dados
 * já estão todos no cliente; virar a página é instantâneo.
 */
export function InvitesTable({
  invites,
  formatDateTime,
}: {
  invites: InviteListItem[];
  /** datas já formatadas no servidor (tz estável) — id → {criado, expira}. */
  formatDateTime: Record<string, { criado: string; expira: string }>;
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(invites.length / PER_PAGE));
  const slice = invites.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <TableWrap className="mt-(--sp-5)">
      <TableToolbar>
        <h4 className="text-(length:--fs-sm) font-semibold">Convites</h4>
        <span className="text-(length:--fs-xs) text-fg-subtle">
          {invites.length} · onboarding via convite mágico
        </span>
      </TableToolbar>
      {invites.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-subtle">
          Nenhum convite. Use <b>Nova Clínica</b> para gerar um link de onboarding.
        </p>
      ) : (
        <>
          <TableScroll>
            <Table className="min-w-180">
              <TableHeader>
                <TableRow>
                  <TableHead>Gestor / Clínica</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Criado</TableHead>
                  <TableHead>Expira</TableHead>
                  <TableHead className="w-24" aria-label="Ações" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {slice.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">
                      {i.clinicNome ?? i.email ?? <span className="text-fg-subtle">—</span>}
                    </TableCell>
                    <TableCell>
                      {i.planCode ? (
                        <Badge tone="blue">{i.planCode}</Badge>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge tone={inviteTone(i.status)}>{i.status}</Badge>
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {formatDateTime[i.id]?.criado ?? '—'}
                    </TableCell>
                    <TableCell className="text-fg-muted">
                      {formatDateTime[i.id]?.expira ?? '—'}
                    </TableCell>
                    <TableCell>
                      {i.status === 'pending' || i.status === 'started' ? (
                        <CancelInviteButton id={i.id} />
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScroll>
          <TableFoot>
            <TableFootInfo>
              Página {page} de {pages}
            </TableFootInfo>
            {pages > 1 ? (
              <nav aria-label="Páginas de convites" className="inline-flex gap-0.75">
                <button
                  type="button"
                  aria-label="Página anterior"
                  className={pagerBtn}
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-4" />
                </button>
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-current={p === page ? 'page' : undefined}
                    className={cn(
                      pagerBtn,
                      p === page &&
                        'bg-primary text-on-primary hover:bg-primary hover:text-on-primary',
                    )}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label="Próxima página"
                  className={pagerBtn}
                  disabled={page >= pages}
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                >
                  <ChevronRight className="size-4" />
                </button>
              </nav>
            ) : null}
          </TableFoot>
        </>
      )}
    </TableWrap>
  );
}
