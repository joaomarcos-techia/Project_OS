/**
 * Classificador de risco do cadastro anônimo — ADR-060 (O-2b), §21.8.
 *
 * Determinístico e explicável de propósito. O §21.8 é explícito quanto ao que
 * NÃO entra: raça, localização da clínica, conteúdo do nome e fingerprint
 * oculto. Aqui só entram sinais de COMPORTAMENTO da requisição.
 *
 * Três faixas, e a do meio é a razão de o classificador existir: mostrar
 * desafio para todo mundo aumenta abandono sem substituir limite nenhum.
 *
 *   baixo (0)    → segue sem desafio
 *   moderado (1) → exige Turnstile, validado uma vez no backend
 *   alto (2)     → recusa antes de qualquer escrita ou I/O caro
 *
 * LIMITE HONESTO DESTA FATIA: dos sinais que o §21.8 lista, só três existem
 * hoje. E-mail e dispositivo não existem porque a fatia não os coleta (ordem A:
 * as perguntas vêm depois); assinatura de WAF não existe porque não há WAF.
 * Quando existirem, entram aqui — a função é pura e recebe os sinais prontos,
 * então acrescentar um não mexe em quem a chama.
 */
import 'server-only';

/** 0 baixo · 1 moderado · 2 alto. Numérico para caber em `risk_level` (smallint). */
export type RiskLevel = 0 | 1 | 2;

export const RISK_LOW = 0 satisfies RiskLevel;
export const RISK_MODERATE = 1 satisfies RiskLevel;
export const RISK_HIGH = 2 satisfies RiskLevel;

export interface RiskSignals {
  /**
   * `Origin` da requisição, quando presente. Comparado ao host esperado.
   * Ausente NÃO é o mesmo que divergente — ver `classifySignupRisk`.
   */
  origin: string | null;
  /** Host que a aplicação espera para si (ex.: `app.qoro.dev`). */
  expectedHost: string;
  /**
   * Fração do balde de rate limit por IP já consumida (0..1). Indicador
   * ANTECEDENTE: o limiter só bloqueia em 1.0, e a essa altura já é tarde para
   * desafiar — o objetivo é pedir prova antes de o balde estourar.
   */
  ipBudgetUsed: number;
  /** O corpo desta requisição foi recusado pelo schema. */
  schemaFailure: boolean;
  /**
   * O limiter distribuído caiu e estamos no fallback em memória.
   *
   * Entra como sinal de risco de propósito: sem o balde distribuído, a defesa
   * por IP deixou de existir de fato (em serverless o fallback é por
   * instância). Exigir desafio nesse estado é CONTROLE COMPENSATÓRIO — troca
   * "perdemos o rate limit" por "prove que é humano", em vez de "deixa passar".
   */
  limiterDegraded: boolean;
}

/** A partir de quanto do balde consumido a requisição vira suspeita. */
const BUDGET_SUSPICIOUS = 0.5;

/**
 * Motivo legível da faixa, para observabilidade. NUNCA carrega PII — são
 * rótulos fixos, de baixa cardinalidade, seguros em log e em métrica.
 */
export type RiskReason =
  | 'cross_site_origin'
  | 'missing_origin'
  | 'ip_budget'
  | 'schema_failure'
  | 'limiter_degraded'
  | 'clean';

export interface RiskAssessment {
  level: RiskLevel;
  reason: RiskReason;
}

export function classifySignupRisk(signals: RiskSignals): RiskAssessment {
  // ALTO — `Origin` presente e de outro host. Um POST de cadastro vindo de
  // outra origem não é usuário navegando: é script ou página de terceiro
  // tentando usar a nossa rota. Não há caso legítimo, então não vale gastar
  // desafio: recusa direto.
  if (signals.origin !== null && !sameHost(signals.origin, signals.expectedHost)) {
    return { level: RISK_HIGH, reason: 'cross_site_origin' };
  }

  // MODERADO — `Origin` ausente. O fetch da nossa própria página sempre manda
  // o cabeçalho; a ausência indica cliente não-browser. Pode ser legítimo
  // (ferramenta, teste), então DESAFIA em vez de recusar — a diferença entre
  // "não é o fluxo normal" e "é abuso" não está provada aqui.
  if (signals.origin === null) {
    return { level: RISK_MODERATE, reason: 'missing_origin' };
  }

  // MODERADO — corpo malformado. Bot manda lixo; a tela nossa, não.
  if (signals.schemaFailure) {
    return { level: RISK_MODERATE, reason: 'schema_failure' };
  }

  // MODERADO — o IP já consumiu metade do balde. Pedir prova ANTES de o limite
  // estourar é o que transforma o rate limit de "muro" em "pedágio".
  if (signals.ipBudgetUsed >= BUDGET_SUSPICIOUS) {
    return { level: RISK_MODERATE, reason: 'ip_budget' };
  }

  // MODERADO — limiter degradado. A defesa por IP sumiu; o desafio entra no
  // lugar dela enquanto durar o apagão. Só encarece o cadastro no período em
  // que a outra proteção não existe.
  if (signals.limiterDegraded) {
    return { level: RISK_MODERATE, reason: 'limiter_degraded' };
  }

  return { level: RISK_LOW, reason: 'clean' };
}

/**
 * Compara o host de `Origin` com o esperado.
 *
 * Compara HOST, não a string inteira: `Origin` traz esquema e porta
 * (`https://app.qoro.dev`), e comparar texto cru faria `https://app.qoro.dev`
 * divergir de `app.qoro.dev` e recusar todo mundo.
 */
function sameHost(origin: string, expectedHost: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === expectedHost.toLowerCase();
  } catch {
    // `Origin` que não é URL válida é entrada forjada — trata como divergente.
    return false;
  }
}
