'use client';

/**
 * Conexão do WhatsApp da clínica (Meta Embedded Signup). O cliente só lida com o
 * `code` (e os hints waba/phone) — o token NUNCA chega aqui. Estados: desconectado
 * / conectado / erro / configuração pendente.
 */
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

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

type EmbeddedSignupEvent = 'CANCEL' | 'ERROR' | 'FINISH' | 'FINISH_ONLY_WABA';

// V13 (auditoria de segurança): allowlist EXATA de origens do postMessage. O
// `endsWith('facebook.com')` anterior era burlável (ex.: `https://evil-facebook.com`
// satisfaz `endsWith`), pois falta a fronteira de subdomínio. Match exato é a
// prática correta de postMessage. (O servidor já revalida os hints contra o
// token OAuth — isto é defesa adicional na fronteira do cliente.)
const ALLOWED_FB_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com']);

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
  const [disconnecting, setDisconnecting] = useState(false);
  const [locallyDisconnected, setLocallyDisconnected] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [registrationPin, setRegistrationPin] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const sessionInfo = useRef<SessionInfo | null>(null);
  const oauthCode = useRef<string | null>(null);
  const registrationPinRef = useRef('');
  const connectionStarted = useRef(false);

  useEffect(() => {
    if (status.connected) setLocallyDisconnected(false);
  }, [status.connected]);

  const connectCompletedSignup = useCallback(
    (code: string, hint: SessionInfo) => {
      if (connectionStarted.current) return;
      connectionStarted.current = true;
      oauthCode.current = null;
      startTransition(async () => {
        try {
          const r = await connectWhatsappAction({
            code,
            registrationPin: registrationPinRef.current,
            wabaHint: hint.wabaId,
            phoneHint: hint.phoneId,
          });
          if (!r.ok) {
            connectionStarted.current = false;
            setError({ code: r.code, message: r.message });
            return;
          }
          router.refresh();
        } catch {
          connectionStarted.current = false;
          setError({
            code: 'CONNECTION_FAILED',
            message: 'Não foi possível concluir a conexão. Tente novamente.',
          });
        }
      });
    },
    [router, startTransition],
  );

  // Só o evento FINISH autoriza trocar o OAuth code por token. O callback do
  // FB.login pode receber um code mesmo quando o usuário volta/cancela uma
  // etapa do popup; sem esse gate a tela iniciava uma action e ficava em loading.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string' || !ALLOWED_FB_ORIGINS.has(event.origin)) return;
      try {
        const parsed = JSON.parse(event.data) as {
          type?: string;
          event?: EmbeddedSignupEvent;
          data?: { waba_id?: string; phone_number_id?: string };
        };
        if (parsed?.type !== 'WA_EMBEDDED_SIGNUP') return;

        if (parsed.event === 'CANCEL') {
          sessionInfo.current = null;
          oauthCode.current = null;
          setError({
            code: 'CANCELLED',
            message: 'Conexão cancelada. Nenhuma alteração foi feita.',
          });
          return;
        }
        if (parsed.event === 'ERROR') {
          sessionInfo.current = null;
          oauthCode.current = null;
          setError({
            code: 'META_SIGNUP_ERROR',
            message: 'A Meta não concluiu a conexão. Tente novamente.',
          });
          return;
        }
        if (parsed.event === 'FINISH' || parsed.event === 'FINISH_ONLY_WABA') {
          const hint = {
            wabaId: parsed.data?.waba_id,
            phoneId: parsed.data?.phone_number_id,
          };
          sessionInfo.current = hint;
          if (oauthCode.current) connectCompletedSignup(oauthCode.current, hint);
        }
      } catch {
        /* ignore non-JSON postMessages */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [connectCompletedSignup]);

  const initSdk = () => {
    if (!appId) return;
    window.FB?.init({ appId, version: graphVersion, cookie: true, xfbml: false });
    setSdkReady(true);
  };

  const launchSignup = () => {
    setError(null);
    if (!/^\d{6}$/.test(registrationPin)) {
      setError({
        code: 'REGISTRATION_PIN',
        message: 'Informe um PIN numérico de 6 dígitos para ativar o número na Meta.',
      });
      return;
    }
    const FB = window.FB;
    if (!FB || !configId) {
      setError({ code: 'SDK', message: 'O SDK do Facebook não carregou. Recarregue a página.' });
      return;
    }
    sessionInfo.current = null;
    oauthCode.current = null;
    connectionStarted.current = false;
    FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setError({
            code: 'CANCELLED',
            message: 'Conexão cancelada. Nenhuma alteração foi feita.',
          });
          return;
        }
        oauthCode.current = code;
        if (sessionInfo.current) connectCompletedSignup(code, sessionInfo.current);
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3' },
      },
    );
  };

  const setPin = (pin: string) => {
    registrationPinRef.current = pin;
    setRegistrationPin(pin);
  };

  const disconnect = async () => {
    setError(null);
    setDisconnecting(true);
    try {
      const r = await disconnectWhatsappAction();
      if (!r.ok) {
        setError({ code: r.code, message: r.message });
        return;
      }
      setLocallyDisconnected(true);
      router.refresh();
    } catch {
      setError({
        code: 'DISCONNECT_FAILED',
        message: 'Não foi possível desconectar o WhatsApp. Tente novamente.',
      });
    } finally {
      setDisconnecting(false);
    }
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
          <p
            style={{
              fontSize: 11,
              color: 'var(--text-3)',
              fontFamily: 'var(--font-mono)',
              marginTop: 6,
            }}
          >
            Código: {error.code}
          </p>
        </div>
      ) : null}

      <div className="panel" style={{ maxWidth: 560 }}>
        {status.connected && !locallyDisconnected ? (
          <ConnectedView status={status} onDisconnect={disconnect} pending={disconnecting} />
        ) : (
          <DisconnectedView
            ready={ready}
            sdkReady={sdkReady}
            pending={pending}
            registrationPin={registrationPin}
            onRegistrationPinChange={setPin}
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
      <dl
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '8px 16px',
          margin: 0,
          fontSize: 14,
        }}
      >
        <dt style={{ color: 'var(--text-3)' }}>Número</dt>
        <dd style={{ margin: 0, fontFamily: 'var(--font-mono)' }}>
          {status.phoneNumberMasked ?? '—'}
        </dd>
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
  registrationPin,
  onRegistrationPinChange,
  onConnect,
}: {
  ready: boolean;
  sdkReady: boolean;
  pending: boolean;
  registrationPin: string;
  onRegistrationPinChange: (pin: string) => void;
  onConnect: () => void;
}) {
  return (
    <>
      <h4 style={{ marginTop: 0 }}>Conecte o WhatsApp da clínica</h4>
      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '4px 0 var(--sp-3)' }}>
        Com o número conectado, o Agente de IA poderá:
      </p>
      <ul
        style={{
          fontSize: 14,
          color: 'var(--text)',
          margin: '0 0 var(--sp-4)',
          paddingLeft: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 6,
        }}
      >
        <li>✓ responder pacientes</li>
        <li>✓ confirmar consultas</li>
        <li>✓ enviar lembretes</li>
        <li>✓ recuperar pagamentos</li>
      </ul>
      <label
        htmlFor="whatsapp-registration-pin"
        style={{ display: 'grid', gap: 6, marginBottom: 'var(--sp-4)', fontSize: 13 }}
      >
        <span>PIN de ativação do WhatsApp</span>
        <input
          id="whatsapp-registration-pin"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          pattern="[0-9]{6}"
          maxLength={6}
          value={registrationPin}
          onChange={(event) => onRegistrationPinChange(event.target.value.replace(/\D/g, ''))}
          disabled={pending}
          aria-describedby="whatsapp-registration-pin-help"
          className="h-10 rounded-(--r-sm) border border-border bg-surface px-3 text-sm"
        />
        <span id="whatsapp-registration-pin-help" style={{ color: 'var(--text-3)' }}>
          Crie e guarde um PIN numérico de 6 dígitos. Ele ativa o número na Cloud API e não é salvo
          pelo ClinicaOS.
        </span>
      </label>
      {ready ? (
        <button
          className="btn"
          onClick={onConnect}
          disabled={pending || !sdkReady || registrationPin.length !== 6}
        >
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
