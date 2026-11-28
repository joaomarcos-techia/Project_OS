/**
 * S5 / P12.10 — carimbo de tempo RFC 3161 para o selo das âncoras (`src/lib/db/audit-anchor-seal.ts`), pelo OpenSSL
 * (sem dependência nova): montar o pedido, pedir à TSA por HTTP, ler a resposta e conferir a assinatura.
 *
 * O pedido leva só o SHA-256 do enunciado do selo (sem dado pessoal, sem linha da trilha). TSAs públicas e gratuitas
 * servem (por exemplo a da DigiCert, `http://timestamp.digicert.com`); a confiança vem da assinatura da TSA, conferida
 * com o certificado raiz dela, não do canal.
 *
 * `ANCHOR_OPENSSL` aponta outro binário do OpenSSL, se o do PATH não servir.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OPENSSL = process.env.ANCHOR_OPENSSL ?? 'openssl';
const HEX64 = /^[0-9a-f]{64}$/u;

export function openssl(args: readonly string[]): string {
  return execFileSync(OPENSSL, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'qoro-tsa-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Pedido RFC 3161 (`TimeStampReq`, DER) para o resumo, com nonce e pedindo o certificado da TSA na resposta. */
export function timestampQuery(digestHex: string): Buffer {
  if (!HEX64.test(digestHex)) throw new Error('resumo inválido (esperado SHA-256 em hexadecimal)');
  return withTempDir((dir) => {
    const out = path.join(dir, 'pedido.tsq');
    openssl(['ts', '-query', '-digest', digestHex, '-sha256', '-cert', '-out', out]);
    return readFileSync(out);
  });
}

export interface TimestampInfo {
  granted: boolean;
  status: string;
  stampedAt: Date | null;
  /** O resumo que a TSA carimbou (o `messageImprint`). */
  digest: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Lê a resposta (`TimeStampResp`, DER): situação, instante e resumo carimbado. Não confere a assinatura. */
export function timestampInfo(response: Buffer): TimestampInfo {
  return withTempDir((dir) => {
    const file = path.join(dir, 'resposta.tsr');
    writeFileSync(file, response);
    let text: string;
    try {
      text = openssl(['ts', '-reply', '-in', file, '-text']);
    } catch {
      return { granted: false, status: 'resposta ilegível', stampedAt: null, digest: null };
    }
    const status = /^Status:\s*(.+)$/mu.exec(text)?.[1]?.trim() ?? 'desconhecido';
    const t =
      /^Time stamp:\s*([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s+(\d{4})\s+GMT/mu.exec(
        text,
      );
    const stampedAt = t
      ? new Date(
          Date.UTC(
            Number(t[6]),
            MONTHS.indexOf(t[1]!),
            Number(t[2]),
            Number(t[3]),
            Number(t[4]),
            Number(t[5]),
          ),
        )
      : null;
    const block = /^Message data:\s*\n((?:\s+[0-9a-f]{4} - .*\n?)+)/imu.exec(text)?.[1] ?? '';
    const digest =
      block
        .split('\n')
        .map(
          (line) =>
            /^\s*[0-9a-f]{4} - ([0-9a-f]{2}(?:[ -][0-9a-f]{2}){0,15})/iu
              .exec(line)?.[1]
              ?.replace(/[ -]/gu, '') ?? '',
        )
        .join('')
        .toLowerCase() || null;
    return { granted: /^Granted/u.test(status), status, stampedAt, digest };
  });
}

/**
 * Confere a assinatura do carimbo E que ele é deste resumo, com o(s) certificado(s) raiz confiáveis (`caFile`).
 * `untrustedFile` = intermediários, se a TSA não os mandar na resposta.
 */
export function verifyTimestamp(
  response: Buffer,
  digestHex: string,
  caFile: string,
  untrustedFile?: string,
): { ok: boolean; detail: string } {
  return withTempDir((dir) => {
    const file = path.join(dir, 'resposta.tsr');
    writeFileSync(file, response);
    try {
      const out = openssl([
        'ts',
        '-verify',
        '-in',
        file,
        '-digest',
        digestHex,
        '-CAfile',
        caFile,
        ...(untrustedFile ? ['-untrusted', untrustedFile] : []),
      ]);
      return { ok: /Verification: OK/u.test(out), detail: out.trim() };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      const detail = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message || 'falha';
      return { ok: false, detail: detail.split('\n').slice(0, 3).join(' | ') };
    }
  });
}

/** Pede o carimbo a UMA TSA e confere que foi concedido para este resumo (sem rede = erro; nada é gravado). */
export async function requestTimestamp(
  tsaUrl: string,
  digestHex: string,
  timeoutMs = 20_000,
): Promise<Buffer> {
  const res = await fetch(tsaUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/timestamp-query' },
    body: new Uint8Array(timestampQuery(digestHex)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`a TSA respondeu HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const info = timestampInfo(body);
  if (!info.granted) throw new Error(`a TSA não concedeu o carimbo (${info.status})`);
  if (info.digest !== digestHex) throw new Error('o carimbo devolvido não é deste resumo');
  return body;
}

/** Pede a VÁRIAS TSAs (independentes entre si): o selo vale com pelo menos um carimbo; as falhas vêm junto. */
export async function collectTimestamps(
  tsaUrls: readonly string[],
  digestHex: string,
): Promise<{ tokens: Array<{ tsa: string; response: string }>; errors: string[] }> {
  const tokens: Array<{ tsa: string; response: string }> = [];
  const errors: string[] = [];
  for (const tsa of tsaUrls) {
    try {
      tokens.push({ tsa, response: (await requestTimestamp(tsa, digestHex)).toString('base64') });
    } catch (error) {
      errors.push(`${tsa}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { tokens, errors };
}
