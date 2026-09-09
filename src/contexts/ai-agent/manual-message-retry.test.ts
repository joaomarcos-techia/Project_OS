import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const actions = readFileSync(resolve(process.cwd(), 'src/contexts/ai-agent/actions.ts'), 'utf8');
const appActions = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/conversas/actions.ts'),
  'utf8',
);
const threadView = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/conversas/_components/conversation-thread.tsx'),
  'utf8',
);

const retryAction = actions.slice(actions.indexOf('export async function reenviarMensagemManual'));

describe('manual WhatsApp message retry', () => {
  it('aceita somente mensagem humana de saída com falha real', () => {
    expect(retryAction).toContain('ManualRetrySchema.parse(input)');
    expect(retryAction).toContain("eq(aiMessages.direction, 'out')");
    expect(retryAction).toContain('isNotNull(aiMessages.sentByUserId)');
    expect(retryAction).toContain('messagingApiV1.getOutboundStatuses');
    expect(retryAction).toContain("delivery.get(message.eventId) !== 'failed'");
  });

  it('revalida responsável, handoff e janela da Meta no servidor', () => {
    expect(retryAction).toContain('assertAssignedTo');
    expect(retryAction).toContain('canReplyManually');
    expect(retryAction).toContain('new ConversationNotInHandoffError');
    expect(retryAction).toContain('new MetaWindowClosedError');
  });

  it('preserva a falha antiga e cria uma tentativa com nova identidade', () => {
    expect(retryAction).not.toContain('.update(aiMessages)');
    expect(retryAction).toContain('const messageEventId = randomUUID()');
    expect(retryAction).toContain('appendManualMessage');
    expect(retryAction).toContain('decryptForTenant');
    expect(retryAction).toContain('AI_AGENT_EVENTS.MANUAL_REPLY_REQUESTED');
    expect(retryAction).toContain('idempotencyKey: messageEventId');
  });

  it('expõe reenvio somente quando a operação pode ser executada', () => {
    expect(appActions).toContain('export async function reenviarMensagemAction');
    expect(threadView).toContain('const canRetry');
    expect(threadView).toContain("message.delivery === 'failed' && canRetry");
    expect(threadView).toContain('<RetryMessageButton');
  });
});
