/**
 * Validação no XSD oficial da ANS (camada 1 da C.13), como PORTA.
 *
 * O motor avaliado e aprovado (D7) é o `xmllint-wasm` (libxml2 em WebAssembly).
 * Ele só entra no `package.json` na P9.2, junto com a prova na Preview da Vercel.
 * Até lá, `loadXmllintValidator` procura o pacote em `TISS_XMLLINT_WASM_DIR`
 * (ou no próprio projeto) e devolve `null` se não achar — e quem exporta lote
 * RECUSA sem validador: nenhum XML sai sem passar no XSD.
 */
import 'server-only';

import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export interface XsdResult {
  valid: boolean;
  /** Mensagens do motor, curtas, sem o conteúdo do arquivo. */
  errors: string[];
  engine: string;
}

export type TissSchemaValidator = (xml: { fileName: string; bytes: Uint8Array }) => Promise<XsdResult>;

interface XmllintModule {
  validateXML(opts: {
    xml: { fileName: string; contents: Uint8Array };
    schema: { fileName: string; contents: Uint8Array };
    preload: Array<{ fileName: string; contents: Uint8Array }>;
  }): Promise<{ valid: boolean; errors: Array<{ message: string }> }>;
}

const ROOT_SCHEMA = 'tissV4_03_00.xsd';

/**
 * Troca os VALORES citados pelo motor (podem ser nome ou carteirinha) por
 * reticências e mantém o nome do elemento e a regra do XSD, que dizem o que corrigir.
 * Formatos do libxml2: "The value 'V' …" e "Element 'E': 'V' is not a valid value …".
 */
export function maskValues(message: string): string {
  return message
    .replace(/(\bvalue\s+)'[^']*'/giu, "$1'…'")
    .replace(/(:\s*)'[^']*'(\s+is not)/giu, "$1'…'$2")
    .replace(/"[^"]*"/gu, '"…"')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 240);
}

export function loadXmllintValidator(opts: { schemaDir?: string; packageDir?: string } = {}): TissSchemaValidator | null {
  const from = opts.packageDir ?? process.env.TISS_XMLLINT_WASM_DIR;
  let mod: XmllintModule;
  let version: string;
  try {
    const req = createRequire(path.join(from ?? process.cwd(), 'package.json'));
    mod = req('xmllint-wasm') as XmllintModule;
    version = (req('xmllint-wasm/package.json') as { version: string }).version;
  } catch {
    return null;
  }
  const schemaDir =
    opts.schemaDir ?? path.join(process.cwd(), 'src/contexts/health-insurance/tiss/schemas/4.03.00');
  const xsds = readdirSync(schemaDir)
    .filter((f) => f.endsWith('.xsd'))
    .map((f) => ({ fileName: f, contents: new Uint8Array(readFileSync(path.join(schemaDir, f))) }));
  const schema = xsds.find((x) => x.fileName === ROOT_SCHEMA);
  if (!schema) return null;
  const preload = xsds.filter((x) => x !== schema);
  return async (xml) => {
    const r = await mod.validateXML({
      xml: { fileName: xml.fileName, contents: xml.bytes },
      schema,
      preload,
    });
    return {
      valid: r.valid,
      // Valor de campo nunca sai do validador: o libxml2 cita o conteúdo entre aspas.
      errors: r.errors.slice(0, 5).map((e) => maskValues(e.message)),
      engine: `xmllint-wasm@${version}`,
    };
  };
}
