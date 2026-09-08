import { ClipboardList, FileText, History } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Separator } from '@/components/ui/separator';
import type { ClinicalDocumentFeedItem } from '@/contexts/clinical/queries';
import type { ProntuarioSummary } from '@/contexts/clinical/types';
import { cn } from '@/lib/ui/cn';

import { NovoProntuarioButton } from './prontuarios/novo-prontuario-button';
import { DocumentDrawer } from '../../consultorio/document-drawer';
import { PrescriptionDrawer } from '../../consultorio/prescription-drawer';

type ActivityItem = {
  key: string;
  kind: 'record' | 'document';
  title: string;
  detail: string | null;
  timestamp: string;
  href: string;
  actionLabel: string;
  tone: 'blue' | 'green' | 'amber' | 'teal';
};

function activityItems(
  patientId: string,
  records: ProntuarioSummary[],
  documents: ClinicalDocumentFeedItem[],
): ActivityItem[] {
  const recordItems: ActivityItem[] = records.map((record) => ({
    key: `record:${record.id}`,
    kind: 'record',
    title: record.status === 'assinado' ? 'Prontuário assinado' : 'Prontuário em rascunho',
    detail: record.needsReturn
      ? `Retorno indicado${record.returnDays ? ` em ${record.returnDays} dias` : ''}`
      : null,
    timestamp:
      record.status === 'assinado' ? (record.signedAt ?? record.updatedAt) : record.updatedAt,
    href: `/pacientes/${patientId}/prontuarios/${record.id}`,
    actionLabel: record.status === 'assinado' ? 'Ver' : 'Abrir',
    tone: record.status === 'assinado' ? 'green' : 'amber',
  }));
  const documentItems: ActivityItem[] = documents.map((document) => ({
    key: `${document.kind}:${document.id}`,
    kind: 'document',
    title: document.label,
    detail: document.hasPdf ? 'PDF disponível' : 'PDF pendente',
    timestamp: document.createdAt,
    href: document.pdfHref,
    actionLabel: document.hasPdf ? 'Abrir' : 'Gerar PDF',
    tone: document.kind === 'prescription' ? 'blue' : 'teal',
  }));

  return [...recordItems, ...documentItems]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, 8);
}

export function PatientClinicalActivity({
  patientId,
  records,
  documents,
  canViewRecords,
  canViewDocuments,
  canCreateRecord,
  canCreateDocuments,
  initialCreate,
  deceased,
}: {
  patientId: string;
  records: ProntuarioSummary[];
  documents: ClinicalDocumentFeedItem[];
  canViewRecords: boolean;
  canViewDocuments: boolean;
  canCreateRecord: boolean;
  canCreateDocuments: boolean;
  initialCreate: 'prescricao' | 'documento' | null;
  deceased: boolean;
}) {
  const items = activityItems(
    patientId,
    canViewRecords ? records : [],
    canViewDocuments ? documents : [],
  );

  return (
    <Card data-patient-section="clinical-activity" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-(--card-pad) py-4">
        <div className="min-w-0">
          <h2 className="text-balance text-(length:--fs-h4) font-semibold">Atividade clínica</h2>
          <p className="mt-1 text-pretty text-(length:--fs-xs) text-fg-muted">
            Prontuários e documentos existentes, do mais recente para o mais antigo.
          </p>
        </div>
        {!deceased ? (
          <div className="flex flex-wrap items-center gap-2">
            {canViewRecords && canCreateRecord ? (
              <NovoProntuarioButton patientId={patientId} />
            ) : null}
            {canCreateDocuments ? (
              <>
                <PrescriptionDrawer
                  patientId={patientId}
                  prontuarioId={null}
                  defaultOpen={initialCreate === 'prescricao'}
                />
                <DocumentDrawer patientId={patientId} defaultOpen={initialCreate === 'documento'} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <Separator />

      {items.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Sem atividade clínica"
          description="Prontuários e documentos autorizados aparecerão aqui."
          variant="compact"
        />
      ) : (
        <ol aria-label="Atividade clínica recente" className="px-(--card-pad)">
          {items.map((item) => (
            <li
              key={item.key}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-border/70 py-3 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className="grid size-8 place-items-center rounded-(--r-sm) bg-surface-inset text-fg-muted"
              >
                {item.kind === 'record' ? (
                  <ClipboardList className="size-4" />
                ) : (
                  <FileText className="size-4" />
                )}
              </span>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <p className="truncate text-(length:--fs-sm) font-medium text-fg">{item.title}</p>
                  <Badge tone={item.tone}>
                    {item.kind === 'record' ? 'Prontuário' : 'Documento'}
                  </Badge>
                </div>
                <p className="mt-0.5 text-(length:--fs-xs) text-fg-subtle">
                  <time dateTime={item.timestamp} className="tabular-nums">
                    {new Date(item.timestamp).toLocaleString('pt-BR')}
                  </time>
                  {item.detail ? ` · ${item.detail}` : ''}
                </p>
              </div>
              <Link
                href={item.href}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'min-h-(--hit-target)',
                )}
              >
                {item.actionLabel}
              </Link>
            </li>
          ))}
        </ol>
      )}

      {canViewRecords || canViewDocuments ? (
        <>
          <Separator />
          <nav
            aria-label="Atalhos do histórico do paciente"
            className="flex flex-wrap items-center gap-1 px-(--card-pad) py-2"
          >
            {canViewRecords ? (
              <Link
                href={`/pacientes/${patientId}?tab=prontuarios`}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'min-h-(--hit-target)',
                )}
              >
                Ver prontuários
              </Link>
            ) : null}
            {canViewDocuments ? (
              <Link
                href="/documentos"
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'min-h-(--hit-target)',
                )}
              >
                Ver documentos
              </Link>
            ) : null}
          </nav>
        </>
      ) : null}
    </Card>
  );
}
