/**
 * lib/messaging — superfície pública do transporte WhatsApp (C10).
 *
 * `getMessagingProvider` é a seleção entre as 2 implementações reais (ADR-004).
 * É uma função-switch simples, NÃO um Abstract Factory / ProviderFactory
 * (Anti-Hydra): há exatamente 2 providers e a escolha é 1 linha.
 */
import 'server-only';

import { MetaCloudProvider } from './meta-cloud';
import type { MessagingProvider, MessagingProviderName } from './provider';
import { ZApiProvider } from './zapi';

const instances: Partial<Record<MessagingProviderName, MessagingProvider>> = {};

export function getMessagingProvider(provider: MessagingProviderName): MessagingProvider {
  const cached = instances[provider];
  if (cached) return cached;
  const impl: MessagingProvider =
    provider === 'meta' ? new MetaCloudProvider() : new ZApiProvider();
  instances[provider] = impl;
  return impl;
}

export {
  PLATFORM_ORPHAN_SCOPE,
  resolveClinicByPhoneId,
  loadActiveNumberForSend,
  quarantineOrphan,
  type ActiveNumber,
} from './number-store';

export {
  ProviderNotImplementedError,
  ProviderSendError,
  ProviderUnreachableError,
} from './errors';

export type {
  MessagingProvider,
  MessagingProviderName,
  SendTextArgs,
  SendTemplateArgs,
  MessageRef,
  ParsedInboundMessage,
  ParsedStatusEvent,
  ParsedWebhookEvent,
} from './provider';
