/**
 * /documentos — feed unificado de documentos clínicos (prescrições + atestados/
 * declarações/exames/encaminhamentos) da clínica. Server component; só leitura.
 * Tenant scope via requireClinicId + RLS; nome do paciente vem do snapshot (R8).
 * Cada item linka para a página de PDF existente (signed URL fresca lá — R4).
 */
import Link from 'next/link';

import { listClinicalDocumentFeed } from '@/contexts/clinical/queries';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { Icon } from '@/components/painel/icons';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';

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
    <div className="screen">
      <PageHeader
        breadcrumb={
          <>
            Clínico <span className="sep">›</span> <b>Documentos</b>
          </>
        }
        title="Documentos"
        description="Receitas e documentos médicos emitidos na clínica."
      />

      <form className="toolbar">
        <div className="input-wrap tb-grow" style={{ maxWidth: 360 }}>
          <Icon name="search" size={16} />
          <input
            className="input"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Buscar por paciente…"
            aria-label="Buscar documentos por nome do paciente"
          />
        </div>
        <select
          className="input"
          name="tipo"
          defaultValue={kind ?? ''}
          aria-label="Filtrar por tipo de documento"
          style={{ maxWidth: 180 }}
        >
          <option value="">Todos os tipos</option>
          <option value="prescription">Receitas</option>
          <option value="document">Documentos médicos</option>
        </select>
        <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          Filtrar
        </button>
      </form>

      {items.length === 0 ? (
        <EmptyState
          icon={<Icon name="docs" size={22} />}
          title={filtrando ? 'Nenhum documento encontrado' : 'Nenhum documento ainda'}
          description={
            filtrando
              ? 'Ajuste a busca ou o filtro de tipo.'
              : 'Receitas e documentos emitidos no Consultório aparecem aqui.'
          }
        />
      ) : (
        <div className="cardblock">
          <div className="listrows">
            {items.map((d) => (
              <div key={`${d.kind}:${d.id}`} className="listrow">
                <div className="lr-main">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={d.kind === 'prescription' ? 'blue' : 'teal'}>{d.label}</Badge>
                    <span className="font-medium">{d.patientNome}</span>
                    <span className="text-sm text-fg-muted">
                      {new Date(d.createdAt).toLocaleString('pt-BR')}
                    </span>
                    {!d.hasPdf ? (
                      <span className="text-xs text-fg-subtle">PDF pendente</span>
                    ) : null}
                  </div>
                </div>
                <div className="lr-end">
                  <Link
                    href={d.pdfHref}
                    className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                  >
                    {d.hasPdf ? 'Abrir' : 'Gerar PDF'}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
