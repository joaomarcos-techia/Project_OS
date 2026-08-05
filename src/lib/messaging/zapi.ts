/**
 * ZApiProvider — esqueleto C10 (ADR-004: fallback operacional).
 *
 * Implementa `MessagingProvider` DIRETO (sem BaseProvider). Os 4 métodos lançam
 * `ProviderNotImplementedError` — nenhuma clínica é configurada com `provider='zapi'`
 * em C10. A implementação real entra quando o fallback for ativado (camada futura).
 */
import 'server-only';

import { ProviderNotImplementedError } from './errors';
import type {
  MessageRef,
  MessagingProvider,
  ParsedWebhookEvent,
  SendTemplateArgs,
  SendTextArgs,
} from './provider';

export class ZApiProvider implements MessagingProvider {
  sendText(_args: SendTextArgs): Promise<MessageRef> {
    throw new ProviderNotImplementedError('zapi', 'sendText');
  }
  sendTemplate(_args: SendTemplateArgs): Promise<MessageRef> {
    throw new ProviderNotImplementedError('zapi', 'sendTemplate');
  }
  parseWebhook(_rawBody: string): ParsedWebhookEvent {
    throw new ProviderNotImplementedError('zapi', 'parseWebhook');
  }
  validateSignature(
    _rawBody: string,
    _signatureHeader: string | null,
    _appSecret: string,
  ): boolean {
    throw new ProviderNotImplementedError('zapi', 'validateSignature');
  }
}
