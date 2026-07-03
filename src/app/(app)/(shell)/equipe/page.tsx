import type { VariantProps } from 'class-variance-authority';

import type { Role } from '@/contexts/identity';
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
  const counts = new Map<Role, number>();
  for (const e of employees) counts.set(e.role, (counts.get(e.role) ?? 0) + 1);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administração' }, { label: 'Equipe & Permissões' }]}
        title="Equipe & Permissões"
        description="Quem acessa o quê — usuários e funções da sua clínica."
      />

      <Alert variant="info" title="Convites e edição de função chegam em seguida" className="mb-5">
        Esta é a visão da equipe (somente leitura). Alterar a função de um usuário mexe nas
        credenciais do login (exige novo acesso), então virá com as devidas travas de segurança.
      </Alert>

      {employees.length === 0 ? (
        <EmptyState title="Nenhum funcionário cadastrado" description="A equipe aparecerá aqui." />
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
                      <TableCell className="text-fg-muted">{credencial ?? '—'}</TableCell>
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
                        {e.ativo ? (
                          <Badge tone="green">Ativo</Badge>
                        ) : (
                          <Badge tone="gray">Inativo</Badge>
                        )}
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
