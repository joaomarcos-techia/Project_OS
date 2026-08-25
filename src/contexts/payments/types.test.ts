/**
 * Contrato de entrada da credencial (Zod).
 *
 * O teste mais importante daqui é o ÚLTIMO: o schema **não** valida prefixo. Se
 * alguém adicionar `startsWith('$aact_')` um dia, este teste quebra e conta o
 * porquê — no dia em que o Asaas emitir um formato novo, o sistema não pode
 * recusar uma chave válida e travar a clínica sem explicação.
 */
import { describe, expect, it } from 'vitest';

import { ConnectPaymentAccountSchema } from './types';

const parse = (apiKey: string) => ConnectPaymentAccountSchema.safeParse({ apiKey });

describe('ConnectPaymentAccountSchema', () => {
  it('aceita uma chave normal e remove espaços das pontas', () => {
    const result = parse('  $aact_chave_valida  ');
    expect(result.success).toBe(true);
    expect(result.success && result.data.apiKey).toBe('$aact_chave_valida');
  });

  it('recusa vazio', () => {
    expect(parse('').success).toBe(false);
    expect(parse('     ').success).toBe(false);
  });

  it('recusa espaço ou quebra de linha no meio (colagem quebrada)', () => {
    expect(parse('$aact_parte1 parte2').success).toBe(false);
    expect(parse('$aact_parte1\nparte2').success).toBe(false);
  });

  it('recusa conteúdo absurdamente grande (sanidade, não formato)', () => {
    expect(parse('a'.repeat(1025)).success).toBe(false);
    expect(parse('a'.repeat(1024)).success).toBe(true);
  });

  it('NÃO valida prefixo: formato de chave é decisão do Asaas, não nossa', () => {
    expect(parse('formato_novo_sem_aact_123').success).toBe(true);
  });
});
