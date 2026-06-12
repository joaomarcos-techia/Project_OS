/**
 * Circuit breaker do LLM (C11) — Closed / Open / Half-Open.
 *
 * Regras (PlanoAção §11.2, congeladas em ADR-022 como "ainda mutáveis" nos
 * parâmetros): 3 falhas consecutivas abrem o circuito por 5 minutos; depois
 * half-open admite UMA tentativa de sonda — sucesso fecha, falha reabre.
 *
 * Quando aberto: NÃO chama o Gemini (lança CircuitOpenError imediatamente);
 * o caller responde o fallback operacional.
 *
 * Estado EM MEMÓRIA por instância (improviso documentado §11.17 + review G6:
 * em multi-instance Vercel cada lambda tem seu próprio breaker — aceitável no
 * MVP porque o worker do outbox roda em 1 cron/instância; Redis-based quando
 * escalar). NÃO confundir com o breaker do outbox (src/lib/outbox/circuit.ts),
 * que pausa event_types por taxa de falha no banco.
 */

export class CircuitOpenError extends Error {
  readonly code = 'ai_circuit_open';
  constructor() {
    super('[ai] circuit breaker aberto — Gemini não será chamado neste turno');
    this.name = 'CircuitOpenError';
  }
}

export type CircuitState = 'closed' | 'open' | 'half_open';

type Clock = () => number;

export interface CircuitBreakerOpts {
  /** Falhas consecutivas para abrir. Default 3 (spec). */
  failureThreshold?: number;
  /** Tempo aberto antes do half-open, em ms. Default 5 min (spec). */
  openMs?: number;
  /** Relógio injetável (testes 11.6.4). Default Date.now. */
  clock?: Clock;
}

export class AICircuitBreaker {
  private readonly failureThreshold: number;
  private readonly openMs: number;
  private readonly clock: Clock;

  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private probeInFlight = false;

  constructor(opts: CircuitBreakerOpts = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.openMs = opts.openMs ?? 5 * 60_000;
    this.clock = opts.clock ?? Date.now;
  }

  state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.clock() - this.openedAt >= this.openMs ? 'half_open' : 'open';
  }

  /**
   * Executa `fn` sob o breaker. Aberto → CircuitOpenError SEM chamar fn.
   * Half-open → admite uma única sonda concorrente; demais chamadas recebem
   * CircuitOpenError até a sonda resolver.
   */
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.state();
    if (state === 'open') throw new CircuitOpenError();
    if (state === 'half_open') {
      if (this.probeInFlight) throw new CircuitOpenError();
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    } finally {
      this.probeInFlight = false;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
  }

  private onFailure(): void {
    if (this.openedAt !== null) {
      // Sonda half-open falhou → reabre janela inteira.
      this.openedAt = this.clock();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.clock();
    }
  }

  /** Test-only — não usar em produção. */
  reset(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.probeInFlight = false;
  }
}

/** Singleton do processo — o handler do ai-agent usa SEMPRE este. */
export const aiCircuit = new AICircuitBreaker();

/** Test-only helpers (padrão __testing__ do catalog/outbox). */
export const __testing__ = {
  create: (opts: CircuitBreakerOpts) => new AICircuitBreaker(opts),
  reset: () => aiCircuit.reset(),
};
