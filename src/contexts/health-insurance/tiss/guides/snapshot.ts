/**
 * Snapshot da guia emitida (P1.8, `hi_guide_snapshots`).
 *
 * O conteúdo é o dado TISS montado (`ConsultaGuideData` ou `SpSadtGuideData`),
 * serializado em JSON CANÔNICO (chaves em ordem, sem `undefined`) para que o
 * SHA-256 seja reproduzível: o hash gravado no banco é conferido em toda leitura
 * (`internal/guide-access.ts`). O conteúdo tem a carteirinha, então só vai ao
 * banco cifrado por clínica (`encryptForTenant`); este módulo é puro e não cifra.
 *
 * `print` (opcional, desde 12/11): o que só existe no impresso (nome do
 * beneficiário, nome do contratado…), congelado na emissão para o PDF oficial.
 * Fica FORA de `data`: o XML nunca o lê. Snapshot sem `print` não gera PDF
 * (nada é reconstruído do cadastro atual); a guia é reemitida.
 */
import { createHash } from 'node:crypto';

import { assertGuidePrintData, GuidePrintError, type GuidePrintData } from '../print/print-data';

import type { ConsultaGuideData } from './consulta';
import type { SpSadtGuideData } from './sp-sadt';

export const GUIDE_SNAPSHOT_SCHEMA = 'qoro.hi.guide-snapshot/1' as const;

export type GuideSnapshotContent =
  | {
      schema: typeof GUIDE_SNAPSHOT_SCHEMA;
      guideType: 'consulta';
      tissVersion: '4.03.00';
      terminologyVersion: string;
      data: ConsultaGuideData;
      print?: GuidePrintData;
    }
  | {
      schema: typeof GUIDE_SNAPSHOT_SCHEMA;
      guideType: 'sp_sadt';
      tissVersion: '4.03.00';
      terminologyVersion: string;
      data: SpSadtGuideData;
      print?: GuidePrintData;
    };

export class GuideSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuideSnapshotError';
  }
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : canonicalize(v)));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new GuideSnapshotError('número não finito no snapshot');
  }
  if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
    throw new GuideSnapshotError(`tipo não serializável no snapshot: ${typeof value}`);
  }
  return value;
}

/** JSON canônico: mesma entrada → mesmos bytes, independentemente da ordem das chaves. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Serializa o snapshot e devolve o texto (para cifrar) e o SHA-256 (para gravar). */
export function serializeGuideSnapshot(content: GuideSnapshotContent): {
  json: string;
  sha256: string;
} {
  const json = canonicalJson(content);
  return { json, sha256: sha256Hex(json) };
}

/**
 * Lê o snapshot decifrado e confere o SHA-256 gravado. Divergência é erro:
 * conteúdo adulterado ou corrompido nunca é devolvido como se fosse a guia emitida.
 */
export function parseVerifiedGuideSnapshot(
  json: string,
  expectedSha256: string,
): GuideSnapshotContent {
  if (sha256Hex(json) !== expectedSha256) {
    throw new GuideSnapshotError('o snapshot não confere com o SHA-256 gravado');
  }
  const parsed = JSON.parse(json) as Partial<GuideSnapshotContent>;
  if (
    parsed.schema !== GUIDE_SNAPSHOT_SCHEMA ||
    (parsed.guideType !== 'consulta' && parsed.guideType !== 'sp_sadt') ||
    parsed.tissVersion !== '4.03.00' ||
    typeof parsed.terminologyVersion !== 'string' ||
    typeof parsed.data !== 'object' ||
    parsed.data === null
  ) {
    throw new GuideSnapshotError('formato de snapshot desconhecido');
  }
  if (parsed.print !== undefined) {
    try {
      assertGuidePrintData(parsed.print);
    } catch (e) {
      if (e instanceof GuidePrintError) throw new GuideSnapshotError(`bloco de impressão inválido: ${e.message}`);
      throw e;
    }
  }
  return parsed as GuideSnapshotContent;
}
