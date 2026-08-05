'use client';

import { useActionState, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { startEnrollAction, verifyEnrollAction, type EnrollResultState } from './actions';

const INITIAL: EnrollResultState = {
  step: 'idle',
  factorId: null,
  qrSvg: null,
  secret: null,
  error: null,
};

export function EnrollFlow() {
  const [enrollState, setEnrollState] = useState<EnrollResultState>(INITIAL);
  const [verifyState, verifyAction, verifyPending] = useActionState(verifyEnrollAction, INITIAL);
  const state = verifyState.step === 'done' ? verifyState : enrollState;

  if (state.step === 'done') {
    return (
      <Alert variant="success">
        TOTP ativado. Você poderá ser solicitado a digitar o código a cada login.
      </Alert>
    );
  }

  if (state.step === 'verifying' && state.factorId && state.qrSvg) {
    return (
      <form
        action={verifyAction}
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <p className="text-sm">
          1) Escaneie o QR no app autenticador.{' '}
          <b>Guarde o secret abaixo no seu gerenciador de senhas</b> — Supabase TOTP não emite
          backup codes.
        </p>
        {/* Supabase retorna data.totp.qr_code como data URL (data:image/svg+xml...). */}
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL não passa pelo next/image */}
        <img src={state.qrSvg} alt="QR Code TOTP" className="mx-auto h-48 w-48" />
        <div className="break-all rounded-md bg-surface-inset p-2 font-mono text-xs">
          {state.secret}
        </div>
        <p className="text-sm">2) Digite o código de 6 dígitos para confirmar:</p>
        <input type="hidden" name="factorId" value={state.factorId} />
        <Input
          name="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          disabled={verifyPending}
          aria-label="Código de 6 dígitos"
          className="text-center text-lg tracking-[0.4em]"
        />
        {verifyState.error || enrollState.error ? (
          <Alert variant="danger">{verifyState.error ?? enrollState.error}</Alert>
        ) : null}
        <Button type="submit" className="self-start" loading={verifyPending}>
          Confirmar e ativar
        </Button>
      </form>
    );
  }

  return (
    <Button
      type="button"
      onClick={async () => {
        const result = await startEnrollAction();
        setEnrollState(result);
      }}
    >
      Ativar TOTP
    </Button>
  );
}
