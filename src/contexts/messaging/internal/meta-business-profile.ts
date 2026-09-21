/**
 * Perfil público do número na Meta (§33) — leitura e escrita.
 *
 * A Meta é a FONTE DA VERDADE: não existe espelho local (§33.4). A tela lê aqui
 * ao abrir e escreve aqui ao salvar. O motivo de não haver coluna é que um
 * espelho diverge em silêncio no exato ponto em que dói — a tela mostraria o que
 * nós achamos que o paciente vê, e o paciente veria outra coisa, bastando
 * alguém editar pelo Business Manager (que continua disponível).
 *
 * Endpoint único, no `phone-number-id` (NÃO na WABA):
 *   GET  /{phone-number-id}/whatsapp_business_profile?fields=...
 *   POST /{phone-number-id}/whatsapp_business_profile
 *
 * Escopo `whatsapp_business_management`, já concedido no Embedded Signup — esta
 * fatia não pede consentimento novo nem reconexão.
 */
import {
  PERFIL_VERTICALS,
  type PerfilCampo,
  type PerfilLido,
  type PerfilVertical,
  type PerfilWhatsapp,
} from '../business-profile-contract';

import { MetaConnectError } from '../errors';

import { classifyGraphFailure, graphFetch } from './meta-onboarding';

/** Campos pedidos no GET. `profile_picture_url` fica fora (§33.6). */
const CAMPOS_GRAPH = 'about,address,description,email,websites,vertical';

interface PerfilGraphRaw {
  about?: unknown;
  address?: unknown;
  description?: unknown;
  email?: unknown;
  websites?: unknown;
  vertical?: unknown;
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * A Meta devolve `websites` como array de strings. Entradas não-string são
 * descartadas em vez de virarem `""`: um site vazio no meio da lista mudaria a
 * ordem percebida e o diff acusaria alteração que ninguém fez.
 */
function sites(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string' && s.trim() !== '')
    .map((s) => s.trim());
}

const VERTICALS = new Set<string>(PERFIL_VERTICALS);

/**
 * Reetiqueta uma recusa CONTEUDAL deste endpoint como `profile_read`/
 * `profile_write`.
 *
 * Por que é preciso. `classifySignal` (D78) só considera `denied` os códigos
 * documentados de autorização e os status 401/403/404. Um `400 code=100`
 * ("Invalid parameter") — que é exatamente o que a Meta devolve quando recusa o
 * VALOR de um campo do perfil — cai em `indeterminate`, e `failureStage()` o
 * transforma em `provider_unavailable` no GET e `provider_outcome_unknown` no
 * POST. O resultado seria uma pessoa corrigindo uma vírgula no endereço e
 * recebendo "a Meta não confirmou o resultado; confira o número no WhatsApp
 * Manager ou entre em contato com o suporte".
 *
 * Por que é CORRETO aqui, e não uma flexibilização da regra. A cautela do D78 é
 * sobre mutação de resultado desconhecido: timeout e 5xx depois de um POST não
 * dizem se a operação foi aplicada do outro lado. Um 4xx com corpo de erro do
 * Graph é outra coisa — a requisição foi recebida, parseada e recusada, então
 * "nada foi alterado" é afirmação segura.
 *
 * O que NÃO é reetiquetado, de propósito: rate limit (a orientação é esperar, e
 * ela vale) e tudo que não seja 4xx — 5xx e timeout continuam
 * `provider_outcome_unknown` num POST, porque ali a dúvida é real.
 */
function comoRecusaDePerfil(err: unknown, stage: 'profile_read' | 'profile_write'): unknown {
  if (!(err instanceof MetaConnectError)) return err;
  if (classifyGraphFailure(err) === 'rate_limited') return err;
  const status = err.graphStatus;
  if (status === null || status < 400 || status >= 500) return err;
  return new MetaConnectError(err.message, {
    cause: err,
    stage,
    graphStatus: err.graphStatus,
    graphCode: err.graphCode,
    graphSubcode: err.graphSubcode,
  });
}

/**
 * Lê o perfil que o paciente vê hoje.
 *
 * Nunca lança por formato: qualquer campo ausente ou de tipo inesperado vira
 * vazio. O que PODE lançar é falha de transporte, e aí o erro sobe como
 * `MetaConnectError` — é o caminho que a tela usa para dizer "não foi possível
 * ler agora" em vez de exibir formulário em branco (§33.5).
 */
export async function getBusinessProfile(
  phoneNumberId: string,
  token: string,
): Promise<PerfilLido> {
  let res: { data?: PerfilGraphRaw[] };
  try {
    res = await graphFetch<{ data?: PerfilGraphRaw[] }>(
      `${phoneNumberId}/whatsapp_business_profile`,
      { method: 'GET', token, stage: 'profile_read', query: { fields: CAMPOS_GRAPH } },
    );
  } catch (err) {
    throw comoRecusaDePerfil(err, 'profile_read');
  }
  // Perfil nunca configurado devolve `data: []`. É estado válido, não erro.
  const raw = Array.isArray(res.data) ? (res.data[0] ?? {}) : {};

  const verticalBruta = texto(raw.vertical);
  const conhecida = VERTICALS.has(verticalBruta);

  return {
    perfil: {
      about: texto(raw.about),
      description: texto(raw.description),
      address: texto(raw.address),
      email: texto(raw.email),
      websites: sites(raw.websites),
      vertical: conhecida ? (verticalBruta as PerfilVertical) : 'UNDEFINED',
    },
    verticalDesconhecida: verticalBruta !== '' && !conhecida ? verticalBruta : null,
  };
}

/**
 * Escreve SÓ os campos alterados.
 *
 * Duas razões, e as duas são de correção, não de economia:
 *
 * 1. o endpoint é de atualização parcial, então campo não enviado fica como
 *    está — e é isso que preserva um `vertical` que a Meta conhece e nós não;
 * 2. o raio de alcance de um salvamento passa a ser exatamente o que a pessoa
 *    mexeu. Reenviar os seis campos faria cada "corrigi uma vírgula no recado"
 *    reescrever endereço, e-mail e sites com o que a tela tinha carregado — que
 *    pode estar velho se alguém editou pelo Business Manager no meio.
 *
 * `campos` vem do diff calculado sobre uma leitura FRESCA do servidor, nunca do
 * que o cliente afirma ter mudado.
 */
export async function updateBusinessProfile(
  phoneNumberId: string,
  token: string,
  perfil: PerfilWhatsapp,
  campos: readonly PerfilCampo[],
): Promise<void> {
  if (campos.length === 0) return;
  const body: Record<string, unknown> = { messaging_product: 'whatsapp' };
  for (const campo of campos) body[campo] = perfil[campo];
  try {
    await graphFetch<unknown>(`${phoneNumberId}/whatsapp_business_profile`, {
      method: 'POST',
      token,
      stage: 'profile_write',
      body,
    });
  } catch (err) {
    throw comoRecusaDePerfil(err, 'profile_write');
  }
}
