'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { toast } from '@/components/ui/use-toast';
import { isPractitionerRole } from '@/lib/auth/practitioner';
import { cn } from '@/lib/ui/cn';
import { uuidv4 } from '@/lib/ui/uuid';

import { inviteMemberAction, type InviteMemberInput } from './actions';

type Func = 'gestor' | 'doctor' | 'attendant' | 'financial';

/**
 * Convite de funcionário — Drawer (spec convite §Fase 1). Quem tem
 * `manage:employees` vê o botão. Progressive disclosure: a Função decide o resto.
 */
export function InviteDrawer({ ativos, seatLimit }: { ativos: number; seatLimit: number | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Func>('doctor');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [crm, setCrm] = useState('');
  const [crmUf, setCrmUf] = useState('');
  const [idemKey, setIdemKey] = useState(() => uuidv4());
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<number | null>(null);
  const [salvando, startSalvar] = useTransition();

  const atLimit = seatLimit != null && ativos >= seatLimit;

  function reset() {
    setRole('doctor');
    setNome('');
    setEmail('');
    setCrm('');
    setCrmUf('');
    setError(null);
    setUpgrade(null);
    setIdemKey(uuidv4()); // nova chave de idempotência para o próximo convite
  }

  function submit() {
    setError(null);
    setUpgrade(null);
    if (!nome.trim()) return setError('Informe o nome.');
    if (!email.trim()) return setError('Informe o e-mail.');

    const input: InviteMemberInput = {
      role,
      nome: nome.trim(),
      email: email.trim(),
      idempotencyKey: idemKey,
      ...(isPractitionerRole(role) ? { crm: crm.trim(), crmUf: crmUf.trim() } : {}),
    };

    startSalvar(async () => {
      try {
        const res = await inviteMemberAction(input);
        if ('ok' in res) {
          toast.success('Convite enviado', `Enviamos um link para ${input.nome} criar a senha.`);
          setOpen(false);
          reset();
          router.refresh();
        } else if ('upgrade' in res) {
          setUpgrade(res.limit);
        } else {
          setError(res.error);
        }
      } catch {
        setError('Não foi possível enviar o convite. Tente novamente.');
      }
    });
  }

  return (
    <div className="flex items-center gap-2.5">
      {seatLimit != null ? (
        <span
          className={cn(
            'text-(length:--fs-xs)',
            atLimit ? 'font-medium text-warning-700 dark:text-warning-200' : 'text-fg-subtle',
          )}
        >
          Usuários: {ativos} de {seatLimit}
        </span>
      ) : null}
      <Drawer
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DrawerTrigger asChild>
          <Button size="sm" disabled={atLimit}>
            <UserPlus className="size-3.5" />
            Convidar
          </Button>
        </DrawerTrigger>
        <DrawerContent>
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <DrawerHeader>
              <DrawerTitle>Convidar para a equipe</DrawerTitle>
            </DrawerHeader>
            <DrawerBody className="flex flex-col gap-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}
              {upgrade != null ? (
                <Alert variant="warning" title="Limite do plano atingido">
                  Seu plano permite {upgrade} usuário{upgrade === 1 ? '' : 's'}. Você atingiu o
                  limite — remova ou desative um usuário para adicionar outro.
                </Alert>
              ) : null}

              <Field label="Função" group>
                <Segmented
                  aria-label="Função do convidado"
                  options={[
                    { value: 'gestor', label: 'Gestor' },
                    { value: 'doctor', label: 'Médico' },
                    { value: 'attendant', label: 'Atendente' },
                    { value: 'financial', label: 'Financeiro' },
                  ]}
                  value={role}
                  onValueChange={setRole}
                />
              </Field>

              <Field label="Nome" htmlFor="team-invite-name">
                <Input
                  id="team-invite-name"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Nome completo"
                  autoComplete="off"
                />
              </Field>

              <Field
                label="E-mail para o convite"
                htmlFor="team-invite-email"
                hint="Enviaremos um link para essa pessoa criar a senha."
              >
                <Input
                  id="team-invite-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="pessoa@email.com"
                  autoComplete="off"
                />
              </Field>

              {isPractitionerRole(role) ? (
                <div className="flex gap-3">
                  <Field
                    label="CRM"
                    htmlFor="team-invite-crm"
                    hint="Opcional agora — necessário para emitir o primeiro documento."
                    className="flex-1"
                  >
                    <Input
                      id="team-invite-crm"
                      value={crm}
                      onChange={(e) => setCrm(e.target.value)}
                      placeholder="123456"
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="UF" htmlFor="team-invite-crm-uf" className="w-24">
                    <Input
                      id="team-invite-crm-uf"
                      value={crmUf}
                      onChange={(e) => setCrmUf(e.target.value.toUpperCase())}
                      placeholder="SP"
                      maxLength={2}
                      autoComplete="off"
                    />
                  </Field>
                </div>
              ) : null}
            </DrawerBody>
            <DrawerFooter>
              <Button type="submit" loading={salvando}>
                Enviar convite
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
