import { describe, expect, it } from 'vitest';

import { AGENT_CONFIG_DEFAULTS, AgentConfigSchema } from './config-types';

const validConfig = {
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  canDisclosePaymentsViaAgent: false,
  especialidades: ['Cardiologia'],
  convenios: ['Unimed', 'Bradesco Saúde'],
};

describe('AgentConfigSchema — convênios da clínica', () => {
  it('mantém uma lista única configurável e normaliza espaços nas pontas', () => {
    const parsed = AgentConfigSchema.parse({
      ...validConfig,
      convenios: ['  Unimed  ', 'Bradesco Saúde'],
    });

    expect(parsed.convenios).toEqual(['Unimed', 'Bradesco Saúde']);
  });

  it('aceita lista vazia como informação não cadastrada', () => {
    expect(AgentConfigSchema.parse({ ...validConfig, convenios: [] }).convenios).toEqual([]);
    expect(AGENT_CONFIG_DEFAULTS.convenios).toEqual([]);
  });

  it('rejeita nome vazio, nome excessivo e mais de 40 convênios', () => {
    expect(AgentConfigSchema.safeParse({ ...validConfig, convenios: ['   '] }).success).toBe(false);
    expect(
      AgentConfigSchema.safeParse({ ...validConfig, convenios: ['x'.repeat(81)] }).success,
    ).toBe(false);
    expect(
      AgentConfigSchema.safeParse({
        ...validConfig,
        convenios: Array.from({ length: 41 }, (_, index) => `Convênio ${index}`),
      }).success,
    ).toBe(false);
  });
});
