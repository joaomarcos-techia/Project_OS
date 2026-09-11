import { describe, expect, it } from 'vitest';

import type { AccountingMovementDTO } from './types';
import {
  ACCOUNTING_EXPORT_MAX_ROWS,
  AccountingExportError,
  accountingCashEffect,
  accountingMonthRange,
  accountingMovementType,
  assertAccountingRowLimit,
  currentMonthInTimeZone,
  renderAccountingCsv,
} from './accounting-export';

const baseMovement: AccountingMovementDTO = {
  transactionId: '10000000-0000-4000-8000-000000000001',
  lancamentoId: '20000000-0000-4000-8000-000000000001',
  occurredAt: '2026-08-15T15:34:56.000Z',
  transactionKind: 'payment',
  lancamentoTipo: 'receber',
  description: 'Consulta clínica',
  amount: 150,
  cashEffect: 150,
  paymentMethod: 'pix',
  paymentMethodLabel: 'PIX',
  dueDate: '2026-08-15',
  lancamentoStatus: 'pago',
  createdVia: 'auto',
  supplierName: null,
  supplierCnpj: null,
  originalPaymentId: null,
  reason: null,
};

describe('accounting export', () => {
  it.each([
    ['receber', 'payment', 100, 'recebimento'],
    ['pagar', 'payment', -100, 'pagamento'],
    ['receber', 'refund', -100, 'estorno_recebimento'],
    ['pagar', 'refund', 100, 'estorno_pagamento'],
  ] as const)(
    'calcula %s + %s com efeito %s',
    (lancamentoTipo, transactionKind, effect, movementType) => {
      expect(accountingCashEffect(lancamentoTipo, transactionKind, 100)).toBe(effect);
      expect(accountingMovementType(lancamentoTipo, transactionKind)).toBe(movementType);
    },
  );

  it('calcula o mês vigente no fuso da clínica', () => {
    expect(currentMonthInTimeZone('America/Sao_Paulo', new Date('2026-01-01T01:00:00Z'))).toBe(
      '2025-12',
    );
  });

  it('converte o mês local em intervalo UTC exclusivo', () => {
    const range = accountingMonthRange('2026-08', 'America/Sao_Paulo');
    expect(range).toEqual({
      month: '2026-08',
      from: new Date('2026-08-01T03:00:00.000Z'),
      to: new Date('2026-09-01T03:00:00.000Z'),
    });
  });

  it.each(['2026-00', '2026-13', '1999-12', '2101-01', '08/2026'])(
    'recusa mês inválido %s',
    (month) => {
      expect(() => accountingMonthRange(month, 'America/Sao_Paulo')).toThrow(AccountingExportError);
    },
  );

  it('não permite que o teto seja tratado como export completo', () => {
    expect(() => assertAccountingRowLimit(ACCOUNTING_EXPORT_MAX_ROWS)).not.toThrow();
    expect(() => assertAccountingRowLimit(ACCOUNTING_EXPORT_MAX_ROWS + 1)).toThrowError(
      expect.objectContaining({ code: 'too_many_rows', httpStatus: 422 }),
    );
  });

  it('gera CSV mensal sem PII clínica e neutraliza fórmulas de planilha', () => {
    const csv = renderAccountingCsv(
      [
        {
          ...baseMovement,
          description: '=HYPERLINK("https://example.invalid")',
          supplierName: '+Fornecedor',
          supplierCnpj: '11222333000181',
          reason: '@motivo',
        },
      ],
      'America/Sao_Paulo',
    );

    const [header, row] = csv.split('\r\n');
    expect(header).toContain('data_movimento;hora_movimento;tipo_movimento');
    expect(header).not.toMatch(/paciente|cpf|diagnostico|prontuario/i);
    expect(row).toContain('"15/08/2026";"12:34:56";"recebimento"');
    expect(row).toContain('"\'=HYPERLINK(""https://example.invalid"")"');
    expect(row).toContain('"\'+Fornecedor"');
    expect(row).toContain('"\'@motivo"');
    expect(row).toContain('"11222333000181";"150,00";"150,00";"PIX"');
  });

  it('mantém estorno com valor positivo e efeito de caixa negativo', () => {
    const csv = renderAccountingCsv(
      [
        {
          ...baseMovement,
          transactionKind: 'refund',
          amount: 10,
          cashEffect: -10,
          originalPaymentId: baseMovement.transactionId,
          reason: 'Ajuste solicitado',
        },
      ],
      'UTC',
    );

    expect(csv).toContain('"estorno_recebimento"');
    expect(csv).toContain('"10,00";"-10,00"');
    expect(csv).toContain(`"${baseMovement.transactionId}";"Ajuste solicitado"`);
  });

  it.each([
    '  =1+1',
    '\n+SUM(1;1)',
    '\u00a0@IMPORTXML("https://example.invalid")',
    // BOM antes do operador: \s em JS casa \ufeff, e a planilha descarta o
    // marcador antes de decidir se a célula é fórmula.
    '\ufeff=1+1',
    // O hífen abre fórmula tanto quanto o igual: -2+3 é avaliado pela planilha.
    '-2+3',
    ' -2+3',
  ])('neutraliza fórmula direta ou camuflada por whitespace/BOM: %j', (description) => {
    const csv = renderAccountingCsv([{ ...baseMovement, description }], 'UTC');

    expect(csv).toContain(`"'${description.replaceAll('"', '""')}"`);
  });
});
