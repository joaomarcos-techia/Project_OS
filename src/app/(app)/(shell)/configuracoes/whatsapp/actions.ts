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
  getMyClinicWhatsappProfile,
  updateMyClinicWhatsappProfile,
  updateMyClinicWhatsappProfilePicture,
  type AtualizacaoDePerfil,
  type ConnectMyClinicInput,
} from '@/contexts/messaging/actions';
import type {
  PerfilLido,
  PerfilWhatsappInput,
} from '@/contexts/messaging/business-profile-contract';

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

/**
 * §33 — perfil público do número.
 *
 * `read` existe para o botão "Tentar de novo": quando o GET da página falha, a
 * tela NÃO renderiza formulário vazio (§33.5), e a pessoa precisa de um caminho
 * para recarregar só esta seção sem perder o resto da página.
 */
export async function readWhatsappProfileAction(): Promise<ActionResult<PerfilLido>> {
  try {
    return ok(await getMyClinicWhatsappProfile());
  } catch (err) {
    return fail(err);
  }
}

/**
 * Salva e devolve o que a Meta passou a reportar — não o que foi enviado.
 * Sem espelho local, o estado exibido depois de salvar ou vem de lá ou é chute.
 */
export async function saveWhatsappProfileAction(
  input: PerfilWhatsappInput,
): Promise<ActionResult<AtualizacaoDePerfil>> {
  try {
    return ok(await updateMyClinicWhatsappProfile(input));
  } catch (err) {
    return fail(err);
  }
}

/** A foto é enviada direto à Meta; nenhum binário ou URL fica persistido no Qoro. */
export async function uploadWhatsappProfilePictureAction(
  formData: FormData,
): Promise<ActionResult<AtualizacaoDePerfil>> {
  try {
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return { ok: false, code: 'validation', message: 'Escolha uma imagem PNG ou JPG.' };
    }
    return ok(await updateMyClinicWhatsappProfilePicture(file));
  } catch (err) {
    return fail(err);
  }
}
