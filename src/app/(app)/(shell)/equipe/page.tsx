import type { VariantProps } from 'class-variance-authority';

import type { Role } from '@/contexts/identity';
import { listEmployees } from '@/contexts/identity/queries';
import { Alert } from '@/components/ui/alert';
import { Badge, type badgeVariants } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
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
      <div className="screen">
        <PageHeader title="Equipe & Permissões" />
        <Alert variant="warning" title="Sem acesso">
          Seu perfil não tem permissão para gerenciar a equipe.
        </Alert>
      </div>
    );
  }

  const employees = await listEmployees(user.clinicId);
  const ativos = employees.filter((e) => e.ativo).length;
  const counts = new Map<Role, number>();
  for (const e of employees) counts.set(e.role, (counts.get(e.role) ?? 0) + 1);

  return (
    <div className="screen">
      <PageHeader
        title="Equipe & Permissões"
        description="Quem acessa o quê — usuários e funções da sua clínica."
      />

      <Alert variant="info" title="Convites e edição de função chegam em seguida" className="mb-5">
        Esta é a visão da equipe (somente leitura). Alterar a função de um usuário mexe nas
        credenciais do login (exige novo acesso), então virá com as devidas travas de segurança.
      </Alert>

      {/* Resumo por função (dados reais) */}
      {employees.length > 0 ? (
        <div className="toolbar" style={{ marginBottom: 'var(--sp-4)' }}>
          <span className="td-sub" style={{ marginRight: 4 }}>
            {employees.length} {employees.length === 1 ? 'pessoa' : 'pessoas'} · {ativos}{' '}
            {ativos === 1 ? 'ativa' : 'ativas'}
          </span>
          {ROLE_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => (
            <Badge key={r} tone={ROLE_META[r].tone}>
              {ROLE_META[r].label} · {counts.get(r)}
            </Badge>
          ))}
        </div>
      ) : null}

      {employees.length === 0 ? (
        <EmptyState title="Nenhum funcionário cadastrado" description="A equipe aparecerá aqui." />
      ) : (
        <div className="cardblock">
          <div className="table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Usuário</th>
                  <th>Função</th>
                  <th>Credencial</th>
                  <th>2FA</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const meta = ROLE_META[e.role];
                  const credencial =
                    e.crm != null
                      ? `CRM ${e.crm}${e.crmUf ? `/${e.crmUf}` : ''}`
                      : (e.especialidade ?? null);
                  return (
                    <tr key={e.id}>
                      <td>
                        <span className="td-name">
                          <span className="avatar sm" data-name={initials(e.nome)} aria-hidden="true" />
                          {e.nome}
                        </span>
                      </td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {e.overridesCount > 0 ? (
                          <span className="td-sub" style={{ marginLeft: 6 }}>
                            +{e.overridesCount} ajuste{e.overridesCount > 1 ? 's' : ''}
                          </span>
                        ) : null}
                      </td>
                      <td className="td-sub">{credencial ?? '—'}</td>
                      <td>
                        {e.mfaEnrolled ? (
                          <Badge tone="green" dot>
                            Ativo
                          </Badge>
                        ) : (
                          <span className="td-sub">—</span>
                        )}
                      </td>
                      <td>
                        {e.ativo ? (
                          <Badge tone="green">Ativo</Badge>
                        ) : (
                          <Badge tone="gray">Inativo</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
