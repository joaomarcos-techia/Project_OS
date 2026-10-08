/**
 * Respostas de `GET /{nó}?fields=health_status` na forma REAL.
 *
 * As duas primeiras reproduzem a leitura read-only da conexão de teste do DEV
 * (clinica-a) em 08/10/2026: chaves, ordem das entidades, status e códigos são
 * os que a Meta devolveu. Os ids são fictícios. A sonda não imprimiu o texto
 * livre de `errors`, então as descrições vêm da documentação da Meta (138024,
 * 138025) ou do que o diagnóstico daquele dia registrou (141006); a de 141010 é
 * uma paráfrase. O parser nunca lê esses textos. O `additional_info` do número é
 * o texto que a Meta devolveu.
 *
 * As duas últimas são os exemplos oficiais da página "Health Status".
 */

const WABA_BLOCKED_141006 = {
  entity_type: 'WABA',
  id: '100000000000001',
  can_send_message: 'BLOCKED',
  errors: [
    {
      error_code: 141006,
      error_description:
        'There is an error with the payment method. This will block business initiated conversations.',
      possible_solution:
        'There was an error with your payment method. Please add a new payment method to the account.',
    },
  ],
};

const BUSINESS_LIMITED_141010 = {
  entity_type: 'BUSINESS',
  id: '100000000000002',
  can_send_message: 'LIMITED',
  errors: [
    {
      error_code: 141010,
      error_description: 'The business has not completed business verification.',
      possible_solution: 'Start or resolve the business verification request in business settings.',
    },
  ],
};

const PHONE_NUMBER_LIMITED_138024 = {
  entity_type: 'PHONE_NUMBER',
  id: '100000000000003',
  can_send_message: 'LIMITED',
  can_receive_call_sip: 'BLOCKED',
  errors: [
    {
      error_code: 138024,
      error_description: 'WhatsApp Business calling cannot use SIP because it is not enabled',
      possible_solution: 'Configure SIP using {PHONE_NUMBER_ID}/settings API',
    },
  ],
  additional_info: [
    'Your display name has not been approved yet. Your message limit will increase after the display name is approved.',
  ],
};

const APP_AVAILABLE = {
  entity_type: 'APP',
  id: '100000000000004',
  can_send_message: 'AVAILABLE',
};

const APP_AVAILABLE_138025 = {
  entity_type: 'APP',
  id: '100000000000004',
  can_send_message: 'AVAILABLE',
  can_receive_call_sip: 'BLOCKED',
  errors: [
    {
      error_code: 138025,
      error_description:
        'This app cannot use SIP for WhatsApp Business calling because it has not configured a SIP server for this business phone number',
      possible_solution: 'Configure SIP server using {PHONE_NUMBER_ID}/settings API',
    },
  ],
};

/** DEV 08/10: nó da WABA. Topo BLOCKED; WABA BLOCKED 141006, BUSINESS LIMITED 141010, APP AVAILABLE. */
export const DEV_WABA_NODE_BLOCKED = {
  id: '100000000000001',
  health_status: {
    can_send_message: 'BLOCKED',
    entities: [WABA_BLOCKED_141006, BUSINESS_LIMITED_141010, APP_AVAILABLE],
  },
};

/**
 * DEV 08/10: nó do NÚMERO, que já traz WABA, BUSINESS e APP. PHONE_NUMBER
 * LIMITED com 138024 (SIP) e APP AVAILABLE com 138025 (SIP).
 */
export const DEV_PHONE_NODE_BLOCKED = {
  health_status: {
    can_send_message: 'BLOCKED',
    entities: [
      PHONE_NUMBER_LIMITED_138024,
      WABA_BLOCKED_141006,
      BUSINESS_LIMITED_141010,
      APP_AVAILABLE_138025,
    ],
  },
  id: '100000000000003',
};

/** O mesmo número depois de a clínica cadastrar a forma de pagamento: só falta a verificação. */
export const PHONE_NODE_LIMITED_BUSINESS_UNVERIFIED = {
  health_status: {
    can_send_message: 'LIMITED',
    entities: [
      PHONE_NUMBER_LIMITED_138024,
      { entity_type: 'WABA', id: '100000000000001', can_send_message: 'AVAILABLE' },
      BUSINESS_LIMITED_141010,
      APP_AVAILABLE_138025,
    ],
  },
  id: '100000000000003',
};

/** Só ruído de chamadas: nenhuma pendência de mensagem. */
export const PHONE_NODE_CALLING_ONLY = {
  health_status: {
    can_send_message: 'LIMITED',
    entities: [
      PHONE_NUMBER_LIMITED_138024,
      { entity_type: 'WABA', id: '100000000000001', can_send_message: 'AVAILABLE' },
      { entity_type: 'BUSINESS', id: '100000000000002', can_send_message: 'AVAILABLE' },
      APP_AVAILABLE_138025,
    ],
  },
  id: '100000000000003',
};

/** Exemplo oficial da Meta: tudo disponível. */
export const META_DOC_AVAILABLE = {
  health_status: {
    can_send_message: 'AVAILABLE',
    entities: [
      {
        entity_type: 'PHONE_NUMBER',
        id: '106540352242922',
        can_send_message: 'AVAILABLE',
        can_receive_call_sip: 'AVAILABLE',
      },
      { entity_type: 'WABA', id: '102290129340398', can_send_message: 'AVAILABLE' },
      { entity_type: 'BUSINESS', id: '506914307656634', can_send_message: 'AVAILABLE' },
      {
        entity_type: 'APP',
        id: '634974688087057',
        can_send_message: 'AVAILABLE',
        can_receive_call_sip: 'AVAILABLE',
      },
    ],
  },
  id: '106540352242922',
};

/**
 * Exemplo oficial da Meta: SIP bloqueado. O topo diz BLOCKED, mas toda entidade
 * pode enviar mensagens — é a prova de que o agregado não serve.
 */
export const META_DOC_SIP_BLOCKED = {
  health_status: {
    can_send_message: 'BLOCKED',
    entities: [
      {
        entity_type: 'PHONE_NUMBER',
        id: '597727103418254',
        can_send_message: 'AVAILABLE',
        can_receive_call_sip: 'BLOCKED',
        errors: [
          {
            error_code: 138024,
            error_description: 'WhatsApp Business calling cannot use SIP because it is not enabled',
            possible_solution: 'Configure SIP using {PHONE_NUMBER_ID}/settings API',
          },
        ],
      },
      { entity_type: 'WABA', id: '102290129340398', can_send_message: 'AVAILABLE' },
      { entity_type: 'BUSINESS', id: '506914307656634', can_send_message: 'AVAILABLE' },
      {
        entity_type: 'APP',
        id: '634974688087057',
        can_send_message: 'AVAILABLE',
        can_receive_call_sip: 'BLOCKED',
        errors: [
          {
            error_code: 138025,
            error_description:
              'This app cannot use SIP for WhatsApp Business calling because it has not configured a SIP server for this business phone number',
            possible_solution: 'Configure SIP server using {PHONE_NUMBER_ID}/settings API',
          },
        ],
      },
    ],
  },
  id: '105154286024403',
};
