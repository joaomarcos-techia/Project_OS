/**
 * Monta o RequestContext de auditoria a partir dos headers do request corrente.
 * Fonte única — antes clonado byte-a-byte nas Server Actions de 4 contextos.
 *
 * Fica em arquivo SEPARADO de ./request-context (que só tem builders puros) de
 * propósito: este importa `next/headers` (request-only). A via do AI-agent roda
 * no worker do outbox — SEM request HTTP — e usa buildAgentRequestContext de
 * ./request-context; mantê-los apartados evita arrastar `next/headers` para o
 * bundle do worker.
 */
import { headers } from 'next/headers';

import { buildRequestContext } from './request-context';
import type { RequestContext } from './types';

/** Request-only: RequestContext a partir dos headers do request corrente. */
export async function requestContext(): Promise<RequestContext> {
  return buildRequestContext(await headers());
}
