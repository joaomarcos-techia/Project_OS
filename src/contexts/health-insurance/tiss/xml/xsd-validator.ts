/**
 * Validação no XSD oficial da ANS (camada XSD da C.13) como PORTA, para quem exporta ou
 * importa XML TISS. O motor é o do app (`xsd-engine.ts`, `xmllint-wasm` 5.3.0 da D7,
 * dependência do `package.json` desde a P9.2).
 *
 * `loadXmllintValidator` devolve `null` se o motor não puder ser montado (pacote ausente ou
 * adulterado, XSD ausentes ou fora do MANIFEST): quem exporta RECUSA sem validador. Depois
 * de montado, o validador LANÇA `XsdEngineError` quando o motor falha (timeout, memória,
 * fila cheia, falha do WASM): falha do validador nunca é "válido".
 */
import 'server-only';

import { createTissXsdEngine, getTissXsdEngine, XsdEngineError, type XsdEngineOptions } from './xsd-engine';

export { maskValues, XsdEngineError } from './xsd-engine';

export interface XsdResult {
  valid: boolean;
  /** Mensagens do motor, curtas, sem o conteúdo do arquivo. */
  errors: string[];
  engine: string;
  /** Recusa antes do parser (estrutura, DTD, namespace, versão) ou no XSD. */
  stage?: 'envelope' | 'xsd';
  /** SHA-256 do conjunto de XSD carregado (rastreabilidade da validação). */
  schemaSetSha256?: string;
  ms?: number;
}

export type TissSchemaValidator = (xml: { fileName: string; bytes: Uint8Array }) => Promise<XsdResult>;

export function loadXmllintValidator(opts?: XsdEngineOptions): TissSchemaValidator | null {
  let engine;
  try {
    engine = opts ? createTissXsdEngine(opts) : getTissXsdEngine();
  } catch (error) {
    if (error instanceof XsdEngineError) return null;
    throw error;
  }
  return async (xml) => {
    const r = await engine.validate({ bytes: xml.bytes });
    return {
      valid: r.valid,
      errors: r.errors,
      engine: r.engine,
      stage: r.stage,
      schemaSetSha256: r.schemaSetSha256,
      ms: r.ms,
    };
  };
}
