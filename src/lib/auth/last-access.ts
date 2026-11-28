/**
 * R42 — aviso de último acesso (requisito 42 do componente de segurança da ANS): "data e hora da última
 * autenticação com sucesso" e "data e hora das tentativas sem sucesso depois dela" (aqui a contagem; o detalhe fica
 * na trilha). O login grava um cookie curto, HttpOnly, só com datas e contagem; o layout lê UMA vez e apaga.
 * Nada vem do navegador: o valor é assinado pelo servidor.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const LAST_ACCESS_COOKIE = 'qoro_ultimo_acesso';
export const LAST_ACCESS_MAX_AGE_SECONDS = 300;

export interface LastAccessNotice {
  previousSuccessAt: string | null;
  failuresSince: number;
}

const sign = (payload: string, secret: string) =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function encodeLastAccess(notice: LastAccessNotice, secret: string): string {
  const payload = Buffer.from(JSON.stringify(notice)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeLastAccess(
  value: string | undefined,
  secret: string,
): LastAccessNotice | null {
  if (!value) return null;
  const [payload, mac] = value.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, secret));
  const got = Buffer.from(mac);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const n = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LastAccessNotice;
    if (
      typeof n.failuresSince !== 'number' ||
      (n.previousSuccessAt !== null && typeof n.previousSuccessAt !== 'string')
    )
      return null;
    return n;
  } catch {
    return null;
  }
}

/** Texto do aviso, no fuso da clínica. */
export function lastAccessMessage(n: LastAccessNotice, timeZone = 'America/Sao_Paulo'): string {
  if (!n.previousSuccessAt) return 'Este é o seu primeiro acesso registrado.';
  const when = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(n.previousSuccessAt));
  const fails =
    n.failuresSince === 0
      ? 'nenhuma tentativa sem sucesso desde então'
      : `${n.failuresSince} tentativa${n.failuresSince > 1 ? 's' : ''} sem sucesso desde então`;
  return `Seu último acesso foi em ${when}; ${fails}.`;
}

/** Chave do aviso derivada do segredo do servidor, com separação de domínio (mesmo padrão do recovery-grant). */
export function lastAccessSecret(): string {
  const base = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error('[auth/last-access] SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY ausente.');
  return createHmac('sha256', base).update('qoro/last-access/v1').digest('base64url');
}
