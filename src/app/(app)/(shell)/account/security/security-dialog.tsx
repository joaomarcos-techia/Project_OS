'use client';

import { ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogHeaderIcon,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { startEnrollAction, verifyEnrollAction, type EnrollResultState } from './actions';

const INITIAL: EnrollResultState = {
  step: 'idle',
  factorId: null,
  qrSvg: null,
  secret: null,
  error: null,
};

/**
 * Ativação do TOTP em diálogo.
 *
 * O QR, o secret e o campo de seis dígitos são uma tarefa curta e modal: ou se
 * conclui, ou se abandona. Expandidos no corpo da página eles empurravam o
 * resto da tela para baixo e deixavam a página em dois estados muito diferentes
 * conforme o passo.
 *
 * O enroll dispara no clique do gatilho, não na abertura: cada clique cria um
 * fator não-verificado na Supabase, e amarrar isso ao ciclo de vida do diálogo
 * multiplicaria fatores órfãos a cada abrir e fechar.
 *
 * A REMOÇÃO não vive aqui — ela exige sessão AAL2, tem limite de tentativas
 * próprio e comunica falha por redirect com query param. Continua na página.
 */
export function TotpSetupDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [starting, startTransition] = useTransition();
  const [enrollState, setEnrollState] = useState<EnrollResultState>(INITIAL);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyEnrollAction, INITIAL);

  const done = verifyState.step === 'done';

  useEffect(() => {
    if (!done) return;
    // Fecha e recarrega: quem confirma quer ver a conta protegida na página, não
    // um diálogo de sucesso para dispensar.
    setOpen(false);
    setEnrollState(INITIAL);
    router.refresh();
  }, [done, router]);

  const start = () => {
    startTransition(async () => {
      const result = await startEnrollAction();
      setEnrollState(result);
      setOpen(true);
    });
  };

  const error = verifyState.error ?? enrollState.error;

  return (
    <>
      <Button type="button" onClick={start} loading={starting}>
        Ativar TOTP
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setEnrollState(INITIAL);
        }}
      >
        <DialogContent aria-describedby="totp-dialog-description">
          <DialogHeader>
            <DialogHeaderIcon>
              <ShieldCheck />
            </DialogHeaderIcon>
            <div className="min-w-0">
              <DialogTitle>Ativar autenticação em duas etapas</DialogTitle>
              <DialogDescription id="totp-dialog-description">
                Use um app autenticador (Authy, Google Authenticator, 1Password).
              </DialogDescription>
            </div>
          </DialogHeader>

          {enrollState.factorId && enrollState.qrSvg ? (
            <form action={verifyAction}>
              <DialogBody className="flex flex-col gap-(--sp-5)">
                <div className="flex flex-col gap-2">
                  <p className="text-(length:--fs-body-sm) font-medium">
                    1. Escaneie o QR no app autenticador
                  </p>
                  {/* Supabase devolve o QR como data URL (data:image/svg+xml...). */}
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL não passa pelo next/image */}
                  <img
                    src={enrollState.qrSvg}
                    alt="QR Code TOTP"
                    className="mx-auto size-44 rounded-(--r-md) bg-white p-2"
                  />
                  <p className="text-(length:--fs-caption) text-fg-muted">
                    Guarde o código abaixo no seu gerenciador de senhas — o TOTP da Supabase não
                    emite códigos de recuperação.
                  </p>
                  <div className="rounded-(--r-sm) bg-surface-inset p-2 text-center font-mono text-(length:--fs-caption) break-all select-all">
                    {enrollState.secret}
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-(length:--fs-body-sm) font-medium">2. Confirme no app</p>
                  <input type="hidden" name="factorId" value={enrollState.factorId} />
                  {/* Rótulo visível é o nome acessível inteiro (WCAG 2.5.3): sem
                      `aria-label` competindo com o texto que a pessoa lê. */}
                  <Label htmlFor="totp-code">Código de 6 dígitos</Label>
                  <Input
                    id="totp-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    required
                    autoFocus
                    disabled={verifyPending}
                    className="text-center text-(length:--fs-h3) tracking-[0.4em]"
                  />
                </div>

                {error ? <Alert variant="danger">{error}</Alert> : null}
              </DialogBody>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" loading={verifyPending}>
                  Confirmar e ativar
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <DialogBody>
              <Alert variant="danger">
                {error ?? 'Não foi possível iniciar a ativação. Tente novamente.'}
              </Alert>
            </DialogBody>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
