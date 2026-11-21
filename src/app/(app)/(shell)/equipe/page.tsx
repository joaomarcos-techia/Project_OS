import type { VariantProps } from 'class-variance-authority';
import { CircleCheck, CirclePause, MailWarning, ShieldCheck, ShieldOff, Users } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { billingApiV1 } from '@/contexts/billing/api';
import { isPractitioner, type Role } from '@/contexts/identity';
import { assignableRolesFor } from '@/contexts/identity/internal/role-matrix';
import { listEmployees } from '@/contexts/identity/queries';
import { Alert } from '@/components/ui/alert';
import { Badge, type badgeVariants } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterBar, SearchField } from '@/components/ui/filter-bar';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableFoot,
  TableFootInfo,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  TableWrap,
} from '@/components/ui/table';
import { TableToolbar, TableToolbarSpacer } from '@/components/ui/table-toolbar';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { getCurrentUser } from '@/lib/auth/tenant-context';
import { cn } from '@/lib/ui/cn';
import { loadTrialAccessForRequest } from '../_painel/trial-access-request';

import { InviteDrawer } from './invite-drawer';
import { InviteRowActions } from './invite-row-actions';
import { MemberRowActions } from './member-row-actions';
import styles from './team.module.css';

type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

// Roster e claims do usuário mudam por requisição.
export const dynamic = 'force-dynamic';

/** Rótulo + tom de cada role (decisão de UI — vive na camada de tela). */
const ROLE_META: Record<Role, { label: string; tone: BadgeTone }> = {
  owner: { label: 'Dono', tone: 'violet' },
  gestor: { label: 'Gestor', tone: 'blue' },
  doctor: { label: 'Médico', tone: 'teal' },
  financial: { label: 'Financeiro', tone: 'amber' },
  attendant: { label: 'Recepção', tone: 'gray' },
  // Papel da plataforma, não da clínica (UX-014): só aparece se um dia vier numa
  // linha; o resumo por papel não o lista (ver a nota sob o resumo).
  super_admin: { label: 'Suporte Qoro', tone: 'red' },
};

/** Papéis da clínica. O suporte do Qoro não é da equipe: fica na nota do resumo. */
const ROLE_ORDER: Role[] = ['owner', 'gestor', 'doctor', 'financial', 'attendant'];

/**
 * A nota sob cada contagem diz POR QUE ela é essa — é o que transforma um
 * número em coisa acionável. Um só: o nome, porque a pergunta seguinte é "quem".
 * Vários: o que destoa (inativo, credencial faltando); nada destoando, o total.
 */
function notaDoPapel(
  role: Role,
  employees: { role: Role; nome: string; ativo: boolean; crm: string | null }[],
): string {
  const doPapel = employees.filter((e) => e.role === role);
  if (doPapel.length === 0) return 'nenhum';
  const inativos = doPapel.filter((e) => !e.ativo).length;
  const semCredencial = doPapel.filter((e) => isPractitioner(e) && e.crm == null).length;
  if (inativos > 0) return `${inativos} inativo${inativos === 1 ? '' : 's'}`;
  if (semCredencial > 0) return `${semCredencial} com pendência`;
  if (doPapel.length === 1) return doPapel[0]!.nome;
  return `${doPapel.length} ativos`;
}

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

/** Recortes que a referência oferece na barra; `todos` é o padrão. */
const FILTROS = [
  { id: 'todos', label: 'Todos' },
  { id: 'ativos', label: 'Ativos' },
  { id: 'inativos', label: 'Inativos' },
  { id: 'convites', label: 'Convites' },
] as const;

type FiltroEquipe = (typeof FILTROS)[number]['id'];

function isFiltro(v: string | undefined): v is FiltroEquipe {
  return FILTROS.some((f) => f.id === v);
}

/** Href do filtro preservando a busca — trocar o recorte não apaga o termo. */
function equipeHref(q: string, filtro: FiltroEquipe): string {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (filtro !== 'todos') params.set('filtro', filtro);
  const qs = params.toString();
  return qs ? `/equipe?${qs}` : '/equipe';
}

export default async function EquipePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filtro?: string }>;
}) {
  // Ver comentário equivalente no dashboard: o redirect explícito impede que
  // renders concorrentes transformem a expiração/revogação esperada em Sentry.
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  if (!user.clinicId || !user.permissions.includes(PERMISSIONS.MANAGE_EMPLOYEES)) {
    return (
      <>
        <PageHeader title="Equipe & Permissões" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para gerenciar a equipe.
        </Alert>
      </>
    );
  }

  // P-11: o trial entra no mesmo lote (antes esperava as outras três leituras terminarem).
  const [employees, limits, granularPermissionsEnabled, trial] = await Promise.all([
    listEmployees(user.clinicId),
    billingApiV1.getPlanLimits(user.clinicId),
    user.permissions.includes(PERMISSIONS.MANAGE_PERMISSIONS)
      ? billingApiV1.hasGranularPermissions(user.clinicId)
      : Promise.resolve(false),
    loadTrialAccessForRequest(user.clinicId),
  ]);
  const { q: qRaw, filtro: filtroRaw } = await searchParams;
  const q = (qRaw ?? '').trim();
  const filtro: FiltroEquipe = isFiltro(filtroRaw) ? filtroRaw : 'todos';

  /*
    A faixa de contagens e o rodapé falam da CLÍNICA, não do recorte: são o
    denominador contra o qual o filtro faz sentido. Quem filtra por "Inativos"
    quer ver um, não passar a acreditar que a clínica tem um.
  */
  const visiveis = employees.filter((e) => {
    if (q && !e.nome.toLocaleLowerCase('pt-BR').includes(q.toLocaleLowerCase('pt-BR')))
      return false;
    if (filtro === 'ativos') return e.ativo && !e.pending;
    if (filtro === 'inativos') return !e.ativo;
    if (filtro === 'convites') return e.pending;
    return true;
  });

  const ativos = employees.filter((e) => e.ativo).length;
  // Funções que ESTE ator pode atribuir (server-side; a UI só oferece o permitido).
  const assignableRoles = assignableRolesFor(user.role);
  const seatLimit = limits?.users ?? null;
  const canManagePermissions =
    user.permissions.includes(PERMISSIONS.MANAGE_PERMISSIONS) && granularPermissionsEnabled;
  const counts = new Map<Role, number>();
  for (const e of employees) counts.set(e.role, (counts.get(e.role) ?? 0) + 1);
  const pendingInvites = employees.filter((employee) => employee.ativo && employee.pending).length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administração' }, { label: 'Equipe & Permissões' }]}
        title="Equipe & Permissões"
        description="Acesso, papéis e capacidade do plano"
        {...(seatLimit != null
          ? {
              meta: (
                <span className="font-mono tabular-nums">
                  {ativos} de {seatLimit} usuários
                </span>
              ),
            }
          : {})}
        actions={
          <>
            {/* Vagas restantes ao lado do Convidar: é a informação que decide
                se o convite vai caber, e ela chegava só depois do clique. */}
            {seatLimit != null ? (
              <span className="inline-flex items-center gap-1.5 text-(length:--fs-sm) text-fg-muted">
                <Users aria-hidden="true" className="size-3.5 text-fg-subtle" />
                {Math.max(0, seatLimit - ativos)} vaga
                {seatLimit - ativos === 1 ? '' : 's'} no plano
              </span>
            ) : null}
            {trial?.restricted ? (
              <span>Convites disponíveis após o pagamento</span>
            ) : (
              <InviteDrawer ativos={ativos} seatLimit={seatLimit} />
            )}
          </>
        }
      />

      <section aria-label="Resumo da equipe" className={styles.overview ?? ''}>
        {ROLE_ORDER.map((r) => (
          <div key={r}>
            <span>{ROLE_META[r].label}</span>
            <strong>{counts.get(r) ?? 0}</strong>
            <small>{notaDoPapel(r, employees)}</small>
          </div>
        ))}
        <div>
          <span>Uso do plano</span>
          <strong>{seatLimit != null ? `${ativos} de ${seatLimit}` : ativos}</strong>
          <small>
            {seatLimit != null
              ? `${Math.max(0, seatLimit - ativos)} vaga${seatLimit - ativos === 1 ? '' : 's'} restante${seatLimit - ativos === 1 ? '' : 's'}`
              : 'sem limite no plano'}
          </small>
        </div>
      </section>
      {/* UX-014 — era um cartão "Super admin 0 · fora do tenant". O acesso especial
          continua dito, sem jargão e só com o que o código garante (revisto em 15/11):
          a sessão de suporte (impersonação, C15) exige TOTP a cada início
          (startImpersonationAction), expira em 1 hora (IMPERSONATION_TTL_SECONDS) e o
          início é gravado na auditoria da plataforma na mesma transação
          (`impersonate_start`). NÃO dizer que "toda alteração" fica na auditoria nem que
          a sessão é o único acesso: nem toda mutação passa pelo caminho auditado, e o
          console da plataforma lê conversas da IA fora de sessão (docs/otimização_ui_final.md, 33). */}
      <p className="mb-(--sp-4) text-(length:--fs-xs) text-fg-muted">
        O suporte do Qoro não faz parte desta equipe. Para entrar na conta da clínica, ele abre uma
        sessão de suporte, que exige verificação em duas etapas e dura no máximo 1 hora; o início de
        cada sessão fica registrado na auditoria do Qoro.
      </p>

      <FilterBar className="qoro-toolbar">
        <form className="flex w-full min-w-0 items-center gap-(--sp-2) sm:w-68" role="search">
          {filtro !== 'todos' ? <input type="hidden" name="filtro" value={filtro} /> : null}
          <SearchField
            name="q"
            defaultValue={q}
            placeholder="Buscar por nome…"
            aria-label="Buscar pessoas da equipe por nome"
            className="min-w-0"
          />
        </form>
        <nav
          aria-label="Situação do acesso"
          className="inline-flex rounded-(--r-md) border border-border bg-surface-inset p-0.5"
        >
          {FILTROS.map((item) => (
            <Link
              key={item.id}
              href={equipeHref(q, item.id)}
              aria-current={filtro === item.id ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-(--hit-target) items-center rounded-(--r-sm) px-3 text-(length:--fs-sm)',
                filtro === item.id
                  ? 'bg-surface font-semibold text-fg shadow-xs'
                  : 'text-fg-muted hover:bg-surface-hover',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto font-mono text-(length:--fs-caption) tabular-nums text-fg-subtle">
          {ativos} ativo{ativos === 1 ? '' : 's'}
          {employees.length - ativos > 0
            ? ` · ${employees.length - ativos} inativo${employees.length - ativos === 1 ? '' : 's'}`
            : ''}
          {pendingInvites > 0
            ? ` · ${pendingInvites} convite${pendingInvites === 1 ? '' : 's'}`
            : ''}
        </span>
      </FilterBar>

      {employees.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <EmptyState
            title="Nenhum funcionário cadastrado"
            description="Convide o primeiro para começar."
          />
        </div>
      ) : (
        <TableWrap className={styles.roster ?? ''}>
          <TableToolbar>
            <h2 className="text-(length:--fs-sm) font-semibold">Usuários e convites</h2>
            <TableToolbarSpacer />
            {/* Aqui dentro da moldura o número é o do RECORTE — é o que está
                logo abaixo. O total da clínica já está na barra de filtros. */}
            <span className="font-mono text-(length:--fs-caption) tabular-nums text-fg-subtle">
              {visiveis.length} de {employees.length}
            </span>
          </TableToolbar>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Credencial profissional</TableHead>
                  <TableHead>Segundo fator</TableHead>
                  <TableHead>Situação do acesso</TableHead>
                  <TableHead className="w-0 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiveis.map((e) => {
                  const meta = ROLE_META[e.role];
                  const credencial =
                    e.crm != null
                      ? `CRM ${e.crm}${e.crmUf ? `/${e.crmUf}` : ''}`
                      : (e.especialidade ?? null);
                  return (
                    <TableRow key={e.id} className={!e.ativo ? styles.inactive : undefined}>
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="grid size-8 shrink-0 place-items-center rounded-(--r-md) border border-border bg-primary-soft text-(length:--fs-xs) font-semibold text-primary"
                          >
                            {initials(e.nome)}
                          </span>
                          <span className="min-w-0 font-medium">
                            {e.nome}
                            {e.id === user.userId ? (
                              <span className="ml-1.5 text-(length:--fs-xs) font-normal text-fg-subtle">
                                (você)
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        {/* Texto, não badge: o papel já é contado na faixa, e
                            cinco pastilhas coloridas por linha faziam a tabela
                            gritar sem hierarquia nenhuma. */}
                        <span className="font-medium text-fg-muted">{meta.label}</span>
                        {canManagePermissions && e.overridesCount > 0 ? (
                          <span className="ml-1.5 text-(length:--fs-xs) text-fg-subtle">
                            +{e.overridesCount} ajuste{e.overridesCount > 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {isPractitioner(e) && e.crm == null ? (
                          <Badge tone="amber">Médico incompleto</Badge>
                        ) : (
                          (credencial ?? (
                            // "Não aplicável" e não "—": recepção não tem
                            // credencial profissional, e um travessão faria
                            // parecer cadastro faltando.
                            <span className="italic text-fg-subtle">Não aplicável</span>
                          ))
                        )}
                      </TableCell>
                      <TableCell>
                        {e.pending ? (
                          // Convite ainda não aceito: não há segundo fator para
                          // relatar, e "Não ativado" leria como negligência.
                          <span className="text-(length:--fs-xs) text-fg-subtle">
                            após o primeiro acesso
                          </span>
                        ) : e.mfaEnrolled ? (
                          <Badge tone="green">
                            <ShieldCheck aria-hidden="true" className="size-3 shrink-0" />
                            TOTP ativo
                          </Badge>
                        ) : (
                          <Badge tone="gray">
                            <ShieldOff aria-hidden="true" className="size-3 shrink-0" />
                            Não ativado
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {/* "Ativo" em CINZA de propósito: é o estado normal de
                            toda a equipe, e em verde a coluna inteira virava um
                            painel de parabéns onde só a exceção importa. */}
                        {!e.ativo ? (
                          <Badge tone="gray">
                            <CirclePause aria-hidden="true" className="size-3 shrink-0" />
                            Acesso desativado
                          </Badge>
                        ) : e.pending ? (
                          <Badge tone="amber">
                            <MailWarning aria-hidden="true" className="size-3 shrink-0" />
                            Convite pendente
                          </Badge>
                        ) : (
                          <Badge tone="gray">
                            <CircleCheck aria-hidden="true" className="size-3 shrink-0" />
                            Ativo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.pending ? (
                          <InviteRowActions userId={e.id} nome={e.nome} />
                        ) : // Membro aceito: gestão de ciclo de vida (I-2). Não para si
                        // mesmo (self-mutation bloqueado) nem para owner/super_admin
                        // (papéis protegidos — a action barraria de qualquer forma).
                        e.id !== user.userId && e.role !== 'owner' && e.role !== 'super_admin' ? (
                          <MemberRowActions
                            userId={e.id}
                            nome={e.nome}
                            role={e.role}
                            ativo={e.ativo}
                            assignableRoles={assignableRoles}
                            overrides={e.overrides}
                            canManagePermissions={canManagePermissions}
                          />
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableScroll>
          <TableFoot>
            <TableFootInfo>
              {filtro === 'todos' && !q
                ? `${employees.length} usuário${employees.length === 1 ? '' : 's'} na clínica`
                : `${visiveis.length} de ${employees.length} usuário${employees.length === 1 ? '' : 's'}`}
            </TableFootInfo>
            <span className="text-(length:--fs-xs) text-fg-subtle">
              Ações disponíveis conforme seu nível de acesso
            </span>
          </TableFoot>
        </TableWrap>
      )}
    </>
  );
}
