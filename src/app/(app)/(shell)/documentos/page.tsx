import type { Metadata } from 'next';
/**
 * /documentos — feed unificado de documentos clínicos (prescrições + atestados/
 * declarações/exames/encaminhamentos) da clínica. Server component; só leitura.
 * Tenant scope via requireClinicId + RLS; nome do paciente vem do snapshot (R8).
 * Cada item linka para a página autenticada de PDF; o token do Storage não é
 * exposto ao navegador.
 */
import { ExternalLink, FileText, Files, ListFilter, Search } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import {
  listClinicalDocumentFeedPage,
  type ClinicalDocumentKind,
  type ClinicalDocumentType,
} from '@/contexts/clinical/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { pageGate } from '@/lib/auth/page-guard';
import { PageNoAccess } from '@/components/shared/page-no-access';
import { buttonVariants } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCell } from '@/components/ui/entity-cell';
import { Badge } from '@/components/ui/badge';
import { SearchField } from '@/components/ui/filter-bar';
import { LinkSegmented } from '@/components/ui/link-segmented';
import { PageHeader } from '@/components/ui/page-header';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

import { documentosPageHref, parseDocumentosPage, type DocumentosSearchParams } from './pagination';
import { NewClinicalDocumentDrawer } from './new-clinical-document-drawer';
import styles from './documents.module.css';

export const metadata: Metadata = { title: 'Documentos' };

export const dynamic = 'force-dynamic';
/**
 * Tom da etiqueta de tipo no app v5. Receita de controle especial é a única em
 * âmbar: lista controlada, com regra de dispensação própria.
 */
const TIPO_TOM: Record<ClinicalDocumentType, 'blue' | 'amber' | 'gray' | 'navy'> = {
  simples: 'blue',
  controle_especial: 'amber',
  atestado: 'gray',
  exame: 'navy',
  declaracao: 'gray',
  encaminhamento: 'gray',
};

interface DocumentosPageUser {
  isSuperAdmin?: boolean;
  aal?: string | null;
  permissions: readonly string[];
}

/** Descoberta de UI; as Server Actions reaplicam os mesmos gates no backend. */
export function documentosPageCapabilities(user: DocumentosPageUser) {
  const has = (permission: Permission) =>
    user.isSuperAdmin === true ? user.aal === 'aal2' : user.permissions.includes(permission);
  const canSelectPatient = has(PERMISSIONS.VIEW_PATIENT);
  const canCreateProntuario = canSelectPatient && has(PERMISSIONS.CREATE_PRONTUARIO);
  const canCreateDocument = canSelectPatient && has(PERMISSIONS.CREATE_PRESCRIPTION);
  return {
    canCreateProntuario,
    canCreateDocument,
    canOpenLauncher: canCreateProntuario || canCreateDocument,
  };
}

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
  const { clinicId, user } = gate;
  const timeZone = await getClinicTimezone(clinicId);
  const capabilities = documentosPageCapabilities(user);
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
        crumbs={[
          {
            label: (
              <>
                <FileText aria-hidden="true" />
                Documentos
              </>
            ),
          },
        ]}
        search={
          <form id="documentos-busca" role="search">
            {kind ? <input type="hidden" name="tipo" value={kind} /> : null}
            <SearchField
              name="q"
              defaultValue={q ?? ''}
              placeholder="Buscar por paciente"
              aria-label="Buscar documentos por nome do paciente"
              grow={false}
              className="w-full"
            />
          </form>
        }
        actions={
          capabilities.canOpenLauncher ? (
            <NewClinicalDocumentDrawer
              canCreateProntuario={capabilities.canCreateProntuario}
              canCreateDocument={capabilities.canCreateDocument}
            />
          ) : undefined
        }
        title="Documentos emitidos"
        description="Receitas, atestados e outros documentos já emitidos. Para emitir um novo, use o Consultório ou o prontuário."
        controls={
          <>
            <LinkSegmented
              label="Tipo de documento"
              items={[
                { label: 'Todos os tipos', kind: undefined },
                { label: 'Receitas', kind: 'prescription' as const },
                { label: 'Documentos médicos', kind: 'document' as const },
              ].map((option) => ({
                label: option.label,
                href: documentosPageHref(
                  { ...(q ? { q } : {}), ...(option.kind ? { kind: option.kind } : {}) },
                  1,
                ),
                active: kind === option.kind,
              }))}
            />
            <button
              type="submit"
              form="documentos-busca"
              className={buttonVariants({ variant: 'secondary' })}
            >
              <ListFilter aria-hidden="true" className="size-4" />
              Filtrar
            </button>
          </>
        }
      />

      <DataTable
        className={styles.table ?? ''}
        title={
          kind === 'prescription'
            ? 'Receitas'
            : kind === 'document'
              ? 'Documentos médicos'
              : 'Todos os documentos'
        }
        description={`${result.total.toLocaleString('pt-BR')} documento${result.total === 1 ? '' : 's'} · mais recentes primeiro`}
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
                : 'Crie um documento para um paciente ou consulte o histórico da clínica.'
            }
          />
        }
      >
        <TableHeader>
          <TableRow>
            <TableHead>Tipo</TableHead>
            <TableHead>Paciente</TableHead>
            <TableHead>Emitido por</TableHead>
            <TableHead>Emissão</TableHead>
            <TableHead className="w-28" aria-label="Ações" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => (
            <TableRow key={`${d.kind}:${d.id}`}>
              <TableCell>
                <Badge tone={TIPO_TOM[d.type] ?? 'gray'}>{d.label}</Badge>
                {!d.hasPdf ? (
                  <p className="mt-1 text-(length:--fs-xs) text-fg-subtle">PDF pendente</p>
                ) : null}
              </TableCell>
              <TableCell>
                <EntityCell name={d.patientNome} />
              </TableCell>
              <TableCell className="min-w-0 text-fg-muted">
                <span className="block truncate">{d.emitidoPor}</span>
                {d.emitidoPorCrm ? (
                  <span className="mt-0.5 block font-mono text-(length:--fs-xs) tabular-nums text-fg-subtle">
                    {d.emitidoPorCrm}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="font-mono text-fg-muted tabular-nums">
                <span className="block">
                  {new Date(d.createdAt).toLocaleDateString('pt-BR', { timeZone })}
                </span>
                <span className="mt-0.5 block text-(length:--fs-xs) text-fg-subtle">
                  {new Date(d.createdAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone,
                  })}
                </span>
              </TableCell>
              <TableCell>
                <Link
                  href={d.pdfHref}
                  className={buttonVariants({ variant: 'secondary', size: 'sm' })}
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                  {d.hasPdf ? 'Abrir PDF' : 'Gerar PDF'}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
    </>
  );
}
