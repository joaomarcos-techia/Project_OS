import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import {
  GUIDE_PAGE_SIZE,
  GUIDE_STATUS_LABELS,
  ISSUE_OWNER_LABELS,
  listGuides,
  listInsurers,
} from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { GuideStatusBadge } from '../_lib/status';

export const dynamic = 'force-dynamic';

const GROUPS: Array<[string, string]> = [
  ['', 'Todas'],
  ['pendentes', 'Pendentes (falta dado ou conferir)'],
  ['conferidas', 'Conferidas'],
  ['prontas', 'Aprovadas'],
  ['faturadas', 'Faturadas (em lote ou na operadora)'],
  ['desfecho', 'Pagas, parciais ou glosadas'],
  ['encerradas', 'Conciliadas, canceladas ou substituídas'],
  ...Object.entries(GUIDE_STATUS_LABELS).map(([k, v]) => [k, `Só: ${v}`] as [string, string]),
];

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function GuiasPage({ searchParams }: { searchParams: Search }) {
  const access = await conveniosAccess('Guias');
  if (!access.ok) return access.view;
  const sp = await searchParams;
  const filters = {
    status: one(sp.status),
    insurerId: one(sp.insurerId),
    owner: one(sp.owner),
    q: one(sp.q),
    page: Number(one(sp.page) ?? 1) || 1,
  };
  const uuidOk = (v?: string) => !v || /^[0-9a-f-]{36}$/u.test(v);
  if (!uuidOk(filters.insurerId)) filters.insurerId = undefined;
  if (filters.owner && !ISSUE_OWNER_LABELS[filters.owner]) filters.owner = undefined;
  const [{ rows, total }, insurers] = await Promise.all([listGuides(access.clinicId, filters), listInsurers(access.clinicId)]);
  const pages = Math.max(1, Math.ceil(total / GUIDE_PAGE_SIZE));
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filters, page: String(p) })) if (v) q.set(k, String(v));
    return `/convenios/guias?${q.toString()}`;
  };

  return (
    <>
      <ConveniosHeader title="Guias" description="Guias de convênio da clínica: o que falta, quem resolve e em que etapa estão." crumbs={[{ label: 'Guias' }]} />
      <form method="get" className="mb-(--sp-4) grid gap-(--sp-2) md:grid-cols-[repeat(4,minmax(0,1fr))_auto]" aria-label="Filtrar guias">
        <Select name="status" defaultValue={filters.status ?? ''} aria-label="Etapa">
          {GROUPS.map(([value, label]) => (
            <option key={`${value}-${label}`} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Select name="insurerId" defaultValue={filters.insurerId ?? ''} aria-label="Operadora">
          <option value="">Todas as operadoras</option>
          {insurers.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Select name="owner" defaultValue={filters.owner ?? ''} aria-label="Responsável pela pendência">
          <option value="">Qualquer responsável</option>
          {Object.entries(ISSUE_OWNER_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              Pendência: {v}
            </option>
          ))}
        </Select>
        <Input name="q" defaultValue={filters.q ?? ''} placeholder="Número da guia ou paciente" aria-label="Buscar" />
        <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
          Filtrar
        </button>
      </form>

      {rows.length === 0 ? (
        <EmptyState title="Nenhuma guia com esses filtros" description="As guias nascem do atendimento concluído por convênio." />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Guia</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Operadora</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>Pendências</TableHead>
                <TableHead>Lote</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Atualizada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => {
                const owners = [...new Set(g.issues.map((i) => i.owner))];
                return (
                  <TableRow key={g.id}>
                    <TableCell>
                      <Link href={`/convenios/guias/${g.id}`} className="font-medium hover:underline">
                        {g.guideType === 'sp_sadt' ? 'SP/SADT' : 'Consulta'} {g.number}
                      </Link>
                    </TableCell>
                    <TableCell>{g.patientName ?? '—'}</TableCell>
                    <TableCell>{g.insurerName}</TableCell>
                    <TableCell>
                      <GuideStatusBadge status={g.status} />
                    </TableCell>
                    <TableCell>
                      {g.issues.length === 0 ? (
                        <span className="text-fg-muted">—</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {owners.map((o) => (
                            <Badge key={o} tone="amber">
                              {g.issues.filter((i) => i.owner === o).length} · {ISSUE_OWNER_LABELS[o] ?? o}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{g.batchNumber ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(g.totalValueCents)}</TableCell>
                    <TableCell>{shortDate(g.updatedAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableWrap>
      )}
      {pages > 1 ? (
        <nav aria-label="Páginas" className="mt-(--sp-3) flex items-center justify-between text-(length:--fs-sm)">
          <span className="text-fg-muted">
            {total} guias · página {filters.page} de {pages}
          </span>
          <span className="flex gap-2">
            {filters.page > 1 ? (
              <Link href={pageHref(filters.page - 1)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Anterior
              </Link>
            ) : null}
            {filters.page < pages ? (
              <Link href={pageHref(filters.page + 1)} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                Próxima
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
