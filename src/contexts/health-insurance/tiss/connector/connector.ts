/**
 * P2.5 — contrato do conector de envio para a operadora (webservice TISS), SEM endpoint real.
 *
 * O que existe aqui é a parte de engenharia que não depende de operadora: a forma do resultado,
 * o limite de tempo, a retentativa só do que é seguro repetir e o circuito por operadora. O
 * transporte (SOAP pelo WSDL da versão TISS da operadora, endpoint, certificado) é entregue na
 * homologação com cada operadora (P12.5) e injetado aqui. Até lá o transporte padrão é
 * `notHomologatedTransport`, que RECUSA sempre: o Qoro nunca diz que enviou o que não enviou, e o
 * caminho oficial continua sendo o arquivo XML validado, enviado pela clínica no portal.
 *
 * Nada de endpoint, credencial ou resposta de operadora é inventado neste arquivo.
 */

/**
 * Resposta da operadora, como chegou (P6.5): o elemento do webservice já conferido no XSD
 * oficial e no hash, em ISO-8859-1. Pode ter dado de paciente: quem recebe guarda pelo caminho
 * cifrado de sempre e nunca põe em log.
 */
export interface ConnectorReceipt {
  /** Elemento de resposta do webservice (ex.: `protocoloRecebimentoWS`). */
  element: string;
  xml: Uint8Array;
  sha256: string;
}

export type ConnectorOutcome =
  /** A operadora recebeu e devolveu um protocolo. */
  | { kind: 'accepted'; protocol: string; receipt?: ConnectorReceipt }
  /** A operadora recusou o conteúdo (motivo dela); repetir não adianta. */
  | { kind: 'rejected'; code: string; message: string; receipt?: ConnectorReceipt }
  /**
   * Falha de transporte, tempo esgotado ou resposta que não confere (`invalid_response`: fora do
   * XSD, hash errado, de outra operadora). Só é repetido se o envio for idempotente: num envio que
   * altera algo, a operadora pode ter recebido, e a tela manda conferir antes de reenviar.
   */
  | { kind: 'unavailable'; reason: 'timeout' | 'network' | 'server_error' | 'invalid_response' }
  /** O circuito desta operadora está aberto (falhas seguidas): nem tenta, espera esfriar. */
  | { kind: 'circuit_open'; retryAfterMs: number }
  /** Sem homologação/configuração: nenhum envio por webservice é possível. */
  | { kind: 'not_configured' };

export interface ConnectorRequest {
  insurerId: string;
  /** Operação do webservice (P6.5), quando o transporte atende mais de uma. */
  operation?: string;
  /** XML `mensagemTISS` já validado no XSD oficial (o conector não monta nem altera conteúdo). */
  xml: Uint8Array;
  /** Mesmo valor nas repetições do MESMO envio (a operadora deduplica, quando suporta). */
  idempotencyKey: string;
}

export interface ConnectorTransport {
  /** O transporte declara se a operadora deduplica pelo identificador (só então há retentativa). */
  readonly idempotent: boolean;
  /** Por pedido, quando o transporte mistura consultas (repetíveis) e envios (P6.5). */
  isIdempotent?(request: ConnectorRequest): boolean;
  send(request: ConnectorRequest, signal: AbortSignal): Promise<ConnectorOutcome>;
}

/** Padrão até a homologação: nada sai do Qoro por webservice. */
export const notHomologatedTransport: ConnectorTransport = {
  idempotent: false,
  async send() {
    return { kind: 'not_configured' };
  },
};

export interface CircuitOptions {
  /** Falhas seguidas (`unavailable`) que abrem o circuito. */
  failureThreshold: number;
  /** Quanto tempo o circuito fica aberto antes de deixar UMA tentativa passar. */
  cooldownMs: number;
}

interface CircuitState {
  failures: number;
  openedAt: number | null;
}

export interface ConnectorOptions {
  transport: ConnectorTransport;
  timeoutMs: number;
  /** Tentativas extras para `unavailable`, só com transporte idempotente. */
  retries: number;
  circuit: CircuitOptions;
  now?: () => number;
}

export const DEFAULT_CONNECTOR_OPTIONS: Omit<ConnectorOptions, 'transport'> = {
  timeoutMs: 20_000,
  retries: 2,
  circuit: { failureThreshold: 5, cooldownMs: 5 * 60_000 },
};

export interface InsuranceConnector {
  submit(request: ConnectorRequest): Promise<ConnectorOutcome>;
  /** Estado do circuito por operadora (para a tela e as métricas). */
  circuitOf(insurerId: string): 'closed' | 'open' | 'half_open';
}

export function createConnector(options: ConnectorOptions): InsuranceConnector {
  const now = options.now ?? (() => Date.now());
  const circuits = new Map<string, CircuitState>();
  const stateOf = (insurerId: string): CircuitState => {
    let st = circuits.get(insurerId);
    if (!st) {
      st = { failures: 0, openedAt: null };
      circuits.set(insurerId, st);
    }
    return st;
  };
  const phase = (st: CircuitState): 'closed' | 'open' | 'half_open' => {
    if (st.openedAt === null) return 'closed';
    return now() - st.openedAt >= options.circuit.cooldownMs ? 'half_open' : 'open';
  };

  async function once(request: ConnectorRequest): Promise<ConnectorOutcome> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ConnectorOutcome>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: 'unavailable', reason: 'timeout' });
      }, options.timeoutMs);
    });
    try {
      return await Promise.race([
        options.transport
          .send(request, controller.signal)
          .catch((): ConnectorOutcome => ({ kind: 'unavailable', reason: 'network' })),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    circuitOf: (insurerId) => phase(stateOf(insurerId)),
    async submit(request) {
      const st = stateOf(request.insurerId);
      const p = phase(st);
      if (p === 'open') {
        return {
          kind: 'circuit_open',
          retryAfterMs: options.circuit.cooldownMs - (now() - (st.openedAt ?? now())),
        };
      }
      const idempotent = options.transport.isIdempotent?.(request) ?? options.transport.idempotent;
      const maxAttempts = idempotent && p === 'closed' ? 1 + options.retries : 1;
      let outcome: ConnectorOutcome = { kind: 'unavailable', reason: 'network' };
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        outcome = await once(request);
        if (outcome.kind !== 'unavailable') break;
      }
      if (outcome.kind === 'unavailable') {
        st.failures += 1;
        if (p === 'half_open' || st.failures >= options.circuit.failureThreshold)
          st.openedAt = now();
      } else if (outcome.kind === 'accepted' || outcome.kind === 'rejected') {
        st.failures = 0;
        st.openedAt = null;
      }
      return outcome;
    },
  };
}
