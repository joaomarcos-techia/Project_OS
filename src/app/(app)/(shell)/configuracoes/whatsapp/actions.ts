'use server';

/**
 * Server Actions de ORQUESTRAÇÃO da tela /configuracoes/whatsapp. Delegam para os
 * contratos tenant-scoped do contexto messaging (auth/graph/cripto/persistência/
 * audit lá dentro) e devolvem `ActionResult` — a tela atualiza via router.refresh().
 *
 * O token Meta NUNCA trafega por aqui: o cliente envia apenas o `code` do Embedded
 * Signup; a troca por token e a persistência cifrada acontecem no servidor.
 */
import {
  connectMyClinicWhatsapp,
  disconnectMyClinicWhatsapp,
  type ConnectMyClinicInput,
} from '@/contexts/messaging/actions';

import { fail, ok, type ActionResult } from './wa-types';

export async function connectWhatsappAction(
  input: ConnectMyClinicInput,
): Promise<ActionResult<{ phoneNumberMasked: string }>> {
  try {
    const r = await connectMyClinicWhatsapp(input);
    return ok({ phoneNumberMasked: r.phoneNumberMasked });
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectWhatsappAction(): Promise<ActionResult<{ disconnected: boolean }>> {
  try {
    return ok(await disconnectMyClinicWhatsapp());
  } catch (err) {
    return fail(err);
  }
}
