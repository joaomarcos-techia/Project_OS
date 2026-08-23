/**
 * /documentos — feed unificado de documentos clínicos (prescrições + atestados/
 * declarações/exames/encaminhamentos) da clínica. Server component; só leitura.
 * Tenant scope via requireClinicId + RLS; nome do paciente vem do snapshot (R8).
 * Cada item linka para a página de PDF existente (signed URL fresca lá — R4).
 */
import { FileText, Files, Pill, Search } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  listClinicalDocumentFeedPage,
  type ClinicalDocumentKind,
} from '@/contexts/clinical/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCell, EntityIcon } from '@/components/ui/entity-cell';
import { FilterBar, SearchField } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { StatsInline } from '@/components/ui/stats-inline';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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

  const filtrando = Boolean(q || kind);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Clínico' }, { label: 'Documentos' }]}
        title="Documentos"
        description="Receitas e documentos médicos emitidos na clínica."
      />

      <StatsInline
        className="mb-(--sp-3)"
        items={[
          {
            label: `${result.total.toLocaleString('pt-BR')} documento${
              result.total === 1 ? '' : 's'
            }`,
          },
          ...(filtrando ? [{ label: 'filtro aplicado', tone: 'attention' as const }] : []),
        ]}
      />

      <FilterBar>
        <form className="flex min-w-0 flex-1 flex-wrap items-center gap-(--sp-2)" role="search">
          <SearchField
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por paciente…"
            aria-label="Buscar documentos por nome do paciente"
            className="sm:max-w-90"
          />
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
      </FilterBar>

      <DataTable
        total={items.length === 0 ? 0 : result.total}
        page={page}
        pageCount={totalPages}
        pageSize={result.pageSize}
        unit={{ one: 'documento', many: 'documentos' }}
        hrefFor={(targetPage) => documentosPageHref(filters, targetPage)}
        empty={
          <EmptyState
            icon={filtrando ? <Search /> : <Files />}
            title={filtrando ? 'Nenhum documento encontrado' : 'Nenhum documento ainda'}
            description={
              filtrando
                ? 'Ajuste a busca ou o filtro de tipo.'
                : 'Receitas e documentos emitidos no Consultório aparecem aqui.'
            }
          />
        }
      >
        <TableHeader>
          <TableRow>
            <TableHead>Documento</TableHead>
            <TableHead>Paciente</TableHead>
            <TableHead>Emitido em</TableHead>
            <TableHead className="w-28" aria-label="Ações" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => (
            <TableRow key={`${d.kind}:${d.id}`}>
              <TableCell>
                {/* Tipo saiu do badge e virou identidade da linha, como na
                    referência: o badge repetia a mesma cor em toda linha e não
                    distinguia nada — o ícone + rótulo carrega melhor. */}
                <EntityCell
                  name={d.label}
                  leading={
                    <EntityIcon>{d.kind === 'prescription' ? <Pill /> : <FileText />}</EntityIcon>
                  }
                  sub={d.hasPdf ? undefined : 'PDF pendente'}
                />
              </TableCell>
              <TableCell>
                <EntityCell name={d.patientNome} />
              </TableCell>
              <TableCell className="text-fg-muted tabular-nums">
                {new Date(d.createdAt).toLocaleString('pt-BR')}
              </TableCell>
              <TableCell>
                <Link href={d.pdfHref} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  {d.hasPdf ? 'Abrir' : 'Gerar PDF'}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
    </>
  );
}
