/**
 * Aba "Convênios" da ficha do paciente (P1.3, ciclo de 14/11). Componente de servidor do
 * módulo TISS: o agente de UI pode trocar a moldura visual; os dados, os estados e as
 * permissões ficam aqui.
 *
 * Só LEITURA, pela RLS da clínica da sessão. A carteirinha aparece mascarada (4 últimos); a
 * senha de autorização nunca sai do banco. A aba não é caminho alternativo: cadastrar ou
 * alterar carteirinha, cobertura ou guia continua nas telas de Convênios, que repetem as
 * validações de credenciamento, assinatura (D24) e autorização no servidor e no banco.
 */
import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import {
  AUTHORIZATION_STATUS_LABELS,
  COVERAGE_STATUS_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  PATIENT_INSURANCE_LIMITS,
  getPatientInsuranceOverview,
} from '@/contexts/health-insurance/config-queries';
import {
  getConveniosCommercialDenial,
  isInsuranceSchemaInstalled,
} from '@/contexts/health-insurance/queries';
import { todayYmdIn } from '@/lib/format';
import { premiumDenialMessage } from '@/lib/premium-access';

import { brl, shortDate } from './access';
import {
  canOfferCardManagement,
  CONTRACTABLE_DENIALS,
  isCardExpired,
  patientInsuranceState,
} from './patient-insurance-state';
import { GuideStatusBadge } from './status';

const GUIDE_TYPE: Record<string, string> = { consulta: 'Consulta', sp_sadt: 'SP/SADT' };

function dateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function PatientInsuranceTab({
  clinicId,
  patientId,
  canEditPatients,
}: {
  clinicId: string;
  patientId: string;
  /** Recepção cadastra carteirinha (editar paciente); o link só aparece com tudo liberado. */
  canEditPatients: boolean;
}) {
  const installed = await isInsuranceSchemaInstalled(clinicId);
  if (!installed) {
    return (
      <Alert variant="info" title="Convênios ainda não está instalado neste ambiente">
        <span data-testid="patient-insurance" data-state="not_installed">
          As tabelas do faturamento TISS ainda não foram aplicadas neste banco.
        </span>
      </Alert>
    );
  }
  const [commercial, overview] = await Promise.all([
    getConveniosCommercialDenial(clinicId),
    getPatientInsuranceOverview(clinicId, patientId),
  ]);
  if (!overview) return null; // a página já respondeu 404 antes de chegar aqui
  const records =
    overview.cards.length +
    overview.coverages.length +
    overview.guides.length +
    overview.authorizations.length;
  const state = patientInsuranceState({
    installed,
    commercial,
    enabled: overview.enabled,
    records,
  });
  const manageHref = `/convenios/carteirinhas?paciente=${patientId}`;
  const offerManage = canOfferCardManagement(state, canEditPatients);
  const today = todayYmdIn();

  return (
    <div
      className="flex flex-col gap-(--sp-4)"
      data-testid="patient-insurance"
      data-state={state}
      {...(commercial ? { 'data-denial': commercial } : {})}
    >
      {commercial ? (
        <Alert
          variant={CONTRACTABLE_DENIALS.includes(commercial) ? 'info' : 'warning'}
          title={
            state === 'contractable'
              ? 'Convênios faz parte das assinaturas ativas'
              : 'Convênios em modo de consulta'
          }
        >
          {premiumDenialMessage('health_insurance', commercial)}
        </Alert>
      ) : null}
      {state === 'module_disabled' ? (
        <Alert variant="info" title="Convênios não está habilitado nesta clínica">
          A habilitação do faturamento de convênios é feita pelo Qoro. Registros já existentes
          continuam visíveis aqui.
        </Alert>
      ) : null}

      {state === 'contractable' ? null : (
        <PanelCard
          title="Carteirinhas"
          regionLabel="Carteirinhas do paciente"
          {...(offerManage
            ? { action: { label: 'Gerenciar carteirinhas', href: manageHref } }
            : {})}
        >
          {overview.cards.length === 0 ? (
            <EmptyState
              title="Nenhuma carteirinha"
              description={
                offerManage
                  ? 'Cadastre a carteirinha para o atendimento de convênio sair sem pendência.'
                  : 'Este paciente não tem carteirinha cadastrada.'
              }
            />
          ) : (
            <ul
              className="flex flex-col divide-y divide-border"
              data-testid="patient-insurance-cards"
            >
              {overview.cards.map((c) => {
                const expired = c.status === 'active' && isCardExpired(c.validUntil, today);
                return (
                  <li
                    key={c.id}
                    className="flex flex-col gap-(--sp-1) py-(--sp-3)"
                    data-testid="patient-insurance-card"
                    data-status={c.status}
                    data-expired={expired ? 'true' : 'false'}
                  >
                    <div className="flex flex-wrap items-center gap-(--sp-2)">
                      <span className="font-medium">{c.insurerName}</span>
                      <span className="font-mono text-(length:--fs-sm)">•••• {c.last4}</span>
                      <Badge tone={c.status === 'active' && !expired ? 'green' : 'gray'}>
                        {expired ? 'Vencida' : (MEMBERSHIP_STATUS_LABELS[c.status] ?? c.status)}
                      </Badge>
                      {c.isPreferred ? <Badge tone="blue">Preferencial</Badge> : null}
                      {c.insurerStatus !== 'active' ? (
                        <Badge tone="amber">Operadora não ativa</Badge>
                      ) : null}
                    </div>
                    <div className="text-(length:--fs-sm) text-fg-muted">
                      {c.planName ?? 'Plano não informado'} ·{' '}
                      {c.holderKind === 'dependente' ? 'Dependente' : 'Titular'} · validade{' '}
                      {c.validUntil ? shortDate(c.validUntil) : 'não informada'}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </PanelCard>
      )}

      {overview.coverages.length > 0 ? (
        <PanelCard title="Cobertura dos atendimentos" regionLabel="Cobertura dos atendimentos">
          <ul
            className="flex flex-col divide-y divide-border"
            data-testid="patient-insurance-coverages"
          >
            {overview.coverages.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-(--sp-2) py-(--sp-2)"
                data-testid="patient-insurance-coverage"
                data-status={c.status}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">{dateTime(c.scheduledAt)}</span>
                  <span className="text-(length:--fs-sm) text-fg-muted">
                    {c.insurerName}
                    {c.planName ? ` · ${c.planName}` : ''} ·{' '}
                    {GUIDE_TYPE[c.guideType] ?? c.guideType}
                    {c.authorizationRequirement === 'required' ? ' · exige autorização' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-(--sp-2)">
                  {c.issues > 0 ? <Badge tone="amber">{c.issues} pendência(s)</Badge> : null}
                  <Badge
                    tone={
                      c.status === 'ready'
                        ? 'green'
                        : c.status === 'cancelled'
                          ? 'gray'
                          : c.status === 'authorization_denied'
                            ? 'red'
                            : 'amber'
                    }
                  >
                    {COVERAGE_STATUS_LABELS[c.status] ?? c.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
          {overview.coverages.length === PATIENT_INSURANCE_LIMITS.coverages ? (
            <p className="mt-(--sp-2) text-(length:--fs-sm) text-fg-muted">
              Mostrando os {PATIENT_INSURANCE_LIMITS.coverages} atendimentos mais relevantes
              (próximos e recentes).
            </p>
          ) : null}
        </PanelCard>
      ) : null}

      {overview.authorizations.length > 0 ? (
        <PanelCard title="Autorizações" regionLabel="Autorizações do paciente">
          <ul
            className="flex flex-col divide-y divide-border"
            data-testid="patient-insurance-authorizations"
          >
            {overview.authorizations.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-(--sp-2) py-(--sp-2)"
                data-status={a.status}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-medium">
                    {a.insurerName} · {GUIDE_TYPE[a.guideType] ?? a.guideType}
                  </span>
                  <span className="text-(length:--fs-sm) text-fg-muted">
                    Solicitada em {shortDate(a.requestedOn)}
                    {a.authorizedOn ? ` · autorizada em ${shortDate(a.authorizedOn)}` : ''}
                    {a.passwordValidUntil
                      ? ` · senha válida até ${shortDate(a.passwordValidUntil)}`
                      : ''}
                  </span>
                </div>
                <Badge
                  tone={
                    a.status === 'authorized'
                      ? 'green'
                      : a.status === 'denied' || a.status === 'expired'
                        ? 'red'
                        : a.status === 'cancelled'
                          ? 'gray'
                          : 'amber'
                  }
                >
                  {AUTHORIZATION_STATUS_LABELS[a.status] ?? a.status}
                </Badge>
              </li>
            ))}
          </ul>
        </PanelCard>
      ) : null}

      {state === 'contractable' ? null : (
        <PanelCard title="Histórico de guias" regionLabel="Histórico de guias do paciente">
          {overview.guides.length === 0 ? (
            <EmptyState
              title="Nenhuma guia"
              description="As guias nascem do atendimento de convênio concluído."
            />
          ) : (
            <ul
              className="flex flex-col divide-y divide-border"
              data-testid="patient-insurance-guides"
            >
              {overview.guides.map((g) => (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center justify-between gap-(--sp-2) py-(--sp-2)"
                  data-testid="patient-insurance-guide"
                  data-status={g.status}
                >
                  <div className="flex min-w-0 flex-col">
                    <Link href={`/convenios/guias/${g.id}`} className="font-medium hover:underline">
                      Guia {g.number}
                    </Link>
                    <span className="text-(length:--fs-sm) text-fg-muted">
                      {g.insurerName} · {GUIDE_TYPE[g.guideType] ?? g.guideType} ·{' '}
                      {shortDate(g.createdAt)} · {brl(g.totalValueCents)}
                    </span>
                  </div>
                  <GuideStatusBadge status={g.status} />
                </li>
              ))}
            </ul>
          )}
          {overview.guides.length === PATIENT_INSURANCE_LIMITS.guides ? (
            <p className="mt-(--sp-2) text-(length:--fs-sm) text-fg-muted">
              Mostrando as {PATIENT_INSURANCE_LIMITS.guides} guias mais recentes.{' '}
              <Link href="/convenios/guias" className="underline">
                Ver todas as guias
              </Link>
            </p>
          ) : null}
        </PanelCard>
      )}
    </div>
  );
}
