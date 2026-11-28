/**
 * S5 / P12.10 — SELO das âncoras das trilhas por carimbo de tempo RFC 3161 (parte pura: formato canônico e conferência).
 *
 * Por que existe: a cadeia de `audit-anchor.ts` só acusa adulteração se os resumos guardados fora forem confiáveis.
 * Guardar só os resumos num lugar que o dono do banco também controla (o mesmo banco, um arquivo editável, um Drive ou
 * e-mail da mesma identidade) não prova nada contra quem consegue alterar o banco E esse lugar. O selo resolve isso
 * sem serviço pago: uma Autoridade de Carimbo de Tempo (TSA) de TERCEIRO assina "este hash existia no instante T". Quem
 * reescreve a trilha depois não consegue um carimbo com data antiga para a cadeia nova. Com isso, o lugar onde selo e
 * âncoras ficam guardados só precisa de DISPONIBILIDADE (cópias), não de integridade.
 *
 * O que vai à TSA: só o SHA-256 do enunciado (32 bytes). Nenhum dado pessoal, nenhuma linha da trilha, nenhuma
 * contagem.
 *
 * O enunciado sela a CABEÇA de cada trilha (o resumo do último dia), que já compromete todos os dias anteriores da
 * mesma cadeia. A rede (pedir o carimbo) e a verificação criptográfica do carimbo (OpenSSL) ficam na ferramenta do
 * operador, `scripts/security/audit-anchor.ts` e `audit-anchor-tsa.ts`; aqui não há rede nem processo.
 *
 * Limite honesto: isto DETECTA, não impede; e quem apagar TODAS as cópias do selo apaga a prova. Por isso as cópias
 * precisam ficar também com alguém fora da administração da plataforma (`s5-contrato-trilha-59.md`).
 */
import { createHash } from 'node:crypto';

import { ANCHOR_GENESIS, type DayAnchor } from './audit-anchor';

export const SEAL_VERSION = 'qoro/audit-seal/v1';

const DAY = /^\d{4}-\d{2}-\d{2}$/u;
const HEX64 = /^[0-9a-f]{64}$/u;

const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export type AnchorFileFinding =
  | { kind: 'empty' }
  | { kind: 'mixed_trails' }
  | { kind: 'malformed'; index: number }
  | { kind: 'chain_broken'; day: string }
  | { kind: 'day_gap'; day: string }
  | { kind: 'wrong_start'; day: string };

/**
 * Consistência de UM arquivo de âncoras sem o banco: uma trilha só, dias seguidos, cada `prev` igual ao resumo da
 * linha anterior e o primeiro igual ao gênese (ou ao `startPrev` informado, quando a cadeia continua de um arquivo
 * anterior). Não recalcula resumos (isso exige as linhas: é o `verifyAnchors` contra o banco).
 */
export function checkAnchorFile(
  anchors: readonly DayAnchor[],
  startPrev: string = ANCHOR_GENESIS,
): AnchorFileFinding[] {
  if (anchors.length === 0) return [{ kind: 'empty' }];
  const findings: AnchorFileFinding[] = [];
  const trail = anchors[0]!.trail;
  anchors.forEach((a, index) => {
    if (
      !DAY.test(a.day) ||
      !HEX64.test(a.digest) ||
      !HEX64.test(a.prev) ||
      !Number.isInteger(a.count) ||
      a.count < 0
    ) {
      findings.push({ kind: 'malformed', index });
    }
  });
  if (anchors.some((a) => a.trail !== trail)) findings.push({ kind: 'mixed_trails' });
  if (anchors[0]!.prev !== startPrev) findings.push({ kind: 'wrong_start', day: anchors[0]!.day });
  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1]!;
    const cur = anchors[i]!;
    if (cur.day !== nextDay(prev.day)) findings.push({ kind: 'day_gap', day: cur.day });
    if (cur.prev !== prev.digest) findings.push({ kind: 'chain_broken', day: cur.day });
  }
  return findings;
}

export interface SealHead {
  trail: DayAnchor['trail'];
  /** Primeiro e último dia cobertos pelo arquivo de âncoras dessa trilha. */
  from: string;
  to: string;
  /** Resumo do último dia (compromete todos os anteriores). */
  head: string;
}

/** As cabeças, uma por trilha, em ordem de trilha (o enunciado não depende da ordem dos arquivos). */
export function sealHeads(files: ReadonlyArray<readonly DayAnchor[]>): SealHead[] {
  const heads = files.map((anchors) => {
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (!first || !last) throw new Error('arquivo de âncoras vazio');
    return { trail: last.trail, from: first.day, to: last.day, head: last.digest };
  });
  if (new Set(heads.map((h) => h.trail)).size !== heads.length) {
    throw new Error('mais de um arquivo para a mesma trilha');
  }
  return heads.sort((a, b) => (a.trail < b.trail ? -1 : 1));
}

/** Texto canônico do selo: versão e uma linha por trilha. O carimbo é pedido sobre o SHA-256 deste texto. */
export function sealStatement(heads: readonly SealHead[]): string {
  return [SEAL_VERSION, ...heads.map((h) => `${h.trail} ${h.from} ${h.to} ${h.head}`)].join('\n');
}

export const sealDigest = (statement: string): string =>
  createHash('sha256').update(statement, 'utf8').digest('hex');

export interface SealToken {
  /** Endereço da TSA que emitiu o carimbo (informativo: a prova é a assinatura, não o endereço). */
  tsa: string;
  /** Resposta RFC 3161 (`TimeStampResp`) em DER, base64. */
  response: string;
}

export interface SealRecord {
  version: typeof SEAL_VERSION;
  statement: string;
  digest: string;
  heads: SealHead[];
  tokens: SealToken[];
}

export function buildSeal(
  files: ReadonlyArray<readonly DayAnchor[]>,
  tokens: readonly SealToken[],
): SealRecord {
  const heads = sealHeads(files);
  const statement = sealStatement(heads);
  return {
    version: SEAL_VERSION,
    statement,
    digest: sealDigest(statement),
    heads,
    tokens: [...tokens],
  };
}

export type SealFinding =
  | { kind: 'version' }
  /** O enunciado guardado não bate com o próprio resumo (o selo foi editado). */
  | { kind: 'digest_mismatch' }
  /** As âncoras de hoje não são as que foram seladas (o arquivo de âncoras ou o banco mudou). */
  | { kind: 'statement_mismatch'; trail?: DayAnchor['trail'] }
  | { kind: 'no_token' }
  | { kind: 'anchor_file'; trail: DayAnchor['trail'] | 'unknown'; finding: AnchorFileFinding };

/**
 * Conferência ESTRUTURAL do selo contra os arquivos de âncoras (sem a TSA): versão, resumo do enunciado, as cabeças
 * de agora iguais às seladas e cada arquivo consistente. A assinatura do carimbo é conferida à parte (OpenSSL).
 */
export function checkSeal(
  seal: SealRecord,
  files: ReadonlyArray<readonly DayAnchor[]>,
): SealFinding[] {
  const findings: SealFinding[] = [];
  if (seal.version !== SEAL_VERSION) findings.push({ kind: 'version' });
  if (sealDigest(seal.statement) !== seal.digest) findings.push({ kind: 'digest_mismatch' });
  if (seal.tokens.length === 0) findings.push({ kind: 'no_token' });
  for (const anchors of files) {
    for (const finding of checkAnchorFile(anchors)) {
      findings.push({ kind: 'anchor_file', trail: anchors[0]?.trail ?? 'unknown', finding });
    }
  }
  let current: string;
  try {
    current = sealStatement(sealHeads(files));
  } catch {
    findings.push({ kind: 'statement_mismatch' });
    return findings;
  }
  if (current !== seal.statement) {
    const sealed = new Map(seal.heads.map((h) => [h.trail, h]));
    const differing = sealHeads(files).filter((h) => {
      const s = sealed.get(h.trail);
      return !s || s.head !== h.head || s.from !== h.from || s.to !== h.to;
    });
    if (differing.length === 0) findings.push({ kind: 'statement_mismatch' });
    for (const h of differing) findings.push({ kind: 'statement_mismatch', trail: h.trail });
  }
  return findings;
}

/**
 * O selo protege a partir do instante do carimbo. Entre o fim do último dia selado e o carimbo, quem controla o banco
 * ainda poderia reescrever a trilha sem deixar rastro: essa é a janela. Carimbo depois de `maxDelayHours` = selado
 * com atraso (vale, mas a janela foi maior que a combinada e isso aparece na conferência, nunca some).
 */
export function sealWindow(
  heads: readonly SealHead[],
  stampedAt: Date,
  maxDelayHours = 48,
): { hours: number; late: boolean } {
  const lastDayEnd = Math.max(
    ...heads.map((h) => new Date(`${nextDay(h.to)}T00:00:00Z`).getTime()),
  );
  const hours = Math.round(((stampedAt.getTime() - lastDayEnd) / 3_600_000) * 10) / 10;
  return { hours, late: hours > maxDelayHours };
}
