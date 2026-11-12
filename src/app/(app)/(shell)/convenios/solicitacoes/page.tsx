import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { getSadtRequestFormData, listSadtRequests } from '@/contexts/health-insurance/queries';

import { ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { NewSadtRequestForm } from '../_lib/sadt-ui';
import { SADT_STATUS, SadtStatusBadge } from '../_lib/status';

export const dynamic = 'force-dynamic';


type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SolicitacoesPage({ searchParams }: { searchParams: Search }) {
  const access = await conveniosAccess('Solicitações SP/SADT');
  if (!access.ok) return access.view;
  const sp = await searchParams;
  const status = typeof sp.status === 'string' && SADT_STATUS[sp.status] ? sp.status : undefined;
  const [rows, form] = await Promise.all([
    listSadtRequests(access.clinicId, status ? { status } : {}),
    access.canManage ? getSadtRequestFormData(access.clinicId) : Promise.resolve(null),
  ]);

  return (
    <>
      <ConveniosHeader
        title="Solicitações SP/SADT"
        description="Pedido do profissional, autorização da operadora e as sessões executadas que viram guia."
        crumbs={[{ label: 'Solicitações' }]}
      />
      {form ? (
        <PanelCard title="Nova solicitação" regionLabel="Nova solicitação" className="mb-(--sp-4)">
          <NewSadtRequestForm memberships={form.memberships} professionals={form.professionals} procedures={form.procedures} />
        </PanelCard>
      ) : null}
      <nav aria-label="Filtrar por situação" className="mb-(--sp-3) flex flex-wrap gap-(--sp-2) text-(length:--fs-sm)">
        <Link href="/convenios/solicitacoes" className={!status ? 'font-medium underline' : 'hover:underline'}>
          Todas
        </Link>
        {['draft', 'awaiting_authorization', 'authorized', 'partially_authorized', 'ready', 'denied'].map((k) => (
          <Link key={k} href={`/convenios/solicitacoes?status=${k}`} className={status === k ? 'font-medium underline' : 'hover:underline'}>
            {SADT_STATUS[k]!.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma solicitação"
          description="Registre o pedido de sessões ou exames; com a autorização da operadora, cada sessão realizada entra na guia SP/SADT."
        />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Paciente</TableHead>
                <TableHead>Operadora</TableHead>
                <TableHead>Solicitante</TableHead>
                <TableHead>Data</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Executadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link href={`/convenios/solicitacoes/${r.id}`} className="font-medium hover:underline">
                        {r.requestNumber ?? 'rascunho'}
                      </Link>
                    </TableCell>
                    <TableCell>{r.patientName}</TableCell>
                    <TableCell>{r.insurerName}</TableCell>
                    <TableCell>{r.requesterName}</TableCell>
                    <TableCell>{shortDate(r.requestedOn)}</TableCell>
                    <TableCell>
                      <SadtStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.executed} de {r.requested}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
