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

/** Ids do evento oficial. `wabaId` é obrigatório: o servidor não descobre a WABA. */
interface SessionInfo {
  wabaId: string;
  phoneNumberId?: string | undefined;
}

/**
 * Valores do `event`. A doc oficial modela o campo como `<FLOW_FINISH_TYPE>` e
 * lista `ERROR` na mesma enum de `FINISH*`; outra página oficial mostra o erro
 * chegando como `CANCEL` com `error_message`/`error_code`. As duas formas são
 * suportadas de propósito — o contrato publicado é ambíguo neste ponto e
 * escolher uma só faria a tela mentir na outra. Os `FINISH_*` de outros fluxos
 * (app do WhatsApp Business, migração OBO, grant-only) não pertencem a esta
 * configuração e não são tratados.
 */
type EmbeddedSignupEvent = 'CANCEL' | 'ERROR' | 'FINISH' | 'FINISH_ONLY_WABA';

/**
 * D78 — janela de tolerância entre os DOIS canais independentes do Embedded
 * Signup: o callback do `FB.login` (SDK) e o `postMessage` do pop-up. A ordem
 * entre eles não é garantida.
 *
 * Quando o callback volta SEM `code`, ainda não dá para saber se o cadastro nem
 * começou ou se um `FINISH`/`CANCEL` está a caminho. Em vez de decidir na hora
 * — o que produzia `SIGNUP_NOT_STARTED` para um fluxo que na verdade terminou —
 * o veredito espera este intervalo curto. Qualquer evento que chegue antes do
 * prazo resolve imediatamente e cancela o timer; o prazo só decide quando
 * nenhum evento chegou. Curto o bastante para não deixar a tela parada e longo
 * o bastante para absorver a diferença de entrega entre os dois canais.
 */
const SIGNUP_EVENT_GRACE_MS = 1_500;

/**
 * D78 — quiescência depois do desfecho. O pop-up pode emitir um `postMessage`
 * atrasado depois de o desfecho já ser conhecido; enquanto este prazo não
 * expira, nenhuma tentativa nova pode começar, então uma mensagem tardia da
 * tentativa A só pode ser descartada, nunca atribuída à tentativa B.
 */
const SIGNUP_QUIESCE_MS = 3_000;

/**
 * D78 — timeout explícito de abandono. Enquanto a tentativa está em curso o
 * fluxo fica travado (single-flight); se o pop-up for morto pelo sistema, o SDK
 * pode nunca chamar o callback e a tela ficaria bloqueada até um reload. Este é
 * o único caminho que libera o fluxo sem os dois canais quiescentes, e por isso
 * é generoso: o Embedded Signup real leva poucos minutos, mas criar um
 * portfólio do zero dentro do pop-up pode demorar bem mais.
 */
const SIGNUP_ABANDON_MS = 10 * 60_000;

type SignupPhase =
  /** Nenhuma tentativa em curso — a única fase em que `FB.login` pode ser chamado. */
  | 'idle'
  /** Pop-up aberto; nenhum desfecho conhecido ainda. */
  | 'running'
  /** Desfecho conhecido; aguardando os dois canais ficarem quiescentes. */
  | 'closing';

/**
 * Estado de UMA tentativa de conexão. Vive num ref porque é atualizado por dois
 * callbacks fora do React (SDK e `postMessage`) e por timers.
 *
 * **Limite de correlação, explicitamente.** `id` invalida apenas o que o Qoro
 * consegue amarrar a uma tentativa: o callback do `FB.login` (capturado no
 * closure daquela chamada) e os timers. O `postMessage` do Embedded Signup
 * **não é correlacionável**: a documentação oficial não expõe, nas mensagens
 * `FINISH`/`FINISH_ONLY_WABA`/`CANCEL`, nenhum identificador que também esteja
 * disponível no callback do SDK (o `session_id` aparece só no formato de erro
 * reportado). Inventar correlação seria pior do que não ter.
 *
 * A proteção contra sobreposição vem, portanto, do **single-flight**: só existe
 * uma tentativa por vez, e a fase `closing` mantém o fluxo travado por
 * `SIGNUP_QUIESCE_MS` além do retorno do callback. Mensagens fora da fase
 * `running` são descartadas.
 */
interface SignupAttempt {
  id: number;
  phase: SignupPhase;
  code: string | null;
  session: SessionInfo | null;
  settled: boolean;
  connectStarted: boolean;
  /** O callback do SDK já voltou sem `code` e aguarda a janela de tolerância. */
  awaitingEvent: boolean;
  /** O canal do SDK ficou quiescente (o callback retornou, com ou sem `code`). */
  callbackReturned: boolean;
  /** O prazo de quiescência do canal de `postMessage` expirou. */
  quiesced: boolean;
  timers: {
    grace: ReturnType<typeof setTimeout> | null;
    quiesce: ReturnType<typeof setTimeout> | null;
    abandon: ReturnType<typeof setTimeout> | null;
  };
}

function newAttempt(id: number): SignupAttempt {
  return {
    id,
    phase: 'idle',
    code: null,
    session: null,
    settled: false,
    connectStarted: false,
    awaitingEvent: false,
    callbackReturned: false,
    quiesced: false,
    timers: { grace: null, quiesce: null, abandon: null },
  };
}

/** `error_code` é texto cross-origin: só chega à tela como referência curta. */
function sanitizeMetaErrorRef(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const ref = String(value)
    .replace(/[^A-Za-z0-9_-]/gu, '')
    .slice(0, 32);
  return ref.length > 0 ? ref : null;
}

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
  /** Single-flight: enquanto true, PIN e botões de (re)conexão ficam travados. */
  const [signupInFlight, setSignupInFlight] = useState(false);
  const registrationPinRef = useRef('');
  const attempt = useRef<SignupAttempt>(newAttempt(0));

  useEffect(() => {
    if (status.connected) setLocallyDisconnected(false);
  }, [status.connected]);

  const clearTimer = useCallback((key: keyof SignupAttempt['timers']) => {
    const pendingTimer = attempt.current.timers[key];
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      attempt.current.timers[key] = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearTimer('grace');
    clearTimer('quiesce');
    clearTimer('abandon');
  }, [clearTimer]);

  // Timers não sobrevivem ao desmonte: disparariam em componente morto.
  useEffect(() => clearAllTimers, [clearAllTimers]);

  /** Libera o single-flight: a partir daqui um novo `FB.login` é permitido. */
  const releaseSignupLock = useCallback(() => {
    clearAllTimers();
    attempt.current.phase = 'idle';
    setSignupInFlight(false);
  }, [clearAllTimers]);

  /**
   * Só libera com os DOIS canais quiescentes: o callback do SDK já retornou e o
   * prazo de tolerância a `postMessage` atrasado expirou.
   */
  const releaseIfQuiescent = useCallback(() => {
    const a = attempt.current;
    if (a.phase !== 'closing' || !a.callbackReturned || !a.quiesced) return;
    releaseSignupLock();
  }, [releaseSignupLock]);

  /**
   * Desfecho conhecido: encerra a tentativa e começa a contar a quiescência.
   *
   * O timer de abandono NÃO é cancelado aqui. Cancelá-lo criava um deadlock: em
   * `closing` a liberação exige `callbackReturned`, e um pop-up cujo callback
   * nunca retorna (janela morta pelo sistema depois de um CANCEL/ERROR/FINISH
   * incompleto) travava a tela até um reload. O abandono cobre `running` E
   * `closing`; no segundo caso ele apenas destrava, sem tocar no desfecho.
   */
  const beginClosing = useCallback(() => {
    const a = attempt.current;
    if (a.phase !== 'running') return;
    const attemptId = a.id;
    a.phase = 'closing';
    clearTimer('grace');
    a.timers.quiesce = setTimeout(() => {
      // Timer de tentativa antiga não pode liberar a tentativa atual.
      if (attempt.current.id !== attemptId) return;
      attempt.current.timers.quiesce = null;
      attempt.current.quiesced = true;
      releaseIfQuiescent();
    }, SIGNUP_QUIESCE_MS);
    releaseIfQuiescent();
  }, [clearTimer, releaseIfQuiescent]);

  /**
   * Registra o desfecho terminal da tentativa. O primeiro a chegar vence: um
   * callback atrasado do SDK não sobrescreve o motivo que o pop-up já explicou.
   */
  const settle = useCallback(
    (code: string, message: string) => {
      if (attempt.current.settled) return;
      attempt.current.settled = true;
      attempt.current.code = null;
      attempt.current.session = null;
      attempt.current.awaitingEvent = false;
      setError({ code, message });
      beginClosing();
    },
    [beginClosing],
  );

  const connectCompletedSignup = useCallback(
    (code: string, session: SessionInfo) => {
      if (attempt.current.connectStarted) return;
      attempt.current.connectStarted = true;
      attempt.current.code = null;
      attempt.current.awaitingEvent = false;
      // A action pode responder depois de o abandono já ter liberado o fluxo;
      // sem o id, a resposta atrasada corromperia o estado da tentativa nova.
      const attemptId = attempt.current.id;
      beginClosing();
      startTransition(async () => {
        try {
          const r = await connectWhatsappAction({
            code,
            registrationPin: registrationPinRef.current,
            wabaId: session.wabaId,
            phoneNumberId: session.phoneNumberId,
          });
          // Resposta obsoleta: a tentativa que a originou já foi encerrada e
          // outra pode estar em curso. Descartada ANTES de qualquer efeito —
          // nem erro na tela, nem `router.refresh()`, nem escrita no estado.
          if (attempt.current.id !== attemptId) return;
          if (!r.ok) {
            attempt.current.connectStarted = false;
            setError({ code: r.code, message: r.message });
            return;
          }
          router.refresh();
        } catch {
          if (attempt.current.id !== attemptId) return;
          attempt.current.connectStarted = false;
          setError({
            code: 'CONNECTION_FAILED',
            message: 'Não foi possível concluir a conexão. Tente novamente.',
          });
        }
      });
    },
    [router, startTransition, beginClosing],
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
          data?: {
            waba_id?: string;
            phone_number_id?: string;
            error_message?: string;
            error_code?: string | number;
          };
        };
        if (parsed?.type !== 'WA_EMBEDDED_SIGNUP') return;
        // A mensagem NÃO carrega correlação com a tentativa (ver `SignupAttempt`).
        // A fase é o que a contém: fora de `running` — ou seja, com o desfecho já
        // conhecido, durante a quiescência, ou sem tentativa alguma — ela é
        // descartada. Como nenhuma tentativa nova começa antes de `idle`, uma
        // mensagem tardia da tentativa A nunca é atribuída à tentativa B.
        if (attempt.current.phase !== 'running') return;
        if (attempt.current.settled || attempt.current.connectStarted) return;

        if (parsed.event === 'CANCEL' || parsed.event === 'ERROR') {
          // Duas formas oficiais do mesmo desfecho: `CANCEL` com `current_step`
          // (o usuário desistiu) e erro reportado, que aparece ora como
          // `CANCEL` + `error_message`/`error_code`, ora como `ERROR`. Chamar
          // os dois de "cancelamento" era a lacuna de D78.
          const ref = sanitizeMetaErrorRef(parsed.data?.error_code);
          const metaInterrupted = parsed.event === 'ERROR' || !!parsed.data?.error_message || !!ref;
          if (metaInterrupted) {
            // O texto da Meta NÃO é reproduzido: é conteúdo cross-origin. Só a
            // referência curta, que a própria doc destina ao suporte.
            settle(
              'META_SIGNUP_ERROR',
              `A Meta interrompeu o cadastro do WhatsApp.${ref ? ` Referência da Meta: ${ref}.` : ''} Tente novamente e, se repetir, acione o suporte.`,
            );
            return;
          }
          settle('CANCELLED', 'Conexão cancelada. Nenhuma alteração foi feita.');
          return;
        }
        if (parsed.event === 'FINISH' || parsed.event === 'FINISH_ONLY_WABA') {
          const wabaId = parsed.data?.waba_id;
          if (!wabaId) {
            // Sem `waba_id` o servidor não tem como resolver a conta sem pedir
            // permissão de portfólio: falha aqui, sem round-trip inútil.
            settle(
              'SIGNUP_INCOMPLETE',
              'A Meta concluiu a janela sem informar a conta do WhatsApp Business. Refaça a conexão e selecione a conta e o número.',
            );
            return;
          }
          const session: SessionInfo = { wabaId, phoneNumberId: parsed.data?.phone_number_id };
          attempt.current.session = session;
          const code = attempt.current.code;
          if (code) {
            connectCompletedSignup(code, session);
            return;
          }
          // O callback já tinha voltado sem `code` e estava na janela de
          // tolerância: agora sabemos que o cadastro terminou e o que faltou
          // foi a autorização — não é "não começou".
          if (attempt.current.awaitingEvent) {
            settle(
              'AUTHORIZATION_MISSING',
              'A Meta concluiu o cadastro, mas não devolveu a autorização. Tente novamente.',
            );
          }
        }
      } catch {
        /* ignore non-JSON postMessages */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [connectCompletedSignup, settle]);

  const initSdk = () => {
    if (!appId) return;
    window.FB?.init({ appId, version: graphVersion, cookie: true, xfbml: false });
    setSdkReady(true);
  };

  const launchSignup = () => {
    // Single-flight. O `disabled` do botão não basta: um clique duplo dispara os
    // dois handlers antes do re-render, e duas janelas simultâneas produziriam
    // `postMessage` de duas origens sem nenhum jeito de saber a qual pertencem.
    if (attempt.current.phase !== 'idle') return;
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
    // Tentativa nova não herda estado nem timer da anterior.
    clearAllTimers();
    const current = newAttempt(attempt.current.id + 1);
    current.phase = 'running';
    attempt.current = current;
    setSignupInFlight(true);
    current.timers.abandon = setTimeout(() => {
      if (attempt.current.id !== current.id) return;
      attempt.current.timers.abandon = null;
      // Único caminho que destrava sem os dois canais quiescentes, e vale tanto
      // em `running` quanto em `closing`. Se já existe desfecho — CANCELLED,
      // META_SIGNUP_ERROR, SIGNUP_INCOMPLETE, AUTHORIZATION_MISSING — o `settle`
      // é no-op e a mensagem original permanece: aqui só se destrava.
      // Também não interfere numa Server Action em curso: o `pending` continua
      // travando os botões enquanto ela não responde.
      if (!attempt.current.settled && !attempt.current.connectStarted) {
        settle(
          'SIGNUP_TIMED_OUT',
          'A janela da Meta ficou aberta por muito tempo sem concluir o cadastro. Feche-a e tente novamente.',
        );
      }
      releaseSignupLock();
    }, SIGNUP_ABANDON_MS);
    FB.login(
      (response) => {
        // Callback atrasado de uma tentativa anterior não escreve nesta tela.
        if (attempt.current.id !== current.id) return;
        // O canal do SDK ficou quiescente, qualquer que tenha sido a resposta.
        attempt.current.callbackReturned = true;
        releaseIfQuiescent();
        const code = response?.authResponse?.code;
        if (code) {
          attempt.current.code = code;
          const session = attempt.current.session;
          if (session) connectCompletedSignup(code, session);
          return;
        }
        // D78 — sem `code`, ainda não há veredito. O `postMessage` do pop-up
        // pode chegar depois do callback; decidir agora produzia
        // `SIGNUP_NOT_STARTED` para fluxos que na verdade terminaram.
        if (attempt.current.settled || attempt.current.connectStarted) return;
        if (attempt.current.session) {
          settle(
            'AUTHORIZATION_MISSING',
            'A Meta concluiu o cadastro, mas não devolveu a autorização. Tente novamente.',
          );
          return;
        }
        attempt.current.awaitingEvent = true;
        attempt.current.timers.grace = setTimeout(() => {
          if (attempt.current.id !== current.id) return;
          attempt.current.timers.grace = null;
          // Passou a janela e nenhum evento chegou: a única coisa observável é
          // que o cadastro não começou. NÃO afirmamos qual aviso a Meta exibiu
          // dentro do pop-up — é cross-origin e o Qoro não o lê.
          settle(
            'SIGNUP_NOT_STARTED',
            'A janela da Meta fechou sem iniciar o cadastro do WhatsApp e nenhum evento do Embedded Signup chegou. Se a janela exibiu algum aviso da Meta, envie-o ao suporte; caso contrário, tente novamente.',
          );
        }, SIGNUP_EVENT_GRACE_MS);
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

  // Trava única das superfícies de (re)conexão: pop-up aberto/fechando OU a
  // Server Action em curso. Enquanto verdadeira, PIN e botões ficam desabilitados.
  const signupBusy = pending || signupInFlight;

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

      <PageHeader crumbs={[{ label: 'Canais e IA', href: '/configuracoes/canais-ia' }, { label: 'WhatsApp' }]}
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
            pending={signupBusy}
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
            pending={signupBusy}
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
