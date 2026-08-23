'use client';

/**
 * Conexão do WhatsApp da clínica (Meta Embedded Signup). O cliente só lida com o
 * `code` (e os hints waba/phone) — o token NUNCA chega aqui. Estados: desconectado
 * / conectado / erro / configuração pendente.
 */
import Script from 'next/script';
import { useRouter } from 'next/navigation';
import { Check, CircleCheck, MessageCircle, WifiOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { Separator } from '@/components/ui/separator';
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

  const viewState =
    status.connected && !locallyDisconnected
      ? 'connected'
      : status.degraded && !locallyDisconnected
        ? 'degraded'
        : 'disconnected';

  return (
    <div className="min-w-0">
      {ready && appId ? (
        <Script
          src="https://connect.facebook.net/en_US/sdk.js"
          strategy="afterInteractive"
          onLoad={initSdk}
        />
      ) : null}

      <PageHeader crumbs={[{ label: 'Configurações', href: '/configuracoes' }, { label: 'WhatsApp' }]}
        title="WhatsApp da clínica"
        description="Gerencie o canal usado pelo Agente de IA para atender pacientes."
      />

      {error ? (
        <Alert
          variant="danger"
          title="Não foi possível concluir a ação"
          className="mb-(--sp-4) max-w-190"
        >
          <p className="text-pretty">{error.message}</p>
          <p className="mt-1.5 font-mono text-(length:--fs-2xs) text-fg-subtle">
            Código: {error.code}
          </p>
        </Alert>
      ) : null}

      <Card
        role="region"
        aria-labelledby="whatsapp-connection-title"
        data-whatsapp-state={viewState}
        className="max-w-190 overflow-hidden"
      >
        {viewState === 'connected' ? (
          <ConnectedView status={status} onDisconnect={disconnect} pending={disconnecting} />
        ) : viewState === 'degraded' ? (
          // META-001 — existe número ativo, mas o canal não está operante. Cair
          // no DisconnectedView aqui esconderia a conexão quebrada atrás de um
          // convite para conectar, que foi o que permitiu o achado passar.
          <DegradedView
            status={status}
            ready={ready}
            sdkReady={sdkReady}
            pending={pending}
            registrationPin={registrationPin}
            onRegistrationPinChange={setPin}
            onReconnect={launchSignup}
            onDisconnect={disconnect}
            disconnecting={disconnecting}
          />
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
      </Card>
    </div>
  );
}

function ConnectionStateHeader({
  icon,
  title,
  description,
  badge,
  badgeTone,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  badge: string;
  badgeTone: 'gray' | 'green' | 'amber' | 'red';
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border bg-surface-2 px-(--card-pad) py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-(--r-lg) border border-border bg-surface text-fg-muted shadow-xs [&>svg]:size-5"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2
            id="whatsapp-connection-title"
            className="text-balance text-(length:--fs-h4) font-semibold"
          >
            {title}
          </h2>
          <p className="mt-0.5 max-w-[52ch] text-pretty text-(length:--fs-sm) text-fg-muted">
            {description}
          </p>
        </div>
      </div>
      <Badge tone={badgeTone} dot className="self-start">
        {badge}
      </Badge>
    </div>
  );
}

function ConnectionDetails({ status }: { status: WhatsappStatusDTO }) {
  return (
    <dl className="grid gap-3 text-(length:--fs-sm) sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-(length:--fs-xs) font-medium text-fg-subtle">Número</dt>
        <dd className="mt-1 truncate font-mono text-fg">{status.phoneNumberMasked ?? '—'}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-(length:--fs-xs) font-medium text-fg-subtle">Conectado em</dt>
        <dd className="mt-1 font-mono text-fg">{formatDatePt(status.verifiedAt)}</dd>
      </div>
    </dl>
  );
}

function RegistrationPinField({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (pin: string) => void;
  disabled: boolean;
}) {
  const helpId = `${id}-help`;
  return (
    <Field
      label="PIN de ativação do WhatsApp"
      htmlFor={id}
      required
      hint={
        <span id={helpId}>
          Crie e guarde um PIN numérico de 6 dígitos. Ele ativa o número na Cloud API e não é salvo
          pela Qoro.
        </span>
      }
    >
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ''))}
        disabled={disabled}
        aria-describedby={helpId}
        className="min-h-(--hit-target) max-w-80 font-mono"
      />
    </Field>
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
  const verificationPending =
    status.health.verdict === 'indeterminate' && status.health.messages.length > 0;

  return (
    <>
      <ConnectionStateHeader
        icon={<CircleCheck />}
        title="WhatsApp conectado"
        description={
          verificationPending
            ? 'A última conexão válida foi preservada enquanto a Meta não responde à verificação.'
            : 'O número está vinculado e disponível para o atendimento automatizado.'
        }
        badge={verificationPending ? 'Verificação pendente' : 'Ativo'}
        badgeTone={verificationPending ? 'amber' : 'green'}
      />
      <div className="grid gap-4 p-(--card-pad)">
        <ConnectionDetails status={status} />
        {verificationPending ? (
          <Alert variant="warning" title="Verificação temporariamente indisponível">
            <ul className="grid list-disc gap-1 pl-4">
              {status.health.messages.map((message) => (
                <li key={message} className="text-pretty">
                  {message}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-pretty">
              O estado exibido é o da última verificação bem-sucedida.
            </p>
          </Alert>
        ) : null}
      </div>
      <div className="flex flex-col gap-3 border-t border-border bg-surface-2 px-(--card-pad) py-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[48ch] text-pretty text-(length:--fs-xs) text-fg-subtle">
          Desconectar interrompe o atendimento automatizado neste número.
        </p>
        <Button
          type="button"
          variant="danger"
          size="sm"
          loading={pending}
          onClick={onDisconnect}
          className="min-h-(--hit-target) w-full sm:w-auto"
        >
          Desconectar
        </Button>
      </div>
    </>
  );
}

/**
 * META-001 — número ativo com canal inoperante. A tela precisa dizer o que
 * parou de funcionar (o paciente escreve e ninguém recebe) e oferecer a
 * reconexão, sem expor WABA/app/token.
 */
function DegradedView({
  status,
  ready,
  sdkReady,
  pending,
  registrationPin,
  onRegistrationPinChange,
  onReconnect,
  onDisconnect,
  disconnecting,
}: {
  status: WhatsappStatusDTO;
  ready: boolean;
  sdkReady: boolean;
  pending: boolean;
  registrationPin: string;
  onRegistrationPinChange: (pin: string) => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const busy = pending || disconnecting;

  return (
    <>
      <ConnectionStateHeader
        icon={<WifiOff />}
        title="WhatsApp com problema"
        description="A conexão existe, mas o canal não está recebendo mensagens dos pacientes."
        badge="Não está recebendo"
        badgeTone="red"
      />
      <div className="grid gap-4 p-(--card-pad)">
        <ConnectionDetails status={status} />
        {status.health.messages.length > 0 ? (
          <Alert variant="danger" title="Falhas encontradas">
            <ul className="grid list-disc gap-1 pl-4">
              {status.health.messages.map((message) => (
                <li key={message} className="text-pretty">
                  {message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        <Separator />
        <div className="grid gap-4">
          <p className="text-pretty text-(length:--fs-sm) text-fg-muted">
            Refaça a conexão para voltar a receber mensagens dos pacientes.
          </p>
          {ready ? (
            <RegistrationPinField
              id="whatsapp-reconnect-pin"
              value={registrationPin}
              onChange={onRegistrationPinChange}
              disabled={busy}
            />
          ) : (
            <Alert variant="warning" title="Reconexão automática indisponível">
              Esta instância não está configurada para iniciar a reconexão. Fale com o suporte para
              restabelecer o canal.
            </Alert>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            {ready ? (
              <Button
                type="button"
                loading={pending}
                onClick={onReconnect}
                disabled={busy || !sdkReady || registrationPin.length !== 6}
                className="min-h-(--hit-target) w-full sm:w-auto"
              >
                {sdkReady ? 'Reconectar WhatsApp' : 'Carregando integração…'}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="danger"
              size="sm"
              loading={disconnecting}
              onClick={onDisconnect}
              disabled={busy}
              className="min-h-(--hit-target) w-full sm:w-auto"
            >
              Desconectar
            </Button>
          </div>
          <span className="sr-only" role="status" aria-live="polite">
            {pending
              ? 'Reconectando o WhatsApp.'
              : disconnecting
                ? 'Desconectando o WhatsApp.'
                : ''}
          </span>
        </div>
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
      <ConnectionStateHeader
        icon={<MessageCircle />}
        title="Conecte o WhatsApp da clínica"
        description="Vincule o número usado no atendimento para ativar o canal da clínica."
        badge={ready ? 'Não conectado' : 'Indisponível'}
        badgeTone="gray"
      />
      <div className="grid gap-4 p-(--card-pad)">
        <div>
          <p className="text-pretty text-(length:--fs-sm) text-fg-muted">
            Com o número conectado, o Agente de IA poderá:
          </p>
          <ul
            aria-label="Recursos disponíveis após a conexão"
            className="mt-3 grid gap-x-5 gap-y-2 text-(length:--fs-sm) text-fg sm:grid-cols-2"
          >
            {[
              'Responder pacientes',
              'Confirmar consultas',
              'Enviar lembretes',
              'Recuperar pagamentos',
            ].map((benefit) => (
              <li key={benefit} className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 shrink-0 text-success-600" />
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>
        <Separator />
        {ready ? (
          <div className="grid gap-4">
            <RegistrationPinField
              id="whatsapp-registration-pin"
              value={registrationPin}
              onChange={onRegistrationPinChange}
              disabled={pending}
            />
            <div>
              <Button
                type="button"
                loading={pending}
                onClick={onConnect}
                disabled={pending || !sdkReady || registrationPin.length !== 6}
                className="min-h-(--hit-target) w-full sm:w-auto"
              >
                {sdkReady ? 'Conectar WhatsApp' : 'Carregando integração…'}
              </Button>
            </div>
            <span className="sr-only" role="status" aria-live="polite">
              {pending ? 'Conectando o WhatsApp.' : ''}
            </span>
          </div>
        ) : (
          <Alert variant="warning" title="Conexão automática indisponível">
            A conexão ainda não está habilitada nesta instância. Fale com o suporte para conectar o
            WhatsApp da clínica.
          </Alert>
        )}
      </div>
    </>
  );
}
