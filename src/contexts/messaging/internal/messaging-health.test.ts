/**
 * Saúde de ENVIO — o parser do `health_status` contra as respostas reais do DEV
 * (08/10/2026) e os exemplos oficiais da Meta. O que importa provar: o bloqueio
 * por forma de pagamento aparece, a falta de verificação limita, e o ruído de
 * chamadas (SIP) nunca vira aviso de mensagem.
 */
import { describe, expect, it } from 'vitest';

import {
  DEV_PHONE_NODE_BLOCKED,
  DEV_WABA_NODE_BLOCKED,
  META_DOC_AVAILABLE,
  META_DOC_SIP_BLOCKED,
  PHONE_NODE_CALLING_ONLY,
  PHONE_NODE_LIMITED_BUSINESS_UNVERIFIED,
} from '@/lib/test/meta-health-status-fixtures';

import {
  deliveryFailureNeedsHealthCheck,
  describeMessagingHealth,
  isCallingErrorCode,
  parseMessagingHealth,
} from './messaging-health';

/** Uma entidade sozinha, na forma real. */
function only(...entities: unknown[]) {
  return { health_status: { can_send_message: 'BLOCKED', entities }, id: '1' };
}

describe('parseMessagingHealth — respostas reais do DEV', () => {
  it('nó da WABA: WABA BLOCKED 141006 decide; BUSINESS LIMITED 141010 entra nos códigos', () => {
    expect(parseMessagingHealth(DEV_WABA_NODE_BLOCKED)).toEqual({
      state: 'blocked',
      codes: [141006, 141010],
    });
  });

  it('nó do número: mesmo veredito, e 138024/138025 (SIP) ficam de fora', () => {
    expect(parseMessagingHealth(DEV_PHONE_NODE_BLOCKED)).toEqual({
      state: 'blocked',
      codes: [141006, 141010],
    });
  });

  it('forma de pagamento cadastrada: só a verificação do negócio limita', () => {
    expect(parseMessagingHealth(PHONE_NODE_LIMITED_BUSINESS_UNVERIFIED)).toEqual({
      state: 'limited',
      codes: [141010],
    });
  });

  it('só pendências de chamada: mensagens disponíveis, mesmo com o topo LIMITED', () => {
    expect(parseMessagingHealth(PHONE_NODE_CALLING_ONLY)).toEqual({
      state: 'available',
      codes: [],
    });
  });
});

describe('parseMessagingHealth — entidade a entidade', () => {
  it('WABA BLOCKED 141006 → blocked', () => {
    expect(
      parseMessagingHealth(
        only({
          entity_type: 'WABA',
          id: '1',
          can_send_message: 'BLOCKED',
          errors: [{ error_code: 141006 }],
        }),
      ),
    ).toEqual({ state: 'blocked', codes: [141006] });
  });

  it('BUSINESS LIMITED 141010 → limited', () => {
    expect(
      parseMessagingHealth(
        only({
          entity_type: 'BUSINESS',
          id: '1',
          can_send_message: 'LIMITED',
          errors: [{ error_code: 141010 }],
        }),
      ),
    ).toEqual({ state: 'limited', codes: [141010] });
  });

  it('PHONE_NUMBER LIMITED só com 138024 e additional_info → nenhum aviso', () => {
    expect(
      parseMessagingHealth(
        only({
          entity_type: 'PHONE_NUMBER',
          id: '1',
          can_send_message: 'LIMITED',
          can_receive_call_sip: 'BLOCKED',
          errors: [{ error_code: 138024 }],
          additional_info: ['Your display name has not been approved yet.'],
        }),
      ),
    ).toEqual({ state: 'available', codes: [] });
  });

  it('APP AVAILABLE com 138025 → nenhum aviso', () => {
    expect(
      parseMessagingHealth(
        only({
          entity_type: 'APP',
          id: '1',
          can_send_message: 'AVAILABLE',
          can_receive_call_sip: 'BLOCKED',
          errors: [{ error_code: 138025 }],
        }),
      ),
    ).toEqual({ state: 'available', codes: [] });
  });

  it('BLOCKED sem código continua bloqueado (a Meta documenta que BLOCKED traz errors)', () => {
    expect(
      parseMessagingHealth(only({ entity_type: 'WABA', id: '1', can_send_message: 'BLOCKED' })),
    ).toEqual({ state: 'blocked', codes: [] });
  });

  it('BLOCKED só com código de chamada continua bloqueado, sem o código', () => {
    expect(
      parseMessagingHealth(
        only({
          entity_type: 'PHONE_NUMBER',
          id: '1',
          can_send_message: 'BLOCKED',
          errors: [{ error_code: 138024 }],
        }),
      ),
    ).toEqual({ state: 'blocked', codes: [] });
  });

  it('código desconhecido fora da família de chamadas conta (falha para o lado do aviso)', () => {
    expect(
      parseMessagingHealth(
        only({
          entity_type: 'WABA',
          id: '1',
          can_send_message: 'LIMITED',
          errors: [{ error_code: 141099 }, { error_code: 138001 }],
        }),
      ),
    ).toEqual({ state: 'limited', codes: [141099] });
  });

  it('códigos em texto de dígitos valem; lixo e repetição somem; estado em minúsculas vale', () => {
    expect(
      parseMessagingHealth(
        only(
          {
            entity_type: 'WABA',
            id: '1',
            can_send_message: 'blocked',
            errors: [
              { error_code: '141006' },
              { error_code: 'abc' },
              { error_code: -1 },
              { error_code: 1.5 },
              null,
              {},
            ],
          },
          {
            entity_type: 'BUSINESS',
            id: '2',
            can_send_message: 'LIMITED',
            errors: [{ error_code: 141006 }],
          },
        ),
      ),
    ).toEqual({ state: 'blocked', codes: [141006] });
  });
});

describe('parseMessagingHealth — exemplos oficiais e formas inválidas', () => {
  it('exemplo AVAILABLE da Meta → available', () => {
    expect(parseMessagingHealth(META_DOC_AVAILABLE)).toEqual({ state: 'available', codes: [] });
  });

  it('exemplo "SIP bloqueado" da Meta: o topo diz BLOCKED, as mensagens estão disponíveis', () => {
    expect(META_DOC_SIP_BLOCKED.health_status.can_send_message).toBe('BLOCKED');
    expect(parseMessagingHealth(META_DOC_SIP_BLOCKED)).toEqual({ state: 'available', codes: [] });
  });

  it.each([
    ['corpo nulo', null],
    ['sem health_status', { id: '1' }],
    ['health_status sem entities', { health_status: { can_send_message: 'AVAILABLE' } }],
    ['entities não é lista', { health_status: { can_send_message: 'BLOCKED', entities: {} } }],
    [
      'nenhuma entidade legível e topo BLOCKED',
      { health_status: { can_send_message: 'BLOCKED', entities: [{ entity_type: 'WABA' }] } },
    ],
    [
      'lista vazia e topo LIMITED',
      { health_status: { can_send_message: 'LIMITED', entities: [] } },
    ],
  ])('%s → null (não verificado)', (_label, body) => {
    expect(parseMessagingHealth(body)).toBeNull();
  });

  it('lista vazia com topo AVAILABLE → available', () => {
    expect(
      parseMessagingHealth({ health_status: { can_send_message: 'AVAILABLE', entities: [] } }),
    ).toEqual({ state: 'available', codes: [] });
  });
});

describe('isCallingErrorCode', () => {
  it('a família 138xxx é de chamadas; pagamento e verificação não', () => {
    expect(isCallingErrorCode(138000)).toBe(true);
    expect(isCallingErrorCode(138024)).toBe(true);
    expect(isCallingErrorCode(138025)).toBe(true);
    expect(isCallingErrorCode(141006)).toBe(false);
    expect(isCallingErrorCode(141010)).toBe(false);
    expect(isCallingErrorCode(131042)).toBe(false);
  });
});

describe('deliveryFailureNeedsHealthCheck', () => {
  const failed = (code: unknown) => ({ status: 'failed', errors: [{ code }] });

  it('failed 131042 e 141006 pedem releitura', () => {
    expect(deliveryFailureNeedsHealthCheck('failed', failed(131042))).toBe(true);
    expect(deliveryFailureNeedsHealthCheck('FAILED', failed('141006'))).toBe(true);
  });

  it('outro código, outro status ou callback sem código não pedem', () => {
    expect(deliveryFailureNeedsHealthCheck('failed', failed(131026))).toBe(false);
    expect(deliveryFailureNeedsHealthCheck('delivered', failed(131042))).toBe(false);
    expect(deliveryFailureNeedsHealthCheck('failed', { status: 'failed' })).toBe(false);
    expect(deliveryFailureNeedsHealthCheck('failed', null)).toBe(false);
  });
});

describe('describeMessagingHealth', () => {
  it('disponível não gera aviso', () => {
    expect(describeMessagingHealth({ state: 'available', codes: [] })).toBeNull();
  });

  it('bloqueio do DEV: forma de pagamento primeiro, verificação depois', () => {
    const notice = describeMessagingHealth({ state: 'blocked', codes: [141006, 141010] });
    expect(notice?.state).toBe('blocked');
    expect(notice?.actions).toEqual([
      'Adicione uma forma de pagamento à sua conta do WhatsApp Business na Meta.',
      'Conclua a verificação da empresa no gerenciador de negócios da Meta.',
    ]);
    expect(notice?.summary).toMatch(/não estão chegando aos pacientes/u);
  });

  it('131042 vindo do callback pede a mesma ação de pagamento', () => {
    expect(describeMessagingHealth({ state: 'blocked', codes: [131042] })?.actions).toEqual([
      'Adicione uma forma de pagamento à sua conta do WhatsApp Business na Meta.',
    ]);
  });

  it('limitado pela verificação: só a ação de verificação', () => {
    const notice = describeMessagingHealth({ state: 'limited', codes: [141010] });
    expect(notice?.state).toBe('limited');
    expect(notice?.actions).toEqual([
      'Conclua a verificação da empresa no gerenciador de negócios da Meta.',
    ]);
  });

  it('código desconhecido ou bloqueio sem código: manda conferir a conta', () => {
    expect(describeMessagingHealth({ state: 'blocked', codes: [] })?.actions).toEqual([
      'Confira as pendências da conta no WhatsApp Manager da Meta.',
    ]);
    expect(describeMessagingHealth({ state: 'limited', codes: [141099, 141010] })?.actions).toEqual(
      [
        'Conclua a verificação da empresa no gerenciador de negócios da Meta.',
        'Confira as pendências da conta no WhatsApp Manager da Meta.',
      ],
    );
  });

  it('nenhum texto fala em multa', () => {
    for (const health of [
      { state: 'blocked' as const, codes: [141006, 141010, 141099] },
      { state: 'limited' as const, codes: [141010, 141099] },
    ]) {
      const notice = describeMessagingHealth(health);
      const text = JSON.stringify(notice).toLowerCase();
      expect(text).not.toContain('multa');
    }
  });
});
