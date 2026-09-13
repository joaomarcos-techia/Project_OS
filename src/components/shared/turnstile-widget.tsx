'use client';

/**
 * Widget do Cloudflare Turnstile para as telas SEM sessão — ADR-060 (O-2b).
 *
 * Produz o token que o servidor repassa ao Supabase Auth em
 * `options.captchaToken`. O token é DE USO ÚNICO e expira em poucos minutos,
 * então cada tentativa precisa do seu próprio — daí `resetSignal`.
 *
 * ===================================================================
 * Decisão: o widget NÃO bloqueia o envio
 * ===================================================================
 * O botão continua clicável mesmo sem token. Parece frouxo e é o contrário:
 * hoje o captcha está DESLIGADO no projeto Supabase, então um botão travado
 * por widget que não carregou (bloqueador de anúncio, CSP errada, apagão da
 * Cloudflare) trancaria a clínica inteira fora do próprio sistema para
 * proteger contra nada. Quem decide se o desafio é obrigatório é o servidor —
 * ele recebe o token ou a ausência dele e devolve mensagem própria.
 *
 * Sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` o componente não renderiza nada: nem
 * script, nem campo. É o estado de hoje em produção e não deve custar um
 * request sequer.
 *
 * ===================================================================
 * Por que o script é carregado à mão, e não com `next/script`
 * ===================================================================
 * Preferência por previsibilidade num caminho de segurança, não bug conhecido
 * do Next. `next/script` decide sozinho QUANDO injetar (e, com preload, pode
 * deixar só o `<link>` por um tempo); aqui a diferença entre "ainda não
 * carregou" e "não vai carregar" precisa ser observável, porque é ela que
 * distingue um visitante lento de um desafio quebrado. Com a injeção à mão, a
 * promise resolve ou rejeita, e o `data-turnstile-state` reflete isso.
 *
 * São ~25 linhas bem delimitadas. Se um dia o `<Script>` der a mesma garantia
 * de observabilidade, volte para ele.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Nome do campo no FormData. As server actions leem exatamente este nome. */
export const CAPTCHA_TOKEN_FIELD = 'captchaToken';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      'timeout-callback'?: () => void;
      appearance?: 'always' | 'execute' | 'interaction-only';
      theme?: 'light' | 'dark' | 'auto';
      action?: string;
    },
  ) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * Uma carga por página, compartilhada por todos os widgets. Guardar a promise
 * (e não um booleano) evita a corrida em que dois widgets montam juntos e
 * injetam duas tags.
 */
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('turnstile')), { once: true });
      return;
    }
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.addEventListener('load', () => resolve(), { once: true });
    el.addEventListener('error', () => reject(new Error('turnstile')), { once: true });
    document.head.appendChild(el);
  }).catch((err: unknown) => {
    // Permite nova tentativa numa montagem futura em vez de deixar a página
    // presa a uma falha transitória de rede.
    scriptPromise = null;
    throw err;
  });

  return scriptPromise;
}

export interface TurnstileWidgetProps {
  /**
   * Rótulo curto do fluxo (`login`, `recovery`, `checkout`). Vai para a
   * Cloudflare como `action` e aparece na analítica dela — é o que permite ver
   * QUAL tela está sendo atacada, em vez de um total único.
   */
  action: string;
  /**
   * Muda de valor para pedir um token novo. O anterior já foi gasto: reenviar
   * o mesmo devolve `timeout-or-duplicate` e a tentativa é recusada.
   */
  resetSignal?: number;
  className?: string;
}

/**
 * Resolve a site key NO CLIENTE, espelhando `normalizeDevelopmentAliases` de
 * `src/lib/env.ts`.
 *
 * ===================================================================
 * Por que isto é duplicado em vez de importado
 * ===================================================================
 * `@/lib/env` é server-only e roda no RUNTIME do servidor. O bundle do cliente
 * nunca passa por ele: o Next inlina `process.env.NEXT_PUBLIC_*` literalmente,
 * no build. Ou seja, o alias `_LOCAL`/`_DEV` que existe lá **não tem efeito
 * nenhum no browser** — e a única forma de o cliente respeitar a mesma regra é
 * escrevê-la aqui, sobre os mesmos nomes.
 *
 * Custou uma hora de diagnóstico em 13/09: em `localhost`, o widget recebia a
 * chave CANÔNICA (registrada para `app.qoro.dev`), e o Turnstile simplesmente
 * não roda quando o hostname não bate. Sem iframe, sem token, sem callback de
 * erro — `data-turnstile-state` preso em `loading`, indistinguível de "ainda
 * carregando".
 *
 * O guard é o MESMO do servidor (`NODE_ENV === 'production'`), e por isso vale
 * a mesma advertência: a Vercel constrói o Preview com `NODE_ENV=production`,
 * então `*_DEV` no painel dela nunca é lido. No painel, use o nome canônico,
 * uma entrada por escopo.
 */
export function resolveSiteKey(): string | undefined {
  if (process.env.NODE_ENV === 'production') {
    return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  }
  // `||`, não `??`: um `.env` com `FOO=` produz STRING VAZIA, não `undefined`,
  // e com `??` a vazia venceria a chave boa — o widget receberia `sitekey: ''`.
  // É o mesmo motivo do `emptyToUndefined` em `src/lib/env.ts`.
  return (
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY_LOCAL ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY_DEV ||
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ||
    undefined
  );
}

export function TurnstileWidget({ action, resetSignal = 0, className }: TurnstileWidgetProps) {
  const siteKey = resolveSiteKey();
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  /**
   * Estado observável do desafio, publicado em `data-turnstile-state`.
   *
   * Existe porque a falha do Turnstile é MUDA: chave não registrada para o
   * hostname, CSP bloqueando o iframe, script que não injetou e "ainda
   * resolvendo" produzem todos o mesmo sintoma visível — nada acontece. Sem
   * isto, diagnosticar exige abrir o console; num ambiente de cliente, nem
   * isso. O E2E também lê daqui.
   */
  const [state, setState] = useState<'loading' | 'solved' | 'error' | 'expired'>('loading');

  const fail = useCallback(() => {
    setToken('');
    setState('error');
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    let alive = true;
    loadTurnstileScript().then(
      () => {
        if (alive) setReady(true);
      },
      () => {
        if (alive) fail();
      },
    );
    return () => {
      alive = false;
    };
  }, [siteKey, fail]);

  // Render explícito: é o que devolve o `widgetId` necessário para o reset.
  // O modo implícito (classe `cf-turnstile`) não dá handle nenhum.
  //
  // ⚠️ RENDERIZA NUM FILHO CRIADO AQUI, não no `hostRef` direto. O Turnstile
  // injeta DOM próprio dentro do container e `remove()` não o devolve limpo:
  // sobram um `<div>` vazio e o input `cf-turnstile-response`. No StrictMode
  // (dev) o efeito roda duas vezes, e a segunda chamada de `render()` cairia
  // num container sujo. Container descartável resolve na raiz — e vale para
  // produção também, onde qualquer remontagem passa pelo mesmo caminho.
  useEffect(() => {
    if (!siteKey || !ready) return;
    const host = hostRef.current;
    const api = window.turnstile;
    if (!host || !api) return;

    const container = document.createElement('div');
    host.appendChild(container);

    let widgetId: string | null = null;
    try {
      widgetId = api.render(container, {
        sitekey: siteKey,
        action,
        appearance: 'interaction-only',
        theme: 'auto',
        callback: (value: string) => {
          setToken(value);
          setState('solved');
        },
        // Falha e expiração limpam o token em vez de deixar o campo com um
        // valor velho: mandar token expirado é pior que não mandar nenhum,
        // porque o erro do Supabase vira "captcha inválido" em vez de
        // "captcha ausente".
        'error-callback': fail,
        'expired-callback': () => {
          setToken('');
          setState('expired');
        },
        'timeout-callback': () => {
          setToken('');
          setState('expired');
        },
      });
      widgetIdRef.current = widgetId;
    } catch {
      setState('error');
    }

    return () => {
      widgetIdRef.current = null;
      try {
        if (widgetId !== null) window.turnstile?.remove(widgetId);
      } catch {
        /* o widget já pode ter sumido com o nó; remover duas vezes não é erro */
      }
      container.remove();
    };
  }, [siteKey, ready, action, fail]);

  // Token novo a cada tentativa.
  useEffect(() => {
    if (resetSignal === 0 || widgetIdRef.current === null) return;
    setToken('');
    setState('loading');
    try {
      window.turnstile?.reset(widgetIdRef.current);
    } catch {
      /* reset em widget removido não deve derrubar a tela */
    }
  }, [resetSignal]);

  if (!siteKey) return null;

  return (
    <>
      {/* Com `interaction-only` o host fica com altura zero até a Cloudflare
          decidir que este visitante precisa interagir. */}
      <div
        ref={hostRef}
        className={className}
        data-testid="turnstile-widget"
        data-turnstile-state={state}
      />
      <input type="hidden" name={CAPTCHA_TOKEN_FIELD} value={token} readOnly />
    </>
  );
}
