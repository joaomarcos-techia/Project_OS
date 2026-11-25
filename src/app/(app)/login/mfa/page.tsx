'use client';

import { useActionState } from 'react';

import { LoginFrame, LoginIntro, loginFrame } from '@/components/shared/login-frame';
import { signupFrame } from '@/components/shared/signup-frame';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { switchAccountAction, verifyMfaAction, type MfaActionState } from './actions';

const INITIAL: MfaActionState = { error: null };

export default function MfaPage() {
  const [state, formAction, pending] = useActionState(verifyMfaAction, INITIAL);
  const [switchState, switchFormAction, switchPending] = useActionState(
    switchAccountAction,
    INITIAL,
  );
  const busy = pending || switchPending;

  return (
    <LoginFrame>
      <div className={loginFrame.view}>
        <LoginIntro
          title="Verificação em duas etapas"
          lead="Abra o aplicativo autenticador e digite o código de 6 dígitos da Qoro."
        />

        <div className={loginFrame.form}>
          <form action={formAction} className={loginFrame.form}>
            <div className={loginFrame.field}>
              <Label htmlFor="mfa-code">Código de 6 dígitos</Label>
              <Input
                id="mfa-code"
                name="code"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                disabled={busy}
                aria-describedby="mfa-code-hint"
                className={loginFrame.code}
              />
              <span id="mfa-code-hint" className={signupFrame.hint}>
                O código muda a cada 30 segundos.
              </span>
            </div>
            {state.error ? <Alert variant="danger">{state.error}</Alert> : null}
            <Button type="submit" loading={pending} disabled={switchPending} className="w-full">
              Confirmar
            </Button>
          </form>

          <form action={switchFormAction} className={signupFrame.note}>
            Entrou com a conta errada?{' '}
            <button type="submit" disabled={pending || switchPending} className={loginFrame.link}>
              Usar outra conta
            </button>
          </form>
          {switchState.error ? <Alert variant="danger">{switchState.error}</Alert> : null}
        </div>
      </div>
    </LoginFrame>
  );
}
