import { describe, expect, it } from 'vitest';

import { MetaCloudProvider } from './meta-cloud';

const provider = new MetaCloudProvider();

function webhook(field: string | undefined, value: Record<string, unknown>, entryId = 'waba-1') {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: entryId, changes: [{ ...(field ? { field } : {}), value }] }],
  });
}

const metadata = { phone_number_id: 'phone-1', display_phone_number: '+55 11 3000-0000' };

describe('MetaCloudProvider.parseWebhook — campos de webhook', () => {
  it('payload sem `field` continua sendo lido como mensagem (legado)', () => {
    const parsed = provider.parseWebhook(
      webhook(undefined, {
        metadata,
        messages: [{ id: 'wamid-1', from: '5511999990000', type: 'text', text: { body: 'oi' } }],
      }),
    );
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({ providerMessageId: 'wamid-1', text: 'oi' });
  });

  it('`smb_message_echoes` vira eco da recepção, não inbound', () => {
    const parsed = provider.parseWebhook(
      webhook('smb_message_echoes', {
        metadata,
        message_echoes: [
          {
            id: 'wamid-echo',
            from: '551130000000',
            to: '5511988887777',
            type: 'text',
            text: { body: 'Já te retorno' },
            timestamp: '1790000000',
          },
          { id: 'wamid-foto', to: '5511988887777', type: 'image', timestamp: '1790000001' },
        ],
      }),
    );
    expect(parsed.messages).toEqual([]);
    expect(parsed.echoes).toEqual([
      {
        providerMessageId: 'wamid-echo',
        toNumber: '5511988887777',
        fromPhoneId: 'phone-1',
        text: 'Já te retorno',
        timestamp: '1790000000',
      },
      {
        providerMessageId: 'wamid-foto',
        toNumber: '5511988887777',
        fromPhoneId: 'phone-1',
        text: null,
        timestamp: '1790000001',
      },
    ]);
  });

  it('histórico NUNCA vira inbound: é só contado, para a IA não responder mensagens antigas', () => {
    const parsed = provider.parseWebhook(
      webhook('history', {
        metadata,
        // Mesmo que a Meta um dia mande `messages` no topo de um payload de
        // histórico, o `field` manda — nada disto pode chegar à IA.
        messages: [
          { id: 'wamid-antigo', from: '5511999990000', type: 'text', text: { body: 'x' } },
        ],
        history: [
          { threads: [{ messages: [{}, {}, {}] }, { messages: [{}] }] },
          { threads: [{ messages: [{}] }] },
        ],
      }),
    );
    expect(parsed.messages).toEqual([]);
    expect(parsed.echoes).toEqual([]);
    expect(parsed.discarded).toEqual({ historyMessages: 5, stateSyncItems: 0 });
  });

  it('contatos (`smb_app_state_sync`) são contados e descartados', () => {
    const parsed = provider.parseWebhook(
      webhook('smb_app_state_sync', { metadata, state_sync: [{}, {}] }),
    );
    expect(parsed.discarded).toEqual({ historyMessages: 0, stateSyncItems: 2 });
    expect(parsed.messages).toEqual([]);
  });

  it('`account_update` PARTNER_REMOVED identifica a WABA pelo entry.id', () => {
    const parsed = provider.parseWebhook(
      webhook(
        'account_update',
        {
          event: 'PARTNER_REMOVED',
          disconnection_info: { reason: 'PRIMARY_INACTIVITY', initiated_by: 'SYSTEM' },
        },
        'waba-9',
      ),
    );
    expect(parsed.partnerRemovals).toEqual([
      { wabaId: 'waba-9', reason: 'PRIMARY_INACTIVITY', initiatedBy: 'SYSTEM' },
    ]);
  });

  it('`account_update` de outro evento é ignorado', () => {
    const parsed = provider.parseWebhook(webhook('account_update', { event: 'VERIFIED_ACCOUNT' }));
    expect(parsed.partnerRemovals).toEqual([]);
  });

  it('campo desconhecido não vira mensagem', () => {
    const parsed = provider.parseWebhook(
      webhook('message_template_status_update', {
        metadata,
        messages: [{ id: 'wamid-2', from: '5511999990000', type: 'text', text: { body: 'x' } }],
      }),
    );
    expect(parsed.messages).toEqual([]);
  });
});
