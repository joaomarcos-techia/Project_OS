import { notFound } from 'next/navigation';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { getInsurerDetail, INSURER_STATUS_LABELS, PROVIDER_ID_LABELS, type ContractLineView } from '@/contexts/health-insurance/config-queries';

import { brl, ConveniosHeader, conveniosAccess, shortDate } from '../../../_lib/access';
import {
  ContractRevisionForm,
  InsurerEditForm,
  InsurerStatusActions,
  NewContractLineForm,
  NewPlanForm,
  PlanStatusButton,
} from '../../../_lib/config-ui';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const STATUS_TONE: Record<string, 'green' | 'gray' | 'amber' | 'red'> = { active: 'green', draft: 'gray', suspended: 'amber', archived: 'red' };
const GUIDE_LABEL = { consulta: 'Consulta', sp_sadt: 'SP/SADT' } as const;

/** Rótulos do histórico (ações da configuração; sem dado pessoal no `after`). */
const HISTORY_LABELS: Record<string, string> = {
  'health_insurance.config.insurer_created': 'Operadora cadastrada',
  'health_insurance.config.insurer_updated': 'Dados da operadora alterados',
  'health_insurance.config.insurer_active': 'Operadora ativada',
  'health_insurance.config.insurer_suspended': 'Operadora suspensa',
  'health_insurance.config.insurer_archived': 'Operadora arquivada',
  'health_insurance.config.plan_created': 'Plano cadastrado',
  'health_insurance.config.plan_archived': 'Plano arquivado',
  'health_insurance.config.plan_reactivated': 'Plano reativado',
  'health_insurance.config.contract_line_created': 'Procedimento contratado',
  'health_insurance.config.contract_line_correct': 'Item do contrato corrigido',
  'health_insurance.config.contract_line_new_period': 'Reajuste a partir de uma data',
  'health_insurance.config.contract_line_end': 'Vigência encerrada',
};

function copayText(l: ContractLineView): string {
  if (l.copayKind === 'fixed') return brl(l.copayFixedCents ?? 0);
  if (l.copayKind === 'percentage') return `${String(l.copayPercentage).replace('.', ',')}%`;
  return '—';
}

function period(l: ContractLineView): string {
  return `${shortDate(l.validFrom)} a ${l.validUntil ? shortDate(l.validUntil) : 'sem fim'}`;
}

export default async function OperadoraPage({ params }: { params: Promise<{ insurerId: string }> }) {
  const { insurerId } = await params;
  const access = await conveniosAccess('Operadora');
  if (!access.ok) return access.view;
  if (!UUID.test(insurerId)) notFound();
  const d = await getInsurerDetail(access.clinicId, insurerId);
  if (!d) notFound();
  const i = d.insurer;
  const live = d.lines.filter((l) => l.live);
  const history = d.lines.filter((l) => !l.live);
  const editable = access.canManage && i.status !== 'archived';

  return (
    <>
      <ConveniosHeader
        commercial={access.commercial}
        title={i.name}
        description={`Registro ANS ${i.registroAns}`}
        crumbs={[{ label: 'Configuração', href: '/convenios/configuracao' }, { label: i.name }]}
      />

      <PanelCard title="Dados da operadora" regionLabel="Dados da operadora" className="mb-(--sp-4)">
        <dl className="mb-(--sp-3) grid gap-(--sp-2) text-(length:--fs-sm) sm:grid-cols-2">
          <div>
            <dt className="text-fg-muted">Situação</dt>
            <dd data-testid="insurer-status" data-status={i.status}>
              <Badge tone={STATUS_TONE[i.status] ?? 'gray'}>{INSURER_STATUS_LABELS[i.status] ?? i.status}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-fg-muted">{PROVIDER_ID_LABELS[i.providerIdKind]}</dt>
            <dd className="tabular-nums">{i.providerIdMasked}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Sessões SP/SADT</dt>
            <dd>{i.sadtGrouping === 'per_request' ? 'Sessões da mesma solicitação na mesma guia' : 'Uma guia por sessão'}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Padrão TISS · envio</dt>
            <dd>4.03.00 · manual (lote XML)</dd>
          </div>
        </dl>
        {i.status === 'draft' ? (
          <Alert variant="info" className="mb-(--sp-3)">
            Rascunho: a operadora ainda não aparece no agendamento. Cadastre os procedimentos contratados e ative-a.
          </Alert>
        ) : null}
        {access.canManage ? (
          <div className="flex flex-col gap-(--sp-3)">
            <InsurerStatusActions insurerId={i.id} status={i.status} />
            {i.status !== 'archived' ? <InsurerEditForm insurer={i} /> : null}
          </div>
        ) : null}
      </PanelCard>

      <PanelCard title="Planos" regionLabel="Planos da operadora" className="mb-(--sp-4)">
        {editable ? (
          <div className="mb-(--sp-3)">
            <NewPlanForm insurerId={i.id} />
          </div>
        ) : null}
        {d.plans.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Sem planos cadastrados: os contratos e carteirinhas valem para a operadora inteira.</p>
        ) : (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plano</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Segmentação</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Carteirinhas ativas</TableHead>
                  {editable ? <TableHead><span className="sr-only">Ações</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.plans.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.operatorCode ?? '—'}</TableCell>
                    <TableCell>{p.category ?? '—'}</TableCell>
                    <TableCell>{p.status === 'active' ? 'Ativo' : 'Arquivado'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.cards}</TableCell>
                    {editable ? (
                      <TableCell>
                        <PlanStatusButton planId={p.id} status={p.status} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </PanelCard>

      <PanelCard title="Procedimentos contratados" regionLabel="Contrato" className="mb-(--sp-4)">
        <p className="mb-(--sp-3) text-(length:--fs-sm) text-fg-muted">
          Cada item liga um procedimento do catálogo da clínica ao código TUSS, ao valor e às regras da operadora. Alterar nunca apaga: cria uma versão nova e a anterior
          fica no histórico. Guias já emitidas não mudam.
        </p>
        {editable ? (
          <div className="mb-(--sp-3)">
            <NewContractLineForm insurerId={i.id} plans={d.plans} procedures={d.procedures} />
          </div>
        ) : null}
        {live.length === 0 ? (
          <EmptyState title="Nenhum procedimento contratado" description="Sem item vigente, o atendimento de convênio fica com a pendência “procedimento sem contrato”." />
        ) : (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Procedimento</TableHead>
                  <TableHead>TUSS</TableHead>
                  <TableHead>Guia</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Coparticipação</TableHead>
                  <TableHead>Autorização</TableHead>
                  {editable ? <TableHead><span className="sr-only">Ações</span></TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {live.map((l) => (
                  <TableRow key={l.id} data-testid="contract-line" data-code={l.procedureCode}>
                    <TableCell>
                      {l.procedureName ?? '—'}
                      <div className="text-fg-muted">{l.description}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">{l.procedureCode}</TableCell>
                    <TableCell>{GUIDE_LABEL[l.guideType]}</TableCell>
                    <TableCell>{l.planName ?? 'Todos'}</TableCell>
                    <TableCell>{period(l)}</TableCell>
                    <TableCell className="text-right tabular-nums">{brl(l.unitValueCents)}</TableCell>
                    <TableCell>{copayText(l)}</TableCell>
                    <TableCell>
                      {l.requiresAuthorization ? 'Exige' : 'Não exige'}
                      {l.returnDays ? <div className="text-fg-muted">retorno {l.returnDays} dias{l.returnBillable ? ' (faturável)' : ''}</div> : null}
                    </TableCell>
                    {editable ? (
                      <TableCell>
                        <ContractRevisionForm line={l} procedures={d.procedures} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
        {history.length > 0 ? (
          <details className="mt-(--sp-3)">
            <summary className="cursor-pointer text-(length:--fs-sm) font-medium">Versões anteriores ({history.length})</summary>
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>TUSS</TableHead>
                    <TableHead>Vigência</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Coparticipação</TableHead>
                    <TableHead>Cadastrada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((l) => (
                    <TableRow key={l.id} data-testid="contract-line-history">
                      <TableCell className="tabular-nums">
                        {l.procedureCode} · {GUIDE_LABEL[l.guideType]}
                      </TableCell>
                      <TableCell>{period(l)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(l.unitValueCents)}</TableCell>
                      <TableCell>{copayText(l)}</TableCell>
                      <TableCell>
                        {shortDate(l.createdAt)}
                        {l.createdByName ? <div className="text-fg-muted">{l.createdByName}</div> : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          </details>
        ) : null}
      </PanelCard>

      <PanelCard title="Histórico de alterações" regionLabel="Histórico de alterações" className="mb-(--sp-4)">
        {d.history.length === 0 ? (
          <p className="text-(length:--fs-sm) text-fg-muted">Nenhuma alteração registrada pela interface.</p>
        ) : (
          <ul className="flex flex-col gap-(--sp-1) text-(length:--fs-sm)" data-testid="insurer-history">
            {d.history.map((h, idx) => (
              <li key={`${h.at}-${idx}`}>
                <span className="tabular-nums text-fg-muted">{new Date(h.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</span> ·{' '}
                {HISTORY_LABELS[h.action] ?? h.action}
                {h.userName ? <span className="text-fg-muted"> · {h.userName}</span> : null}
                {typeof h.after?.reason === 'string' ? <span className="text-fg-muted"> · “{h.after.reason}”</span> : null}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>
    </>
  );
}
