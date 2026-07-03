/**
 * /documentos — feed unificado de documentos clínicos (prescrições + atestados/
 * declarações/exames/encaminhamentos) da clínica. Server component; só leitura.
 * Tenant scope via requireClinicId + RLS; nome do paciente vem do snapshot (R8).
 * Cada item linka para a página de PDF existente (signed URL fresca lá — R4).
 */
import { Files, Search } from 'lucide-react';
import Link from 'next/link';

import { listClinicalDocumentFeed } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { fieldControlClassName } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
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

export const dynamic = 'force-dynamic';

export default async function DocumentosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; tipo?: string }>;
}) {
  await requireUser();
  const clinicId = await requireClinicId();
  const { q, tipo } = await searchParams;
  const kind = tipo === 'prescription' || tipo === 'document' ? tipo : undefined;

  const items = await listClinicalDocumentFeed(clinicId, {
    ...(q ? { search: q } : {}),
    ...(kind ? { kind } : {}),
    limit: 100,
  });

  const filtrando = Boolean(q || kind);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Clínico' }, { label: 'Documentos' }]}
        title="Documentos"
        description="Receitas e documentos médicos emitidos na clínica."
      />

      <TableWrap>
        <TableToolbar>
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="relative block min-w-52 flex-1 sm:max-w-90">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
              />
              <input
                name="q"
                defaultValue={q ?? ''}
                placeholder="Buscar por paciente…"
                aria-label="Buscar documentos por nome do paciente"
                className={cn(fieldControlClassName, 'pl-9')}
              />
            </span>
            <Select
              name="tipo"
              defaultValue={kind ?? ''}
              aria-label="Filtrar por tipo de documento"
              className="max-w-48"
            >
              <option value="">Todos os tipos</option>
              <option value="prescription">Receitas</option>
              <option value="document">Documentos médicos</option>
            </Select>
            <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Filtrar
            </button>
          </form>
        </TableToolbar>
        {items.length === 0 ? (
          <EmptyState
            icon={<Files />}
            title={filtrando ? 'Nenhum documento encontrado' : 'Nenhum documento ainda'}
            description={
              filtrando
                ? 'Ajuste a busca ou o filtro de tipo.'
                : 'Receitas e documentos emitidos no Consultório aparecem aqui.'
            }
          />
        ) : (
          <>
            <TableScroll>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Emitido em</TableHead>
                    <TableHead className="w-28" aria-label="Ações" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((d) => (
                    <TableRow key={`${d.kind}:${d.id}`}>
                      <TableCell>
                        <Badge tone={d.kind === 'prescription' ? 'blue' : 'teal'}>{d.label}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{d.patientNome}</TableCell>
                      <TableCell className="text-fg-muted">
                        {new Date(d.createdAt).toLocaleString('pt-BR')}
                        {!d.hasPdf ? (
                          <span className="ml-2 text-(length:--fs-xs) text-fg-subtle">
                            PDF pendente
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={d.pdfHref}
                          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                        >
                          {d.hasPdf ? 'Abrir' : 'Gerar PDF'}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
            <TableFoot>
              <TableFootInfo>
                {items.length} documento{items.length === 1 ? '' : 's'}
                {items.length === 100 ? ' (mostrando os 100 mais recentes)' : ''}
              </TableFootInfo>
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
