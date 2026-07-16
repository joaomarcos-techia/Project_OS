import type { VariantProps } from 'class-variance-authority';

import { billingApiV1 } from '@/contexts/billing/api';
import { isPractitioner, type Role } from '@/contexts/identity';
import { assignableRolesFor } from '@/contexts/identity/internal/role-matrix';
import { listEmployees } from '@/contexts/identity/queries';
import { Alert } from '@/components/ui/alert';
import { Badge, type badgeVariants } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
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
import { requireUser } from '@/lib/auth/tenant-context';

import { InviteDrawer } from './invite-drawer';
import { InviteRowActions } from './invite-row-actions';
import { MemberRowActions } from './member-row-actions';

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
  super_admin: { label: 'Super admin', tone: 'red' },
};

const ROLE_ORDER: Role[] = ['owner', 'gestor', 'doctor', 'financial', 'attendant', 'super_admin'];

function initials(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default async function EquipePage() {
  const user = await requireUser();

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

  const employees = await listEmployees(user.clinicId);
  const ativos = employees.filter((e) => e.ativo).length;
  // Funções que ESTE ator pode atribuir (server-side; a UI só oferece o permitido).
  const assignableRoles = assignableRolesFor(user.role);
  const limits = await billingApiV1.getPlanLimits(user.clinicId);
  const seatLimit = limits?.users ?? null;
  const counts = new Map<Role, number>();
  for (const e of employees) counts.set(e.role, (counts.get(e.role) ?? 0) + 1);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administração' }, { label: 'Equipe & Permissões' }]}
        title="Equipe & Permissões"
        description="Quem acessa o quê — usuários e funções da sua clínica."
      />

      {employees.length === 0 ? (
        <div className="flex flex-col items-center gap-4">
          <EmptyState
            title="Nenhum funcionário cadastrado"
            description="Convide o primeiro para começar."
          />
          <InviteDrawer ativos={ativos} seatLimit={seatLimit} />
        </div>
      ) : (
        <TableWrap>
          <TableToolbar>
            <span className="text-(length:--fs-xs) text-fg-subtle">
              {employees.length} {employees.length === 1 ? 'pessoa' : 'pessoas'} · {ativos}{' '}
              {ativos === 1 ? 'ativa' : 'ativas'}
            </span>
            <TableToolbarSpacer />
            <div className="flex flex-wrap gap-1.5">
              {ROLE_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => (
                <Badge key={r} tone={ROLE_META[r].tone}>
                  {ROLE_META[r].label} · {counts.get(r)}
                </Badge>
              ))}
            </div>
            <InviteDrawer ativos={ativos} seatLimit={seatLimit} />
          </TableToolbar>
          <TableScroll>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Usuário</TableHead>
                  <TableHead>Função</TableHead>
                  <TableHead>Credencial</TableHead>
                  <TableHead>2FA</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-0 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employees.map((e) => {
                  const meta = ROLE_META[e.role];
                  const credencial =
                    e.crm != null
                      ? `CRM ${e.crm}${e.crmUf ? `/${e.crmUf}` : ''}`
                      : (e.especialidade ?? null);
                  return (
                    <TableRow key={e.id}>
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <span
                            aria-hidden="true"
                            className="grid size-6 shrink-0 place-items-center rounded-full bg-primary text-[10px] font-semibold text-on-primary"
                          >
                            {initials(e.nome)}
                          </span>
                          <span className="font-medium">{e.nome}</span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {e.overridesCount > 0 ? (
                          <span className="ml-1.5 text-(length:--fs-xs) text-fg-subtle">
                            +{e.overridesCount} ajuste{e.overridesCount > 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {isPractitioner(e) && e.crm == null ? (
                          <Badge tone="amber">Médico incompleto</Badge>
                        ) : (
                          (credencial ?? '—')
                        )}
                      </TableCell>
                      <TableCell>
                        {e.mfaEnrolled ? (
                          <Badge tone="green" dot>
                            Ativo
                          </Badge>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!e.ativo ? (
                          <Badge tone="gray">Inativo</Badge>
                        ) : e.pending ? (
                          <Badge tone="amber">Convite pendente</Badge>
                        ) : (
                          <Badge tone="green">Ativo</Badge>
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
              {employees.length} usuário{employees.length === 1 ? '' : 's'} na clínica
            </TableFootInfo>
          </TableFoot>
        </TableWrap>
      )}
    </>
  );
}
