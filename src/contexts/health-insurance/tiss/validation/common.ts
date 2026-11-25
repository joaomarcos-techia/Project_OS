/**
 * Peças comuns dos validadores de guia TISS.
 */
import { isValidCnpj } from '@/lib/validation/cnpj';

import type { TerminologyLookup } from '../terminology/lookup';

/** Quem normalmente resolve a pendência. `medico` só para dado clínico que só ele pode informar. */
export type IssueOwner = 'gestor' | 'recepcao' | 'financeiro' | 'medico';

export interface GuideIssue {
  code: string;
  /** Caminho do campo na guia (ex.: `profissional.cbo`). */
  field: string;
  /** Explicação para quem não conhece o TISS. */
  message: string;
  owner: IssueOwner;
}

export class IssueCollector {
  readonly issues: GuideIssue[] = [];

  constructor(private readonly terminology: TerminologyLookup) {}

  add(code: string, field: string, message: string, owner: IssueOwner): void {
    this.issues.push({ code, field, message, owner });
  }

  inTable(table: string, code: string | null | undefined): boolean {
    return code != null && this.terminology.term(table, code) !== null;
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function isRealDate(value: string | null | undefined): value is string {
  if (value == null || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isRealTime(value: string | null | undefined): value is string {
  return value != null && /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u.test(value);
}

export function lengthBetween(value: string | null | undefined, min: number, max: number): boolean {
  return value != null && value.length >= min && value.length <= max;
}

export function hasNonLatin1(value: string | null | undefined): boolean {
  return value != null && [...value].some((ch) => ch.codePointAt(0)! > 0xff);
}

/** Maior valor representável em `st_decimal10-2` (8 inteiros + 2 decimais), em centavos. */
export const TISS_MAX_MONEY_CENTS = 9_999_999_999;

/**
 * CNPJ como o XML exige (`st_CNPJ`): 14 caracteres já canônicos, sem pontuação
 * e em maiúsculas, com os dígitos verificadores corretos (numérico ou
 * alfanumérico). Mais estrito que o cadastro: aqui não se normaliza, porque o
 * valor vai literalmente para o arquivo.
 */
export function isTissCnpj(value: string | null | undefined): boolean {
  return value != null && /^[A-Z0-9]{12}[0-9]{2}$/u.test(value) && isValidCnpj(value);
}
