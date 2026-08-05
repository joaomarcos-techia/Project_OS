'use client';

import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { ALL_PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';

import { setMemberActiveAction, setMemberOverrideAction, setMemberRoleAction } from './actions';

/** Rótulos das funções atribuíveis (a autoridade real é `assertCanAssignRole`, server-side). */
const ROLE_LABELS: Record<string, string> = {
  gestor: 'Gestor',
  doctor: 'Médico',
  attendant: 'Recepção',
  financial: 'Financeiro',
};

const PERMISSION_LABELS: Partial<Record<Permission, string>> = {
  'view:agenda': 'Ver agenda',
  'edit:agenda': 'Editar agenda',
  'manage:procedures': 'Gerenciar procedimentos',
  'manage:availability': 'Gerenciar disponibilidade',
  'view:patient': 'Ver pacientes',
  'create:patient': 'Criar pacientes',
  'edit:patient': 'Editar pacientes',
  'delete:patient': 'Excluir pacientes',
  'export:patient': 'Exportar pacientes',
  'view:prontuario': 'Ver prontuário',
  'create:prontuario': 'Criar prontuário',
  'sign:prontuario': 'Assinar prontuário',
  'view:prescription': 'Ver prescrições',
  'create:prescription': 'Criar prescrições',
  'view:financial': 'Ver financeiro',
  'manage:financial': 'Gerenciar financeiro',
  'operate:caixa': 'Operar caixa',
  'view:audit': 'Ver auditoria',
  'export:audit': 'Exportar auditoria',
  'manage:employees': 'Gerenciar equipe',
  'manage:permissions': 'Gerenciar permissões',
  'manage:settings': 'Gerenciar configurações',
  'manage:agent': 'Gerenciar agente IA',
  'view:consultorio': 'Ver consultório',
  'view:conversations': 'Ver conversas IA',
  'manage:conversations': 'Gerenciar conversas IA',
};

export interface MemberRowActionsProps {
  userId: string;
  nome: string;
  role: string;
  ativo: boolean;
  /** Funções que o ator PODE atribuir (calculado no servidor via role-matrix). */
  assignableRoles: readonly string[];
  overrides: Array<{ permission: Permission; granted: boolean }>;
  canManagePermissions: boolean;
}

/**
 * Ações de linha para membros ACEITOS (I-2 — ciclo de vida). Escada de navegação
 * (ADR-031): Dropdown → Dialog. Só aparece para alvos mutáveis (a página já filtra
 * owner/super_admin e o próprio usuário).
 *
 * - Trocar função: Select das funções atribuíveis → setMemberRoleAction.
 * - Desativar: se o médico tem agenda futura/consulta aberta, a action devolve
 *   `blocked` e a UI mostra o que remanejar + oferece "Desativar mesmo assim"
 *   (override auditado, ADR-032 §4).
 * - Reativar: um clique.
 */
export function MemberRowActions({
  userId,
  nome,
  role,
  ativo,
  assignableRoles,
  overrides,
  canManagePermissions,
}: MemberRowActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [roleOpen, setRoleOpen] = useState(false);
  const [nextRole, setNextRole] = useState(role);
  const [permissionsOpen, setPermissionsOpen] = useState(false);

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  // Estado do bloqueio ADR-032 §4: quando setado, o Dialog vira "desativar mesmo assim".
  const [blocked, setBlocked] = useState<{ futureCount: number; openCount: number } | null>(null);

  function handleRoleChange() {
    if (nextRole === role) {
      setRoleOpen(false);
      return;
    }
    start(async () => {
      const res = await setMemberRoleAction({ userId, role: nextRole });
      if ('ok' in res) {
        toast.success('Função atualizada', `${nome} agora é ${ROLE_LABELS[nextRole] ?? nextRole}.`);
        setRoleOpen(false);
        router.refresh();
      } else {
        toast.error('Não foi possível trocar a função', res.error);
      }
    });
  }

  function handlePermissionChange(permission: Permission, value: string) {
    const granted = value === 'grant' ? true : value === 'deny' ? false : null;
    start(async () => {
      const res = await setMemberOverrideAction({ userId, permission, granted });
      if ('ok' in res) {
        toast.success('Permissão atualizada', `${PERMISSION_LABELS[permission] ?? permission}.`);
        router.refresh();
      } else {
        toast.error('Não foi possível atualizar a permissão', res.error);
      }
    });
  }

  function runDeactivate(force: boolean) {
    start(async () => {
      const res = await setMemberActiveAction({ userId, active: false, force });
      if ('ok' in res) {
        toast.success('Acesso desativado', `${nome} perdeu o acesso à clínica.`);
        setDeactivateOpen(false);
        setBlocked(null);
        router.refresh();
      } else if ('blocked' in res) {
        // Primeira tentativa barrada: mostra o que remanejar + oferece o override.
        setBlocked({ futureCount: res.futureCount, openCount: res.openCount });
      } else {
        toast.error('Não foi possível desativar', res.error);
      }
    });
  }

  function handleReactivate() {
    start(async () => {
      const res = await setMemberActiveAction({ userId, active: true });
      if ('ok' in res) {
        toast.success('Acesso reativado', `${nome} voltou a ter acesso.`);
        router.refresh();
      } else if ('error' in res) {
        toast.error('Não foi possível reativar', res.error);
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" icon aria-label={`Ações de ${nome}`}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {assignableRoles.length > 0 ? (
            <DropdownMenuItem
              onSelect={() => {
                setNextRole(role);
                setRoleOpen(true);
              }}
            >
              Trocar função
            </DropdownMenuItem>
          ) : null}
          {canManagePermissions ? (
            <DropdownMenuItem onSelect={() => setPermissionsOpen(true)}>
              Permissões individuais
            </DropdownMenuItem>
          ) : null}
          {ativo ? (
            <DropdownMenuItem
              danger
              onSelect={() => {
                setBlocked(null);
                setDeactivateOpen(true);
              }}
            >
              Desativar acesso
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={pending} onSelect={handleReactivate}>
              Reativar acesso
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Trocar função */}
      <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="min-w-0">
              <DialogTitle>Trocar função de {nome}</DialogTitle>
              <DialogDescription>
                A mudança vale imediatamente — a sessão do usuário é revalidada no próximo acesso.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody>
            <Label htmlFor="member-role">Função</Label>
            <Select
              id="member-role"
              value={nextRole}
              onChange={(e) => setNextRole(e.currentTarget.value)}
            >
              {[role, ...assignableRoles.filter((r) => r !== role)].map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r] ?? r}
                </option>
              ))}
            </Select>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancelar</Button>
            </DialogClose>
            <Button onClick={handleRoleChange} disabled={pending || nextRole === role}>
              Salvar função
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Overrides granulares — recurso dos planos Clínica e Pro. */}
      <Dialog open={permissionsOpen} onOpenChange={setPermissionsOpen}>
        <DialogContent>
          <DialogHeader>
            <div className="min-w-0">
              <DialogTitle>Permissões de {nome}</DialogTitle>
              <DialogDescription>
                Padrão usa as permissões da função. Permitir ou bloquear cria um ajuste individual.
              </DialogDescription>
            </div>
          </DialogHeader>
          <DialogBody className="max-h-[60vh] space-y-3 overflow-y-auto">
            {ALL_PERMISSIONS.map((permission) => {
              const override = overrides.find((item) => item.permission === permission);
              const value = override ? (override.granted ? 'grant' : 'deny') : 'default';
              return (
                <div key={permission} className="flex items-center justify-between gap-3">
                  <Label htmlFor={`permission-${userId}-${permission}`}>
                    {PERMISSION_LABELS[permission] ?? permission}
                  </Label>
                  <Select
                    id={`permission-${userId}-${permission}`}
                    value={value}
                    onChange={(event) =>
                      handlePermissionChange(permission, event.currentTarget.value)
                    }
                    disabled={pending}
                  >
                    <option value="default">Padrão da função</option>
                    <option value="grant">Permitir</option>
                    <option value="deny">Bloquear</option>
                  </Select>
                </div>
              );
            })}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Fechar</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desativar — com o caminho de bloqueio ADR-032 §4 */}
      {blocked ? (
        <ConfirmDialog
          open={deactivateOpen}
          onOpenChange={(o) => {
            setDeactivateOpen(o);
            if (!o) setBlocked(null);
          }}
          tone="danger"
          title="Este médico ainda tem compromissos"
          description={`${nome} tem ${blocked.futureCount} agendamento(s) futuro(s)${
            blocked.openCount > 0 ? ` e ${blocked.openCount} consulta(s) em aberto` : ''
          }. O ideal é remanejar antes. Desativar mesmo assim mantém o histórico, mas a agenda futura fica sem responsável.`}
          confirmLabel="Desativar mesmo assim"
          cancelLabel="Voltar"
          loading={pending}
          action={() => runDeactivate(true)}
        />
      ) : (
        <ConfirmDialog
          open={deactivateOpen}
          onOpenChange={setDeactivateOpen}
          tone="danger"
          title="Desativar acesso"
          description={`${nome} perde o acesso à clínica imediatamente. O histórico é preservado e o acesso pode ser reativado depois.`}
          confirmLabel="Desativar acesso"
          cancelLabel="Voltar"
          loading={pending}
          action={() => runDeactivate(false)}
        />
      )}
    </>
  );
}
