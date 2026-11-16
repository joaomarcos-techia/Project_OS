import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { listAuthorizations, type AuthorizationRow } from '@/contexts/health-insurance/queries';

import { ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { authorizationAlertText } from '../_lib/constants';
import { AuthorizationStatusBadge } from '../_lib/status';

export const metadata: Metadata = { title: 'Autorizações da operadora' };

export const dynamic = 'force-dynamic';

const WAITING = ['requested', 'pending_operator'];
const GRANTED = ['authorized', 'partially_authorized'];

const typeLabel = (t: AuthorizationRow['guideType']) => (t === 'sp_sadt' ? 'SP/SADT' : 'Consulta');

function AuthLink({ r }: { r: AuthorizationRow }) {
  return (
    <Link href={`/convenios/autorizacoes/${r.id}`} className="hover:underline">
      {r.patientName || 'Paciente'} · {typeLabel(r.guideType)}
    </Link>
  );
}

/**
 * P6.3 — fila das autorizações da operadora: o que vence ou acaba (alertas da P6.6, calculados na
 * leitura até o cron da P12.6 existir), o que aguarda a operadora, o que está em uso e o que encerrou.
 */
export default async function AutorizacoesPage() {
  const access = await conveniosAccess('Autorizações da operadora');
  if (!access.ok) return access.view;
  const { rows, alerts } = await listAuthorizations(access.clinicId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const waiting = rows.filter((r) => WAITING.includes(r.shownState));
  const granted = rows.filter((r) => GRANTED.includes(r.shownState));
  const closed = rows.filter((r) => !WAITING.includes(r.shownState) && !GRANTED.includes(r.shownState)).slice(0, 50);

  return (
    <>
      <ConveniosHeader
        commercial={access.commercial}
        title="Autorizações da operadora"
        description="Pedidos aguardando a operadora, senhas perto do vencimento e sessões autorizadas acabando."
        crumbs={[{ label: 'Autorizações' }]}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhuma autorização"
          description="A autorização da SP/SADT nasce na solicitação; a da Guia de Consulta, quando o contrato da operadora exige."
        />
      ) : (
        <>
          <PanelCard title="Vencendo ou acabando" regionLabel="Autorizações vencendo ou acabando" className="mb-(--sp-4)">
            {alerts.length === 0 ? (
              <p className="text-(length:--fs-sm) text-fg-muted">
                Nenhuma senha vence nos próximos dias e nenhuma autorização está no fim.
              </p>
            ) : (
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Autorização</TableHead>
                      <TableHead>Operadora</TableHead>
                      <TableHead>Alerta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {alerts.map((a) => {
                      const r = byId.get(a.authorizationId);
                      if (!r) return null;
                      return (
                        <TableRow key={`${a.kind}-${a.authorizationId}`}>
                          <TableCell>
                            <AuthLink r={r} />
                          </TableCell>
                          <TableCell>{r.insurerName}</TableCell>
                          <TableCell className="text-warning-700">{authorizationAlertText(a)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
          </PanelCard>

          <PanelCard title="Aguardando a operadora" regionLabel="Autorizações aguardando a operadora" className="mb-(--sp-4)">
            {waiting.length === 0 ? (
              <p className="text-(length:--fs-sm) text-fg-muted">Nenhum pedido aguardando resposta.</p>
            ) : (
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Autorização</TableHead>
                      <TableHead>Operadora</TableHead>
                      <TableHead>Pedida em</TableHead>
                      <TableHead>Próximo passo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {waiting.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <AuthLink r={r} />
                        </TableCell>
                        <TableCell>{r.insurerName}</TableCell>
                        <TableCell>{shortDate(r.requestedOn)}</TableCell>
                        <TableCell>
                          {r.guideType === 'sp_sadt' && r.sadtRequestId ? (
                            <Link href={`/convenios/solicitacoes/${r.sadtRequestId}`} className="hover:underline">
                              Responder pela solicitação {r.sadtRequestNumber ?? ''}
                            </Link>
                          ) : (
                            <Link href={`/convenios/autorizacoes/${r.id}`} className="hover:underline">
                              Registrar a resposta
                            </Link>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
          </PanelCard>

          <PanelCard title="Concedidas" regionLabel="Autorizações concedidas" className="mb-(--sp-4)">
            {granted.length === 0 ? (
              <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma autorização em uso.</p>
            ) : (
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Autorização</TableHead>
                      <TableHead>Operadora</TableHead>
                      <TableHead>Situação</TableHead>
                      <TableHead>Validade da senha</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {granted.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <AuthLink r={r} />
                        </TableCell>
                        <TableCell>{r.insurerName}</TableCell>
                        <TableCell>
                          <AuthorizationStatusBadge status={r.shownState} />
                        </TableCell>
                        <TableCell>{r.passwordValidUntil ? shortDate(r.passwordValidUntil) : 'não informada'}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.remaining} de {r.authorizedTotal}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            )}
          </PanelCard>

          {closed.length > 0 ? (
            <PanelCard title="Encerradas" regionLabel="Autorizações encerradas">
              <TableWrap>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Autorização</TableHead>
                      <TableHead>Operadora</TableHead>
                      <TableHead>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {closed.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <AuthLink r={r} />
                        </TableCell>
                        <TableCell>{r.insurerName}</TableCell>
                        <TableCell>
                          <AuthorizationStatusBadge status={r.shownState} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrap>
            </PanelCard>
          ) : null}
        </>
      )}
    </>
  );
}
