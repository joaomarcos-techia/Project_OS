'use client';

/**
 * Conexão do WhatsApp da clínica (Meta Embedded Signup). O cliente só lida com o
 * `code` (e os hints waba/phone) — o token NUNCA chega aqui. Estados: desconectado
 * / conectado / erro / configuração pendente.
 */
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { formatDatePt } from '@/lib/format';

import { connectWhatsappAction, disconnectWhatsappAction } from './actions';
import type { WhatsappStatusDTO } from './data';

// --- Facebook JS SDK (mínimo, tipado) --------------------------------------
interface FbLoginResponse {
  authResponse?: { code?: string } | null;
  status?: string;
}
interface FbSdk {
  init(params: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }): void;
  login(cb: (response: FbLoginResponse) => void, opts: Record<string, unknown>): void;
}
declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

interface SessionInfo {
  wabaId?: string | undefined;
  phoneId?: string | undefined;
}

export function WhatsappConnect({
  status,
  appId,
  configId,
  graphVersion,
  ready,
}: {
  status: WhatsappStatusDTO;
  appId: string | null;
  configId: string | null;
  graphVersion: string;
  ready: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sdkReady, setSdkReady] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const sessionInfo = useRef<SessionInfo | null>(null);

  // Listener do Embedded Signup: captura waba_id/phone_number_id (hints) — o
  // servidor revalida com o token (anti-sequestro), então isto é só sugestão.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string' || !event.origin.endsWith('facebook.com')) return;
      try {
        const parsed = JSON.parse(event.data) as {
          type?: string;
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string };
        };
        if (parsed?.type === 'WA_EMBEDDED_SIGNUP') {
          sessionInfo.current = {
            wabaId: parsed.data?.waba_id,
            phoneId: parsed.data?.phone_number_id,
          };
        }
      } catch {
        /* ignore non-JSON postMessages */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const initSdk = () => {
    if (!appId) return;
    window.FB?.init({ appId, version: graphVersion, cookie: true, xfbml: false });
    setSdkReady(true);
  };

  const launchSignup = () => {
    setError(null);
    const FB = window.FB;
    if (!FB || !configId) {
      setError({ code: 'SDK', message: 'O SDK do Facebook não carregou. Recarregue a página.' });
      return;
    }
    FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) return; // popup fechado / negado — não é erro de sistema
        const hint = sessionInfo.current;
        startTransition(async () => {
          const r = await connectWhatsappAction({
            code,
            wabaHint: hint?.wabaId,
            phoneHint: hint?.phoneId,
          });
          if (!r.ok) {
            setError({ code: r.code, message: r.message });
            return;
          }
          router.refresh();
        });
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' },
      },
    );
  };

  const disconnect = () => {
    setError(null);
    startTransition(async () => {
      const r = await disconnectWhatsappAction();
      if (!r.ok) {
        setError({ code: r.code, message: r.message });
        return;
      }
      router.refresh();
    });
  };

  return (
    <div>
      {ready && appId ? (
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          strategy="afterInteractive"
          onLoad={initSdk}
        />
      ) : null}

      <div className="page-head">
        <div className="ph-crumb">
          Configurações <span className="sep">›</span> <b>WhatsApp</b>
        </div>
        <h1 className="ph-title">WhatsApp da clínica</h1>
        <p className="ph-desc">
          Conecte o número para o Agente de IA atender pacientes pelo WhatsApp.
        </p>
      </div>

      {error ? (
        <div
          className="panel"
          style={{
            marginBottom: 'var(--sp-4)',
            borderColor: 'var(--danger-500)',
            background: 'color-mix(in oklch, var(--danger-500) 6%, var(--surface))',
          }}
        >
          <b style={{ color: 'var(--danger-700)' }}>Não foi possível conectar</b>
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 0' }}>{error.message}</p>
          <p style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
            Código: {error.code}
          </p>
        </div>
      ) : null}

      <div className="panel" style={{ maxWidth: 560 }}>
        {status.connected ? (
          <ConnectedView status={status} onDisconnect={disconnect} pending={pending} />
        ) : (
          <DisconnectedView
            ready={ready}
            sdkReady={sdkReady}
            pending={pending}
            onConnect={launchSignup}
          />
        )}
      </div>
    </div>
  );
}

function ConnectedView({
  status,
  onDisconnect,
  pending,
}: {
  status: WhatsappStatusDTO;
  onDisconnect: () => void;
  pending: boolean;
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--sp-3)' }}>
        <h4 style={{ margin: 0 }}>WhatsApp conectado</h4>
        <span className="badge green">
          <span className="bdot" />
          Ativo
        </span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0, fontSize: 14 }}>
        <dt style={{ color: 'var(--text-3)' }}>Número</dt>
        <dd style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>{status.phoneNumberMasked ?? '—'}</dd>
        <dt style={{ color: 'var(--text-3)' }}>Conectado em</dt>
        <dd style={{ margin: 0 }}>{formatDatePt(status.verifiedAt)}</dd>
      </dl>
      <div style={{ marginTop: 'var(--sp-4)' }}>
        <button className="btn danger sm" onClick={onDisconnect} disabled={pending}>
          {pending ? 'Desconectando…' : 'Desconectar'}
        </button>
      </div>
    </>
  );
}

function DisconnectedView({
  ready,
  sdkReady,
  pending,
  onConnect,
}: {
  ready: boolean;
  sdkReady: boolean;
  pending: boolean;
  onConnect: () => void;
}) {
  return (
    <>
      <h4 style={{ marginTop: 0 }}>Conecte o WhatsApp da clínica</h4>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 var(--sp-3)' }}>
        Com o número conectado, o Agente de IA poderá:
      </p>
      <ul style={{ fontSize: 14, color: 'var(--text)', margin: '0 0 var(--sp-4)', paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        <li>✓ responder pacientes</li>
        <li>✓ confirmar consultas</li>
        <li>✓ enviar lembretes</li>
        <li>✓ recuperar pagamentos</li>
      </ul>
      {ready ? (
        <button className="btn" onClick={onConnect} disabled={pending || !sdkReady}>
          {pending ? 'Conectando…' : !sdkReady ? 'Carregando…' : 'Conectar WhatsApp'}
        </button>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          A conexão automática ainda não está habilitada nesta instância. Fale com o suporte para
          conectar o WhatsApp da clínica.
        </p>
      )}
    </>
  );
}
