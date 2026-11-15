import type { Metadata } from 'next';
import Link from 'next/link';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PanelCard } from '@/components/ui/panel-card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { getInsuranceSetup, INSURER_STATUS_LABELS, PROVIDER_ID_LABELS } from '@/contexts/health-insurance/config-queries';

import { ConveniosHeader, conveniosAccess } from '../_lib/access';
import { NewInsurerForm, ProfessionalProfileForm, ProviderIdentityForm } from '../_lib/config-ui';

export const metadata: Metadata = { title: 'Configuração de convênios' };

export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, 'green' | 'gray' | 'amber' | 'red'> = { active: 'green', draft: 'gray', suspended: 'amber', archived: 'red' };

/**
 * Configuração de Convênios (P2.6; R44): o que a clínica precisa cadastrar para faturar
 * pela interface, sem SQL nem suporte técnico — prestador, operadoras (com planos e
 * contratos no detalhe) e o perfil TISS dos profissionais. A habilitação do módulo é do
 * Qoro e aparece como pendência externa, nunca como algo que a clínica liga sozinha.
 */
export default async function ConfiguracaoConveniosPage() {
  const access = await conveniosAccess('Configuração de convênios');
  if (!access.ok) return access.view;
  const setup = await getInsuranceSetup(access.clinicId);
  const pending = setup.readiness.filter((r) => !r.ok);

  return (
    <>
      <ConveniosHeader
        commercial={access.commercial}
        title="Configuração de convênios"
        description="Cadastre o prestador, as operadoras, os procedimentos contratados e o perfil TISS dos profissionais."
        crumbs={[{ label: 'Configuração' }]}
      />

      <PanelCard title="O que falta para faturar" regionLabel="Prontidão do convênio" className="mb-(--sp-4)">
        <ul className="flex flex-col gap-(--sp-2)" data-testid="convenios-readiness">
          {setup.readiness.map((r) => (
            <li key={r.key} className="flex items-start gap-(--sp-2) text-(length:--fs-sm)" data-readiness={r.key} data-ok={r.ok ? 'true' : 'false'}>
              <Badge tone={r.ok ? 'green' : r.external ? 'gray' : 'amber'}>{r.ok ? 'Pronto' : r.external ? 'Com o Qoro' : 'Pendente'}</Badge>
              <span>
                <span className="font-medium">{r.label}.</span> <span className="text-fg-muted">{r.detail}</span>
              </span>
            </li>
          ))}
        </ul>
        {pending.length === 0 ? (
          <Alert variant="success" className="mt-(--sp-3)">
            Tudo pronto: os atendimentos de convênio geram a guia sozinhos ao serem concluídos.
          </Alert>
        ) : null}
      </PanelCard>

      <PanelCard title="Identificação do prestador" regionLabel="Identificação do prestador" className="mb-(--sp-4)">
        <p className="mb-(--sp-3) text-(length:--fs-sm) text-fg-muted">
          Dados do contratado que vão em todas as guias. A identificação na operadora (código do prestador, CNPJ ou CPF) fica em cada operadora.
        </p>
        {access.canManage ? (
          <ProviderIdentityForm initial={setup.settings} />
        ) : (
          <p className="text-(length:--fs-sm)">
            {setup.settings.contractorName ?? 'Não informado'} · {setup.settings.providerKind ?? '—'} · CNES{' '}
            {setup.settings.cnesStatus === 'has' ? setup.settings.cnes : setup.settings.cnesStatus === 'none_declared' ? 'não tem (declarado)' : 'não informado'}
          </p>
        )}
      </PanelCard>

      <PanelCard title="Operadoras" regionLabel="Operadoras" className="mb-(--sp-4)">
        {access.canManage ? (
          <div className="mb-(--sp-3)">
            <NewInsurerForm />
          </div>
        ) : null}
        {setup.insurers.length === 0 ? (
          <EmptyState title="Nenhuma operadora cadastrada" description="Cadastre a operadora com o registro ANS e o código que ela deu à clínica." />
        ) : (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Operadora</TableHead>
                  <TableHead>Registro ANS</TableHead>
                  <TableHead>Identificação do prestador</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Planos</TableHead>
                  <TableHead className="text-right">Procedimentos vigentes</TableHead>
                  <TableHead className="text-right">Carteirinhas ativas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {setup.insurers.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link href={`/convenios/configuracao/operadoras/${i.id}`} className="font-medium hover:underline">
                        {i.name}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">{i.registroAns}</TableCell>
                    <TableCell>
                      <span className="text-fg-muted">{PROVIDER_ID_LABELS[i.providerIdKind] ?? i.providerIdKind}:</span> {i.providerIdMasked}
                    </TableCell>
                    <TableCell>
                      <Badge tone={STATUS_TONE[i.status] ?? 'gray'}>{INSURER_STATUS_LABELS[i.status] ?? i.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{i.plans}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.liveLinesToday}</TableCell>
                    <TableCell className="text-right tabular-nums">{i.activeCards}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
      </PanelCard>

      <PanelCard title="Perfil TISS dos profissionais" regionLabel="Perfil TISS dos profissionais" className="mb-(--sp-4)">
        <p className="mb-(--sp-3) text-(length:--fs-sm) text-fg-muted">
          Conselho, número, UF e CBO de quem executa o atendimento, como vão na guia. Sem o perfil, a guia nasce com pendência — nunca com dado inventado.
        </p>
        {setup.terminologyVersion === null ? (
          <Alert variant="warning">A terminologia TISS não está carregada neste ambiente; o perfil não pode ser conferido.</Alert>
        ) : setup.professionals.length === 0 ? (
          <EmptyState title="Nenhum profissional" description="Os profissionais que atendem aparecem aqui depois de cadastrados na equipe." />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {setup.professionals.map((p) => (
              <li key={p.id} className="flex flex-col gap-(--sp-2) py-(--sp-3)" data-testid="professional-row">
                <div className="flex flex-wrap items-center gap-(--sp-2)">
                  <span className="font-medium">{p.nome}</span>
                  {p.profile ? (
                    <span className="text-(length:--fs-sm) text-fg-muted">
                      {setup.councils.find((c) => c.code === p.profile!.council)?.term ?? `Conselho ${p.profile.council}`} {p.profile.councilNumber} ·{' '}
                      {setup.ufs.find((u) => u.code === p.profile!.councilUf)?.sigla ?? p.profile.councilUf} · CBO {p.profile.cbo}
                      {p.profile.cboTerm ? ` (${p.profile.cboTerm})` : ''}
                    </span>
                  ) : (
                    <Badge tone="amber">Sem perfil TISS</Badge>
                  )}
                </div>
                {access.canManage ? <ProfessionalProfileForm professional={p} councils={setup.councils} ufs={setup.ufs} /> : null}
              </li>
            ))}
          </ul>
        )}
      </PanelCard>

      <Alert variant="info">
        Carteirinhas dos pacientes ficam em <Link href="/convenios/carteirinhas" className="underline">Carteirinhas</Link>; a regra de repasse de cada profissional, em{' '}
        <Link href="/configuracoes/pagamentos" className="underline">Configurações › Pagamentos</Link>.
      </Alert>
    </>
  );
}
