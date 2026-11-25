import { describe, expect, it } from 'vitest';

import {
  SandboxGuardError,
  assertAsaasSandbox,
  loadAsaasSandboxCredentials,
} from './sandbox-guard';

// Valores fictícios: só o formato importa.
const HMLG = 'fake-$aact_hmlg-FAKE';
const PROD = 'fake-$aact_prod-FAKE';

describe('trava de sandbox do Asaas (R23)', () => {
  it('libera só host de sandbox com chave de homologação', () => {
    expect(
      assertAsaasSandbox({ baseUrl: 'https://sandbox.asaas.com/api/v3', apiKey: HMLG }),
    ).toBeTruthy();
    expect(
      assertAsaasSandbox({ baseUrl: 'https://api-sandbox.asaas.com/v3', apiKey: HMLG }),
    ).toBeTruthy();
  });

  it.each([
    ['host de produção', 'https://api.asaas.com/v3', HMLG],
    ['chave de produção no sandbox', 'https://sandbox.asaas.com/api/v3', PROD],
    ['sem https', 'http://sandbox.asaas.com/api/v3', HMLG],
    ['host parecido', 'https://sandbox.asaas.com.evil.test/api/v3', HMLG],
    ['URL inválida', 'sandbox', HMLG],
    ['chave sem prefixo', 'https://sandbox.asaas.com/api/v3', 'qualquer'],
  ])('recusa %s', (_l, baseUrl, apiKey) => {
    expect(() => assertAsaasSandbox({ baseUrl, apiKey })).toThrow(SandboxGuardError);
  });

  it('lê só as variáveis _DEV: as sem sufixo (produção) nunca são usadas como fallback', () => {
    const env = [
      'ASAAS_BASE_URL=https://api.asaas.com/v3',
      `ASAAS_API_KEY=${PROD}`,
      'ASAAS_BASE_URL_DEV="https://sandbox.asaas.com/api/v3"',
      `ASAAS_API_KEY_DEV=${HMLG}`,
    ].join('\n');
    expect(loadAsaasSandboxCredentials(env)).toEqual({
      baseUrl: 'https://sandbox.asaas.com/api/v3',
      apiKey: HMLG,
    });
    expect(() =>
      loadAsaasSandboxCredentials(`ASAAS_BASE_URL=https://api.asaas.com/v3\nASAAS_API_KEY=${PROD}`),
    ).toThrow(/obrigatórias/u);
  });
});
