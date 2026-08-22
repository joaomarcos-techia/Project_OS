/**
 * /documentos — feed unificado de documentos clínicos (prescrições + atestados/
 * declarações/exames/encaminhamentos) da clínica. Server component; só leitura.
 * Tenant scope via requireClinicId + RLS; nome do paciente vem do snapshot (R8).
 * Cada item linka para a página de PDF existente (signed URL fresca lá — R4).
 */
import { Files, Search } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  listClinicalDocumentFeedPage,
  type ClinicalDocumentKind,
} from '@/contexts/clinical/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';
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
import { TablePager } from '@/components/ui/table-pager';
import { cn } from '@/lib/ui/cn';

import { documentosPageHref, parseDocumentosPage, type DocumentosSearchParams } from './pagination';

export const dynamic = 'force-dynamic';

export default async function DocumentosPage({
  searchParams,
}: {
  searchParams: Promise<DocumentosSearchParams>;
}) {
  // AUTHZ-003 — o feed mistura DOIS tipos, e o gate segue o tipo do recurso,
  // não um OR generoso. Ambos os tipos são "família prescrição" pela decisão do
  // próprio produto: `createMedicalDocument()` reusa `create:prescription`
  // (comentado como "reuso documentado" em clinical/actions.ts). A leitura usa a
  // contraparte `view:prescription`. Prontuário é OUTRO recurso, com
  // `view:prontuario` próprio — e por isso NÃO abre esta tela.
  const gate = await pageGate([PERMISSIONS.VIEW_PRESCRIPTION]);
  if (!gate.allowed) {
    return (
      <PageNoAccess
        crumbs={[{ label: 'Clínico' }, { label: 'Documentos' }]}
        title="Documentos"
        description="Seu perfil não tem permissão para ver receitas e documentos médicos. Fale com um gestor se precisar de acesso."
      />
    );
  }
  const { clinicId } = gate;
  const { q: rawSearch, tipo, page: rawPage } = await searchParams;
  const q = rawSearch?.trim().slice(0, 64) || undefined;
  const kind: ClinicalDocumentKind | undefined =
    tipo === 'prescription' || tipo === 'document' ? tipo : undefined;
  const page = parseDocumentosPage(rawPage);
  const filters = {
    ...(q ? { q } : {}),
    ...(kind ? { kind } : {}),
  };

  const result = await listClinicalDocumentFeedPage(clinicId, {
    ...(q ? { search: q } : {}),
    ...(kind ? { kind } : {}),
    page,
  });
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  if (page > totalPages) {
    redirect(documentosPageHref(filters, totalPages));
  }
  const items = result.items;
  const firstItem = (page - 1) * result.pageSize + 1;
  const lastItem = Math.min(page * result.pageSize, result.total);

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
          <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" role="search">
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
                      <TableCell className="text-fg-muted tabular-nums">
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
              <TableFootInfo className="tabular-nums">
                Página {page} de {totalPages} · {firstItem}–{lastItem} de {result.total} documento
                {result.total === 1 ? '' : 's'}
              </TableFootInfo>
              <TablePager
                page={page}
                pageCount={totalPages}
                hrefFor={(targetPage) => documentosPageHref(filters, targetPage)}
              />
            </TableFoot>
          </>
        )}
      </TableWrap>
    </>
  );
}
