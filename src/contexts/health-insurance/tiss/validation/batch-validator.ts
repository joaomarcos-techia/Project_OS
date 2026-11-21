/**
 * Regras do lote (`loteGuias`) que valem acima de cada guia: o XSD não pega
 * todas (guia repetida, operadora diferente do destino, versão aceita pelo XSD
 * mas diferente da que o Qoro gera). As regras de cada guia ficam nos
 * validadores da Consulta e da SP/SADT.
 */
import type { LoteGuiasInput } from '../messages/lote-guias';
import { TISS_MAX_GUIDES_PER_BATCH } from '../messages/lote-guias';

import { isRealDate, isRealTime, lengthBetween, type GuideIssue } from './common';

/** Versão de comunicação que o Qoro gera hoje (C.9 do plano mestre). */
export const TISS_SUPPORTED_VERSION = '4.03.00';

export function validateLoteGuias(input: LoteGuiasInput): GuideIssue[] {
  const issues: GuideIssue[] = [];
  const add = (code: string, field: string, message: string): void => {
    issues.push({ code, field, message, owner: 'financeiro' });
  };

  if ((input.padrao as string) !== TISS_SUPPORTED_VERSION) {
    add(
      'BATCH_VERSION',
      'padrao',
      `O Qoro gera a versão ${TISS_SUPPORTED_VERSION} do Padrão TISS; o lote declara ${input.padrao}. O XSD aceita versões antigas no campo, mas a estrutura é a da ${TISS_SUPPORTED_VERSION}.`,
    );
  }
  const count = input.lote.guides.length;
  if (count === 0) add('BATCH_EMPTY', 'guias', 'O lote não tem guias.');
  if (count > TISS_MAX_GUIDES_PER_BATCH) {
    add(
      'BATCH_TOO_LARGE',
      'guias',
      `O lote tem ${count} guias; o Padrão TISS aceita até ${TISS_MAX_GUIDES_PER_BATCH}. Divida em mais lotes.`,
    );
  }
  if (!/^\d{6}$/u.test(input.registroANSDestino)) {
    add('ANS_REGISTRY_FORMAT', 'registroANSDestino', 'O registro ANS da operadora tem 6 dígitos.');
  }
  if (!lengthBetween(input.sequencialTransacao, 1, 12)) {
    add(
      'TRANSACTION_SEQUENCE',
      'sequencialTransacao',
      'O sequencial da transação tem de 1 a 12 caracteres.',
    );
  }
  if (!lengthBetween(input.numeroLote, 1, 12)) {
    add('BATCH_NUMBER', 'numeroLote', 'O número do lote tem de 1 a 12 caracteres.');
  }
  if (!isRealDate(input.dataRegistro)) {
    add(
      'TRANSACTION_DATE',
      'dataRegistro',
      'A data de registro da transação não é uma data válida.',
    );
  }
  if (!isRealTime(input.horaRegistro)) {
    add(
      'TRANSACTION_TIME',
      'horaRegistro',
      'A hora de registro da transação não é válida (HH:MM:SS).',
    );
  }

  const seen = new Map<string, number>();
  input.lote.guides.forEach((guide, i) => {
    if (guide.registroANS !== input.registroANSDestino) {
      add(
        'GUIDE_OPERATOR_MISMATCH',
        `guias[${i}].registroANS`,
        `A guia ${guide.numeroGuiaPrestador} é da operadora ${guide.registroANS}, mas o lote vai para ${input.registroANSDestino}. Cada lote é de uma operadora.`,
      );
    }
    const first = seen.get(guide.numeroGuiaPrestador);
    if (first === undefined) {
      seen.set(guide.numeroGuiaPrestador, i);
    } else {
      add(
        'GUIDE_NUMBER_DUPLICATED',
        `guias[${i}].numeroGuiaPrestador`,
        `O número de guia ${guide.numeroGuiaPrestador} aparece mais de uma vez no lote (posições ${first + 1} e ${i + 1}). A operadora recusa guia repetida.`,
      );
    }
  });
  return issues;
}
