'use client';

import { useEffect, useRef, useState } from 'react';

import { readOnboardingInviteToken } from '@/lib/auth/onboarding-invite-fragment';

import { bootstrapJoinAction, type JoinBootstrapResult } from './bootstrap';
import { JoinWizard } from './[token]/join-wizard';

type JoinView =
  | { kind: 'loading' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'completed' }
  | ({ kind: 'ready'; token: string } & Extract<JoinBootstrapResult, { kind: 'ready' }>);

function InvalidJoin({ reason }: { reason: string }) {
  return (
    <div className="wiz scene-anim">
      <div className="wiz-main">
        <div className="wiz-card done">
          <h1>Convite indisponível</h1>
          <p>{reason}</p>
          <p className="foot-secure">Peça um novo link ao administrador da plataforma.</p>
        </div>
      </div>
    </div>
  );
}

function AlreadyActivated() {
  return (
    <div className="wiz scene-anim">
      <div className="wiz-main">
        <div className="wiz-card done">
          <div className="mark">🎉</div>
          <h1>Clínica já ativada</h1>
          <p>Este convite já foi concluído. Sua clínica está pronta.</p>
          <a className="btn block" href="/dashboard" style={{ marginTop: 'var(--sp-6)' }}>
            Entrar no painel
          </a>
        </div>
      </div>
    </div>
  );
}

export function JoinEntry() {
  const [view, setView] = useState<JoinView>({ kind: 'loading' });
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const rawToken = readOnboardingInviteToken(window.location.hash);
    // O fragmento nunca deve permanecer na barra, no histórico ou ser copiado
    // por engano. Ele já foi lido e fica apenas no estado desta aba.
    window.history.replaceState(window.history.state, '', window.location.pathname);

    if (!rawToken) {
      setView({ kind: 'invalid', reason: 'Este convite é inválido, expirou ou já foi utilizado.' });
      return;
    }

    let active = true;
    void bootstrapJoinAction(rawToken)
      .then((result) => {
        if (!active) return;
        if (result.kind === 'ready') {
          setView({ ...result, token: rawToken });
        } else {
          setView(result);
        }
      })
      .catch(() => {
        if (!active) return;
        setView({
          kind: 'invalid',
          reason: 'Não foi possível validar este convite agora. Tente novamente em instantes.',
        });
      });
    return () => {
      active = false;
    };
  }, []);

  if (view.kind === 'loading') {
    return (
      <div className="wiz scene-anim">
        <div className="wiz-main">
          <div className="wiz-card done">
            <h1>Validando convite…</h1>
            <p>Estamos preparando seu cadastro com segurança.</p>
          </div>
        </div>
      </div>
    );
  }
  if (view.kind === 'invalid') return <InvalidJoin reason={view.reason} />;
  if (view.kind === 'completed') return <AlreadyActivated />;

  return (
    <JoinWizard
      token={view.token}
      initialState={view.initialState}
      suggestedEmail={view.suggestedEmail}
      suggestedPlanId={view.suggestedPlanId}
      plans={view.plans}
    />
  );
}
