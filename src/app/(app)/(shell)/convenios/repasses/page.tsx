import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { listInsurancePayouts } from '@/contexts/health-insurance/queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../_lib/access';
import { ELIGIBILITY_LABELS } from '../_lib/constants';
import { PayoutActions, PayoutPolicyForm } from '../_lib/payout-ui';
import { guideLabel } from '../_lib/guide-label';

export const metadata: Metadata = { title: 'Repasses de convênio' };

export const dynamic = 'force-dynamic';

const DECISIONS: Record<string, string> = {
  FIXED_RULE_PARTIAL_GLOSS: 'regra fixa com glosa parcial: decida por ajuste',
  FIXED_RULE_FULL_GLOSS: 'regra fixa com glosa total: decida por ajuste',
  NO_LIVE_GUIDE: 'sem guia em vigor',
  CANCELLED: 'cancelado',
};

export default async function RepassesPage() {
  const access = await conveniosAccess('Repasses de convênio');
  if (!access.ok) return access.view;
  const { rows, eligibility } = await listInsurancePayouts(access.clinicId);
  const byPro = new Map<string, { name: string; forecast: number; eligible: number; authorized: number; settled: number; due: number }>();
  for (const r of rows) {
    const t = byPro.get(r.professionalId) ?? { name: r.professionalName, forecast: 0, eligible: 0, authorized: 0, settled: 0, due: 0 };
    t.forecast += r.forecastCents;
    t.eligible += r.eligibleCents ?? 0;
    t.authorized += r.authorizedCents + r.adjustmentsCents;
    t.settled += r.settledCents;
    t.due += r.dueCents;
    byPro.set(r.professionalId, t);
  }

  return (
    <>
      <ConveniosHeader commercial={access.commercial}
        title="Repasses de convênio"
        description="Quanto cada profissional tem a receber pelos atendimentos de convênio, conforme a regra de repasse dele e o que a operadora pagou."
        crumbs={[{ label: 'Repasses' }]}
      />
      <PanelCard title="Política da clínica" regionLabel="Política de repasse" className="mb-(--sp-4)">
        <p className="mb-(--sp-2) text-(length:--fs-sm)">Atual: {ELIGIBILITY_LABELS[eligibility] ?? eligibility}.</p>
        {access.canManage ? <PayoutPolicyForm eligibility={eligibility} /> : null}
        <Alert variant="info" className="mt-(--sp-3)">
          As regras de percentual ou valor fixo são as do cadastro de repasse do profissional. Pagamento parcial da operadora nunca vira repasse integral; o Qoro registra o repasse, não paga ninguém.
        </Alert>
      </PanelCard>

      {byPro.size > 0 ? (
        <PanelCard title="Por profissional" regionLabel="Totais por profissional" className="mb-(--sp-4)">
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profissional</TableHead>
                  <TableHead className="text-right">Previsto</TableHead>
                  <TableHead className="text-right">Elegível</TableHead>
                  <TableHead className="text-right">Autorizado</TableHead>
                  <TableHead className="text-right">Repassado</TableHead>
                  <TableHead className="text-right">Devido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...byPro.entries()].map(([id, t]) => (
                  <TableRow key={id}>
                    <TableCell>{t.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(t.forecast)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(t.eligible)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(t.authorized)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(t.settled)}</TableCell>
                    <TableCell className={`text-right tabular-nums ${t.due < 0 ? 'text-danger-600' : ''}`}>{brl(t.due)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        </PanelCard>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Nenhum repasse de convênio"
          description="O repasse nasce quando a guia do atendimento fica pronta, para profissionais com regra de repasse cadastrada."
        />
      ) : (
        <TableWrap>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Atendimento</TableHead>
                <TableHead>Profissional</TableHead>
                <TableHead>Regra</TableHead>
                <TableHead className="text-right">Valor da sessão</TableHead>
                <TableHead className="text-right">Recebido / glosa</TableHead>
                <TableHead className="text-right">Previsto</TableHead>
                <TableHead className="text-right">Elegível</TableHead>
                <TableHead className="text-right">Autorizado</TableHead>
                <TableHead className="text-right">Repassado</TableHead>
                <TableHead className="text-right">Devido</TableHead>
                {access.canManage ? <TableHead aria-label="Ações" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.payoutId}>
                  <TableCell>
                    {r.guideId ? (
                      <Link href={`/convenios/guias/${r.guideId}`} className="hover:underline">{guideLabel(r.guideType, r.guideNumber ?? '—')}</Link>
                    ) : '—'}
                    <div className="text-fg-muted">{r.patientName} · {shortDate(r.executedOn)}</div>
                  </TableCell>
                  <TableCell>{r.professionalName}</TableCell>
                  <TableCell>{r.ruleKind === 'fixed' ? `fixo ${brl(r.ruleFixedCents ?? 0)}` : `${r.rulePercentage}%`}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.itemValueCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {brl(r.receivedCents)}
                    {r.glossDefinitiveCents > 0 ? <div className="text-fg-muted">glosa {brl(r.glossDefinitiveCents)}</div> : null}
                    {r.glossOpenCents > 0 ? <div className="text-fg-muted">em recurso {brl(r.glossOpenCents)}</div> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.forecastCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.eligibleCents === null ? '—' : brl(r.eligibleCents)}
                    {r.decision ? <div className="text-warning-700">{DECISIONS[r.decision] ?? r.decision}</div> : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.authorizedCents + r.adjustmentsCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{brl(r.settledCents)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${r.dueCents < 0 ? 'text-danger-600' : ''}`}>{brl(r.dueCents)}</TableCell>
                  {access.canManage ? (
                    <TableCell>
                      {r.status === 'active' ? (
                        <PayoutActions payoutId={r.payoutId} pendingAuthorizationCents={r.pendingAuthorizationCents} dueCents={r.dueCents} decision={r.decision} />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
