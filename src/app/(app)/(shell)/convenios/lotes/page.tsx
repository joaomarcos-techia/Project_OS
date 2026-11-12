import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { BATCH_STATUS_LABELS, listBatchCandidates, listBatches } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { NewBatchForm } from '../_lib/batch-ui';
import { BatchStatusBadge } from '../_lib/status';

export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function LotesPage({ searchParams }: { searchParams: Search }) {
  const access = await conveniosAccess('Lotes');
  if (!access.ok) return access.view;
  const sp = await searchParams;
  const status = typeof sp.status === 'string' && BATCH_STATUS_LABELS[sp.status] ? sp.status : undefined;
  const [batches, candidates] = await Promise.all([
    listBatches(access.clinicId, status ? { status } : {}),
    access.canManage ? listBatchCandidates(access.clinicId) : Promise.resolve([]),
  ]);

  return (
    <>
      <ConveniosHeader commercial={access.commercial} title="Lotes" description="Guias aprovadas agrupadas por operadora, com o XML oficial validado." crumbs={[{ label: 'Lotes' }]} />
      {access.canManage ? (
        <PanelCard title="Montar lote" regionLabel="Montar lote" className="mb-(--sp-4)">
          <NewBatchForm candidates={candidates} />
        </PanelCard>
      ) : null}
      {batches.length === 0 ? (
        <EmptyState title="Nenhum lote ainda" description="Monte o primeiro lote com as guias aprovadas de uma operadora." />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lote</TableHead>
                <TableHead>Operadora</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead className="text-right">Guias</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Protocolo</TableHead>
                <TableHead>Enviado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>
                    <Link href={`/convenios/lotes/${b.id}`} className="font-medium hover:underline">
                      {b.number}
                    </Link>
                  </TableCell>
                  <TableCell>{b.insurerName}</TableCell>
                  <TableCell>
                    <BatchStatusBadge status={b.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{b.guideCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(b.totalValueCents)}</TableCell>
                  <TableCell>{b.protocolNumber ?? '—'}</TableCell>
                  <TableCell>{shortDate(b.sentOn)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
