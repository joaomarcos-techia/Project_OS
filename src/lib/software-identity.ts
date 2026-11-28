/**
 * Identificação do software (P12.11; componente de segurança da ANS, requisito 36 e S7): fornecedor,
 * software e versão, iguais nas telas de Convênios e nos documentos TISS (PDF da guia, via de
 * atendimento, pedido SP/SADT).
 *
 * A versão vem SEMPRE do build (o commit que a Vercel publicou, `VERCEL_GIT_COMMIT_SHA`), nunca de
 * um número digitado. Sem build (máquina local, teste), a versão aparece como "sem build", e não
 * como uma versão inventada. Arquivo puro: servidor e componentes leem a mesma função.
 */
export const SOFTWARE_VENDOR = 'Qoro';
export const SOFTWARE_NAME = 'Qoro Convênios';
export const SOFTWARE_STANDARD = 'TISS 4.03.00';

export interface SoftwareIdentity {
  vendor: string;
  name: string;
  /** 12 primeiros caracteres do commit publicado; null sem build. */
  version: string | null;
  standard: string;
}

export function softwareIdentity(env: Record<string, string | undefined> = process.env): SoftwareIdentity {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  return {
    vendor: SOFTWARE_VENDOR,
    name: SOFTWARE_NAME,
    version: sha && /^[0-9a-f]{7,40}$/iu.test(sha) ? sha.slice(0, 12).toLowerCase() : null,
    standard: SOFTWARE_STANDARD,
  };
}

/** "Fornecedor Qoro · Qoro Convênios · versão abc123def456 · TISS 4.03.00" (telas). */
export function softwareIdentityLine(id: SoftwareIdentity = softwareIdentity()): string {
  return `Fornecedor ${id.vendor} · ${id.name} · versão ${id.version ?? 'sem build'} · ${id.standard}`;
}
