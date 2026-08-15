/**
 * Autorização ONE-TIME de redefinição de senha (AUTH-006).
 *
 * ===================================================================
 * O problema
 * ===================================================================
 * `/reset-password` e `resetPasswordAction()` consideravam QUALQUER
 * `getUser()` uma sessão de recovery válida. O pentest fez o óbvio: logou
 * normalmente com senha, navegou direto para `/reset-password` e trocou a
 * credencial — sem link, sem senha atual, sem nada. Uma sessão roubada virava
 * takeover permanente da conta.
 *
 * "Tem sessão" não é prova de recovery. Prova de recovery é ter apresentado um
 * token de recovery — e isso só acontece dentro de `verifyOtp(type:'recovery')`,
 * no servidor.
 *
 * ===================================================================
 * O desenho
 * ===================================================================
 * `/auth/confirm`, depois de um `verifyOtp(type:'recovery')` BEM-SUCEDIDO,
 * emite um grant assinado em cookie HttpOnly. A action exige e consome esse
 * grant. Nenhum outro caminho o emite — em particular, não existe forma de uma
 * sessão comum minerar um: se existisse, o achado continuaria de pé.
 *
 * O QUE TORNA O GRANT ONE-TIME, sem tabela nova: ele carrega o
 * `claims_version` (o epoch de sessão do ADR-037) lido no instante da emissão,
 * e a validação exige que o epoch do banco AINDA seja aquele. Como o reset
 * bem-sucedido bumpa o epoch (AUTH-007), o mesmo grant deixa de validar no
 * instante seguinte. De quebra, qualquer outra revogação (logout, troca de
 * role, desativação) também invalida um grant pendente — que é exatamente o
 * comportamento conservador desejado.
 *
 * Isso não substitui nada existente: anti-open-redirect do `/auth/confirm`,
 * mensagem genérica, rate limit e uso único do link do provedor continuam.
 */
import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';

export const RECOVERY_GRANT_COOKIE = 'qoro_rcv';

/**
 * Janela curta: tempo de digitar uma senha, não de deixar a aba aberta. Um
 * grant expirado devolve o usuário ao "peça um novo link", que é barato.
 */
export const RECOVERY_GRANT_TTL_SECONDS = 15 * 60;

const VERSION = 'v1';
const SEP = '.';

/**
 * Chave derivada do secret do Supabase com SEPARAÇÃO DE DOMÍNIO.
 *
 * Por que este secret: ele está presente em todo runtime onde autenticação
 * funciona, então o grant nunca fica indisponível por variável esquecida —
 * introduzir um `RECOVERY_GRANT_SECRET` novo criaria uma dependência de deploy
 * capaz de derrubar o recovery inteiro. Por que derivar em vez de usar direto:
 * uma chave HMAC de propósito único nunca deve ser o próprio segredo de outro
 * sistema; o rótulo garante que nada assinado aqui vale em outro lugar.
 */
function key(): Buffer {
  const base = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) {
    throw new Error('[auth/recovery-grant] SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY ausente.');
  }
  return createHmac('sha256', base).update('qoro/recovery-grant/v1').digest();
}

function mac(payload: string): string {
  return createHmac('sha256', key()).update(payload).digest('hex');
}

export interface RecoveryGrant {
  userId: string;
  /** `claims_version` no instante da emissão — o que torna o grant one-time. */
  epoch: number;
  /** Epoch ms de expiração. */
  expiresAt: number;
}

/** Serializa e assina. O valor vai num cookie HttpOnly — nunca no DOM/URL. */
export function signRecoveryGrant(grant: RecoveryGrant): string {
  const payload = [VERSION, grant.userId, String(grant.epoch), String(grant.expiresAt)].join(SEP);
  return `${payload}${SEP}${mac(payload)}`;
}

/**
 * Verifica assinatura e validade temporal. NÃO confere o epoch contra o banco
 * — isso é responsabilidade do consumidor, que precisa da leitura autoritativa
 * e é quem sabe qual usuário está pedindo a troca.
 *
 * Devolve `null` para ausente, malformado, forjado ou expirado: o consumidor
 * trata os quatro com a mesma mensagem genérica.
 */
export function readRecoveryGrant(
  value: string | undefined,
  now: number = Date.now(),
): RecoveryGrant | null {
  if (!value) return null;
  const idx = value.lastIndexOf(SEP);
  if (idx <= 0) return null;

  const payload = value.slice(0, idx);
  const sig = value.slice(idx + 1);
  const expected = mac(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const [version, userId, epochRaw, expiresRaw] = payload.split(SEP);
  if (version !== VERSION || !userId || !epochRaw || !expiresRaw) return null;

  const epoch = Number(epochRaw);
  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(epoch) || !Number.isInteger(expiresAt)) return null;
  if (expiresAt <= now) return null;

  return { userId, epoch, expiresAt };
}
