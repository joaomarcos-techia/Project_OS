'use client';

import { useActionState, useState } from 'react';

import {
  startEnrollAction,
  verifyEnrollAction,
  type EnrollResultState,
} from './actions';

const INITIAL: EnrollResultState = {
  step: 'idle',
  factorId: null,
  qrSvg: null,
  secret: null,
  error: null,
};

export function EnrollFlow() {
  const [enrollState, setEnrollState] = useState<EnrollResultState>(INITIAL);
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyEnrollAction,
    INITIAL,
  );
  const state = verifyState.step === 'done' ? verifyState : enrollState;

  if (state.step === 'done') {
    return (
      <div className="rounded border border-green-400 bg-green-50 p-4 text-sm text-green-900">
        TOTP ativado. Você poderá ser solicitado a digitar o código a cada login.
      </div>
    );
  }

  if (state.step === 'verifying' && state.factorId && state.qrSvg) {
    return (
      <form action={verifyAction} className="flex flex-col gap-3 rounded border border-gray-300 p-4">
        <p className="text-sm">
          1) Escaneie o QR no app autenticador. <b>Guarde o secret abaixo no seu
          gerenciador de senhas</b> — Supabase TOTP não emite backup codes.
        </p>
        {/* Supabase retorna data.totp.qr_code como data URL (data:image/svg+xml...). */}
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL não passa pelo next/image */}
        <img src={state.qrSvg} alt="QR Code TOTP" className="mx-auto h-48 w-48" />
        <div className="font-mono text-xs break-all rounded bg-gray-100 p-2">
          {state.secret}
        </div>
        <p className="text-sm">2) Digite o código de 6 dígitos para confirmar:</p>
        <input type="hidden" name="factorId" value={state.factorId} />
        <input
          name="code"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          required
          disabled={verifyPending}
          className="rounded border border-gray-300 px-3 py-2 text-center text-lg tracking-widest"
        />
        {(verifyState.error || enrollState.error) ? (
          <p className="rounded border border-red-400 bg-red-50 p-2 text-sm text-red-900">
            {verifyState.error ?? enrollState.error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={verifyPending}
          className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {verifyPending ? 'Verificando…' : 'Confirmar e ativar'}
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={async () => {
        const result = await startEnrollAction();
        setEnrollState(result);
      }}
      className="rounded bg-black px-3 py-2 text-sm font-medium text-white"
    >
      Ativar TOTP
    </button>
  );
}
