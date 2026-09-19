/**
 * Validação do token do Cloudflare Turnstile — ADR-060 (O-2b), §21.8.
 *
 * O token que o widget produz no browser NÃO prova nada sozinho: só a resposta
 * do `siteverify`, feita com a secret key, diz se ele é válido. Aceitar o token
 * sem verificar equivaleria a não ter desafio nenhum.
 *
 * TOKEN É DE USO ÚNICO e expira em poucos minutos. Cada passo protegido precisa
 * do seu próprio desafio — um token gasto aqui não serve para o `signUp` do
 * Supabase na fatia seguinte.
 *
 * Server-only: usa a secret key.
 */
import 'server-only';

import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { metrics } from '@/lib/observability/metrics';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Teto curto de propósito: este fetch acontece DENTRO de uma requisição de
 * usuário. Um Cloudflare pendurado não pode segurar a nossa rota.
 */
const TIMEOUT_MS = 3_000;

export type TurnstileOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'unreachable' | 'not_configured' };

/**
 * Verifica o token contra a Cloudflare.
 *
 * FALHA FECHADA quando não consegue verificar, e isto é decisão, não descuido.
 * Esta função só é chamada no caminho de risco MODERADO — ou seja, quando algo
 * na requisição já pediu prova. Não conseguir obter a prova não é razão para
 * seguir como se ela tivesse sido dada. O caminho de risco BAIXO não passa por
 * aqui, então um apagão da Cloudflare não derruba o cadastro normal: derruba
 * só o das requisições que já estavam sob suspeita.
 *
 * É o mesmo raciocínio graduado da decisão 6 da ADR — degrada onde o excedente
 * é barato, fecha onde ele custa.
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp: string,
): Promise<TurnstileOutcome> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Sem chave configurada não há como verificar. Reportado de forma distinta
    // de "inválido" porque o conserto é outro: um é configuração, o outro é
    // tentativa recusada.
    metrics.emit('signup.turnstile.not_configured', {});
    return { ok: false, reason: 'not_configured' };
  }
  if (!token) return { ok: false, reason: 'invalid' };

  const body = new URLSearchParams({ secret, response: token, remoteip: remoteIp });

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      metrics.emit('signup.turnstile.unreachable', { status: res.status });
      return { ok: false, reason: 'unreachable' };
    }

    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };

    if (data.success === true) {
      metrics.emit('signup.turnstile.verified', {});
      return { ok: true };
    }

    // Os `error-codes` da Cloudflare são rótulos fixos e sem PII
    // (`invalid-input-response`, `timeout-or-duplicate`, …). São o que
    // distingue "token reusado" de "chave errada" às 3h da manhã.
    metrics.emit('signup.turnstile.rejected', { codes: data['error-codes'] ?? [] });
    return { ok: false, reason: 'invalid' };
  } catch (err) {
    // Timeout ou falha de rede. NÃO relança: o caller decide, e a decisão já
    // está tomada acima (fecha no caminho de desafio).
    const reason = err instanceof Error ? err.name : 'unknown';
    metrics.emit('signup.turnstile.unreachable', { reason });
    logger.warn('signup.turnstile.unreachable', { reason });
    return { ok: false, reason: 'unreachable' };
  }
}
