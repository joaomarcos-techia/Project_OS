/**
 * Meta Embedded Signup — chamadas Graph do fluxo de CONEXÃO (F2, self-service).
 *
 * Só HTTP (fetch + env), sem DB → vive no contexto (o guard F-01 é sobre
 * `dbAdmin`/service_role, não sobre HTTP de saída; o sender já chama o provider
 * por aqui). NÃO é um `MessagingProvider` (infra C10 congelada) — é um helper
 * dedicado ao onboarding, espelhando o padrão fetch+timeout+erro de
 * `src/lib/messaging/meta-cloud.ts`.
 *
 * Segurança: o `access_token` é segredo. NUNCA logar URLs (a troca de code carrega
 * client_secret na query), corpos crus, nem incluir o token em mensagens de erro.
 * Toda falha vira `MetaConnectError` (code estável `META_AUTH_FAILED`).
 */
import 'server-only';

import { env } from '@/lib/env';
import type { ProactiveTemplateDefinition } from '@/lib/messaging/proactive-template-catalog';

import { MetaConnectError, type MetaConnectFailureStage } from '../errors';
import type { MetaChannelProbe, MetaProbeOutcome } from './channel-health';

const REQUIRED_SCOPES = ['whatsapp_business_management', 'whatsapp_business_messaging'] as const;

export interface WabaPhone {
  wabaId: string;
  phoneNumberId: string;
  /** display_phone_number normalizado para `+` + dígitos (E.164-ish). */
  phoneNumber: string;
}

/**
 * O que o TOKEN do cliente realmente concede, lido do próprio `debug_token`.
 *
 * `wabaIds` vem de `granular_scopes[scope=whatsapp_business_management].target_ids`
 * — o caminho documentado pela Meta para descobrir a WABA compartilhada por um
 * token de Embedded Signup, sem pedir `business_management`. A doc diz que as
 * WABAs mais recentes vêm primeiro; NÃO usamos essa ordem para escolher nada
 * (escolher o primeiro de uma lista ambígua seria adivinhar). A lista é usada
 * só como ALLOWLIST: o id vindo do navegador precisa estar nela.
 *
 * Pode vir vazia — há apps cujo `debug_token` não devolve `target_ids`. Nesse
 * caso o gate é pulado e resta apenas `/{waba-id}/phone_numbers`, que prova que
 * o token ALCANÇA o asset, não que o cliente o escolheu. A ausência da lista
 * nunca autoriza uma WABA: só deixa de recusá-la antecipadamente.
 */
export interface MetaTokenGrant {
  wabaIds: string[];
}

function onboardingEnv(): { appId: string; appSecret: string } {
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  // Defesa local; o caller já roda assertWhatsappOnboardingReady() na borda.
  if (!appId || !appSecret) {
    throw new MetaConnectError('[meta] configuração de onboarding ausente');
  }
  return { appId, appSecret };
}

/**
 * Fetch genérico ao Graph. `path` NUNCA contém segredo (segredos vão em `query`,
 * que não é logada). Classifica erro como `MetaConnectError` sem vazar token.
 *
 * Exportado para `meta-business-profile.ts` (§33), que fala com o mesmo Graph e
 * precisa exatamente das mesmas garantias: timeout, classificação D78 por
 * método, e nenhum token em mensagem de erro. Reimplementar lá seria criar um
 * segundo caminho de saída para a Meta com regras próprias — e a regra que
 * escapasse seria justamente a de não vazar credencial. Continua `internal/`:
 * a superfície pública do contexto não o expõe.
 */
export async function graphFetch<T>(
  path: string,
  init: {
    method: 'GET' | 'POST' | 'DELETE';
    stage: MetaConnectFailureStage;
    token?: string;
    query?: Record<string, string>;
    // `unknown`: o corpo de template carrega `components` aninhados.
    body?: Record<string, unknown>;
    /** Corpo binário do upload retomável de foto. Incompatível com `body`. */
    binary?: { bytes: Uint8Array; contentType: 'image/jpeg' | 'image/png'; fileOffset: 0 };
    /** Rótulo sem handle/assinatura para mensagens de erro. */
    safePathLabel?: string;
  },
): Promise<T> {
  if (init.body && init.binary) {
    throw new Error('graphFetch recebeu body JSON e binário ao mesmo tempo.');
  }
  const url = new URL(`https://graph.facebook.com/${env.META_GRAPH_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.body) headers['content-type'] = 'application/json';
  if (init.binary) {
    headers['content-type'] = init.binary.contentType;
    headers.file_offset = String(init.binary.fileOffset);
  }

  const pathForError = init.safePathLabel ?? path;

  let res: Response;
  try {
    const request: RequestInit = {
      method: init.method,
      headers,
      signal: AbortSignal.timeout(env.META_HTTP_TIMEOUT_MS),
    };
    if (init.body) request.body = JSON.stringify(init.body);
    if (init.binary) {
      const bytes = new Uint8Array(init.binary.bytes.byteLength);
      bytes.set(init.binary.bytes);
      request.body = new Blob([bytes.buffer], { type: init.binary.contentType });
    }
    res = await fetch(url, request);
  } catch (err) {
    // timeout / abort / reset — não inclui token; `path` é seguro (sem segredo).
    // Sem resposta não há como afirmar recusa; num POST, nem sequer que nada
    // mudou do outro lado.
    throw new MetaConnectError(`[meta] graph inalcançável (${init.method} ${pathForError})`, {
      cause: err,
      stage: failureStage('indeterminate', init.method, init.stage),
    });
  }

  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    // Só os campos numéricos do erro Meta (não sensíveis) — nunca o corpo, a
    // URL (que pode carregar client_secret) nem o token. O `error_subcode` entra
    // porque a Meta transporta semântica nele (ex.: 100/33), e sem ele a
    // classificação teria de adivinhar pela classe HTTP.
    const err = (raw as { error?: { code?: number; error_subcode?: number } } | null)?.error;
    const code = numeric(err?.code);
    const subcode = numeric(err?.error_subcode);
    // D78 — a classificação vive AQUI, não em cada chamador: antes só o
    // resolver de WABA a aplicava, e um `429` na troca de code, na validação de
    // escopos, no `/register` ou no `/subscribed_apps` continuava aparecendo
    // como recusa da Meta.
    const kind = classifySignal(res.status, code, subcode);
    throw new MetaConnectError(
      `[meta] graph HTTP ${res.status}${code !== null ? ` code=${code}` : ''}${
        subcode !== null ? ` subcode=${subcode}` : ''
      }`,
      {
        stage: failureStage(kind, init.method, init.stage),
        graphStatus: res.status,
        graphCode: code,
        graphSubcode: subcode,
      },
    );
  }
  return raw as T;
}

/**
 * Etapa reportada para cada classe de falha.
 *
 * `denied` preserva a etapa FUNCIONAL (autorização, permissões, conta, registro,
 * webhook) — é a única classe em que o provedor realmente recusou. As outras
 * duas descrevem o canal, não a conta, e por isso trocam a etapa: mandar o
 * operador revisar credenciais durante um pico de tráfego é o mesmo erro de
 * diagnóstico que D78 expôs.
 *
 * A separação por método é o ponto crítico: num `GET` a indeterminação é
 * inofensiva (nada muda), enquanto num `POST`/`DELETE` o resultado externo é
 * DESCONHECIDO — pode ter sido aplicado. Sem read-back não se afirma "nada foi
 * alterado" nem se repete a mutação às cegas.
 */
function failureStage(
  kind: GraphFailureKind,
  method: 'GET' | 'POST' | 'DELETE',
  stage: MetaConnectFailureStage,
): MetaConnectFailureStage {
  if (kind === 'denied') return stage;
  if (kind === 'rate_limited') return 'provider_rate_limited';
  return method === 'GET' ? 'provider_unavailable' : 'provider_outcome_unknown';
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ===========================================================================
// D78 — classificação ÚNICA de falha do Graph.
//
// A regra anterior ("status >= 400 && < 500 ⇒ negativa autoritativa") vivia
// duplicada no connect e na sonda de saúde e estava errada: `429 Too Many
// Requests` é rate limit temporário pelo RFC 6585 §4, e a Meta também
// transporta semântica transitória no corpo, fora da classe HTTP.
//
// Conservador por construção: NADA é negativa autoritativa a menos que a
// documentação oficial da Meta diga que é. Todo o resto vira indeterminação,
// que preserva o estado anterior em vez de acusar um canal saudável.
// ===========================================================================

/** Rate limit / throttling documentado pela Meta. */
const GRAPH_RATE_LIMIT_CODES = new Set([
  // Graph API — "Handling errors": 4 "Muitas chamadas de API", 17 "Muitas
  // chamadas de usuário de API", 341 "Limite do aplicativo atingido".
  4, 17, 341,
  // WhatsApp Cloud API — "Error codes", tabela Throttling errors.
  80007, 130429, 133016,
]);

/** Indisponibilidade temporária documentada pela Meta. */
const GRAPH_TRANSIENT_CODES = new Set([
  // Graph API: 2 "Serviço de API — problema temporário".
  2,
  // Cloud API: 131016 "A service is temporarily unavailable",
  // 133004 "Server is temporarily unavailable".
  131016, 133004,
]);

/**
 * Negativa autoritativa de token/permissão/asset, toda ela documentada:
 * Graph API "Handling errors" (10, 102, 190, 200–299), Cloud API "Error codes",
 * tabela Authorization errors (0, 3, 10, 190, 200–299, 131005), e 33 "The
 * business phone number has been deleted" — negativa sobre o próprio asset.
 */
function isDocumentedDenialCode(code: number): boolean {
  if (code >= 200 && code <= 299) return true;
  return (
    code === 0 ||
    code === 3 ||
    code === 10 ||
    code === 33 ||
    code === 102 ||
    code === 190 ||
    code === 131005
  );
}

/**
 * Status HTTP tratados como falha FUNCIONAL da etapa. `400` NÃO entra: a Meta o
 * usa para quase tudo, inclusive throttling, então o veredito ali depende do
 * código do corpo.
 *
 * `401` e `403` são negativas de autorização na própria semântica HTTP. `404` é
 * diferente e está aqui por outro motivo: pelo RFC 9110 ele significa que o
 * servidor não encontrou representação atual para o alvo — e pode ser usado
 * também para não revelar a existência do recurso. Ou seja, NÃO prova falta de
 * permissão; prova apenas que o recurso não está acessível por esta requisição.
 * Para o connect e para a sonda o efeito é o mesmo (a etapa falhou e o asset não
 * é utilizável), e por isso ele não é tratado como indeterminação — mas a causa
 * não deve ser reportada como "permissão negada".
 */
const DENIAL_HTTP_STATUSES = new Set([401, 403, 404]);

export type GraphFailureKind = 'denied' | 'rate_limited' | 'indeterminate';

/**
 * Traduz uma falha do Graph em uma das três semânticas. `denied` é a única que
 * autoriza dizer "o provedor recusou"; as outras duas nunca degradam um canal.
 *
 * Ordem importa: rate limit e transitório vencem a classe HTTP, porque a Meta
 * devolve alguns deles com status 400.
 */
export function classifyGraphFailure(err: unknown): GraphFailureKind {
  if (!(err instanceof MetaConnectError)) return 'indeterminate';
  return classifySignal(err.graphStatus, err.graphCode, err.graphSubcode);
}

/** Forma pura, usada pelo próprio `graphFetch` antes de o erro existir. */
function classifySignal(
  status: number | null,
  code: number | null,
  subcode: number | null,
): GraphFailureKind {
  if (code !== null && GRAPH_RATE_LIMIT_CODES.has(code)) return 'rate_limited';
  // RFC 6585 §4: 429 é excesso de requisições, nunca negativa de acesso.
  if (status === 429) return 'rate_limited';
  if (code !== null && GRAPH_TRANSIENT_CODES.has(code)) return 'indeterminate';

  if (code !== null && isDocumentedDenialCode(code)) return 'denied';
  // Marketing API error reference: 100/33 é token sem a permissão de usuário do
  // sistema necessária. É o subcode que carrega a negativa — o 100 sozinho é
  // "Invalid parameter" e não prova falta de acesso.
  if (code === 100 && subcode === 33) return 'denied';
  if (status !== null && DENIAL_HTTP_STATUSES.has(status)) return 'denied';

  // Inclui 5xx, timeout (`status === null`) e todo 4xx — 400 e 429 entre eles —
  // sem código documentado como negativa.
  return 'indeterminate';
}

/** Troca o `code` do Embedded Signup por um access token (server-side). */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const { appId, appSecret } = onboardingEnv();
  const res = await graphFetch<{ access_token?: string }>('oauth/access_token', {
    method: 'GET',
    stage: 'authorization',
    query: { client_id: appId, client_secret: appSecret, code },
  });
  if (!res.access_token) {
    throw new MetaConnectError('[meta] troca de code não retornou access_token', {
      stage: 'authorization',
    });
  }
  return res.access_token;
}

/**
 * Valida que o token é válido e tem os escopos do WhatsApp Business, e devolve
 * as WABAs que ele alcança. Evita persistir uma conexão quebrada (sem permissão
 * de gerência/mensageria) e alimenta a allowlist anti-sequestro do resolver.
 */
export async function validateTokenScopes(token: string): Promise<MetaTokenGrant> {
  const { appId, appSecret } = onboardingEnv();
  const res = await graphFetch<{
    data?: {
      is_valid?: boolean;
      scopes?: string[];
      granular_scopes?: { scope?: string; target_ids?: string[] }[];
    };
  }>('debug_token', {
    method: 'GET',
    stage: 'permissions',
    query: { input_token: token, access_token: `${appId}|${appSecret}` },
  });
  const data = res.data;
  if (!data?.is_valid) {
    throw new MetaConnectError('[meta] token inválido (debug_token)', { stage: 'permissions' });
  }
  const granular = data.granular_scopes ?? [];
  const scopes = new Set<string>([
    ...(data.scopes ?? []),
    ...granular.map((g) => g.scope).filter((s): s is string => typeof s === 'string'),
  ]);
  for (const required of REQUIRED_SCOPES) {
    if (!scopes.has(required)) {
      throw new MetaConnectError(`[meta] escopo ausente: ${required}`, { stage: 'permissions' });
    }
  }
  // Só o escopo de GERÊNCIA carrega as WABAs administráveis; `messaging` pode
  // trazer o mesmo conjunto, mas não é ele que autoriza register/subscribe.
  const wabaIds = [
    ...new Set(
      granular
        .filter((g) => g.scope === 'whatsapp_business_management')
        .flatMap((g) => g.target_ids ?? [])
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  return { wabaIds };
}

/**
 * Resolve `phone_number_id` + número da WABA que o Embedded Signup declarou,
 * provando AUTORITATIVAMENTE pelo token que ela pertence a quem autorizou.
 *
 * D78 — o fallback antigo (`GET /me/businesses` → `/{business-id}/owned_whatsapp_business_accounts`)
 * foi REMOVIDO. Ele pressupõe um token que enxerga o portfólio empresarial, o
 * que exige `business_management`; a configuração de Embedded Signup emite
 * token de usuário do sistema com apenas os dois escopos WhatsApp, e no Graph
 * API Explorer `/me/businesses` não devolveu dado útil para esse token. Manter
 * o fallback significaria pedir uma permissão de portfólio que o produto não
 * usa — e, pior, aceitar uma WABA que o cliente não escolheu no pop-up.
 *
 * O que cada verificação prova — e o que NÃO prova:
 *  1. allowlist do token (`granular_scopes.target_ids`), quando a Meta a
 *     devolve: recusa um id que o cliente não outorgou;
 *  2. `GET /{waba-id}/phone_numbers` com o token do cliente: prova que o token
 *     ALCANÇA aquele asset. Não prova que o id foi escolhido pelo cliente — ele
 *     continua vindo do evento no navegador. Com a allowlist vazia, esta é a
 *     única verificação restante.
 */
export async function resolveWabaAndPhone(
  token: string,
  claim: { wabaId: string; phoneNumberId?: string | undefined },
  grant: MetaTokenGrant,
): Promise<WabaPhone> {
  // Anti-sequestro: `wabaId` chega do navegador. Se o token declara quais WABAs
  // concede, o id precisa estar lá — senão é uma conta que o cliente não outorgou.
  if (grant.wabaIds.length > 0 && !grant.wabaIds.includes(claim.wabaId)) {
    throw new MetaConnectError('[meta] a WABA informada não foi concedida a este app', {
      stage: 'account',
    });
  }

  const phones = await listWabaPhones(token, claim.wabaId);
  if (phones.length === 0) {
    throw new MetaConnectError('[meta] a WABA autorizada não tem número WhatsApp', {
      stage: 'account',
    });
  }

  const chosen = pickPhone(phones, claim.phoneNumberId);
  return {
    wabaId: claim.wabaId,
    phoneNumberId: chosen.id,
    phoneNumber: normalizeDisplayPhone(chosen.display_phone_number ?? ''),
  };
}

interface WabaPhoneEntry {
  id: string;
  display_phone_number?: string;
}

/**
 * Escolhe o número SEM nunca cair em posição de lista ambígua.
 *
 * D78 — o contrato anterior era `(preferPhoneId && find(...)) || phones[0]`, e
 * o `||` transformava duas situações distintas em "pega o primeiro":
 *  - o evento indicou um número que não existe naquela WABA (id de outra conta,
 *    número removido, payload adulterado);
 *  - o evento não indicou número e a WABA tem vários.
 * Nos dois casos o Qoro registraria, assinaria e persistiria um número que o
 * cliente não escolheu. Agora cada um falha com a sua causa.
 */
function pickPhone(phones: WabaPhoneEntry[], preferPhoneId?: string): WabaPhoneEntry {
  if (preferPhoneId) {
    const exact = phones.find((p) => p.id === preferPhoneId);
    if (!exact) {
      // Correspondência exata ou falha: nunca substituir pelo primeiro.
      throw new MetaConnectError('[meta] o número informado não pertence à WABA autorizada', {
        stage: 'account',
      });
    }
    return exact;
  }
  // Sem `phone_number_id` (típico de FINISH_ONLY_WABA): só é seguro quando não
  // há escolha a fazer.
  if (phones.length === 1) return phones[0]!;
  throw new MetaConnectError('[meta] a WABA autorizada tem mais de um número', {
    stage: 'phone_ambiguous',
  });
}

/**
 * Lista os números de uma WABA com o token do cliente.
 *
 * D78 — classificação delegada a `classifyGraphFailure()`. Só uma negativa
 * DOCUMENTADA pela Meta significa "este token não alcança esta WABA"; rate limit
 * (429 e códigos de throttling), 5xx, timeout e todo 4xx sem código documentado
 * são INDETERMINAÇÃO. O `catch` original convertia tudo em "inacessível", então
 * a tela acusava conta inexistente durante instabilidade ou pico de tráfego. O
 * sinal sanitizado (status/code/subcode) sobe junto, com o erro original em
 * `cause`.
 */
async function listWabaPhones(token: string, wabaId: string): Promise<WabaPhoneEntry[]> {
  let res: { data?: { id?: string; display_phone_number?: string }[] };
  try {
    res = await graphFetch(`${encodeURIComponent(wabaId)}/phone_numbers`, {
      method: 'GET',
      stage: 'account',
      token,
    });
  } catch (err) {
    // `graphFetch` já classificou: só a negativa documentada mantém a etapa
    // `account`, e só ela autoriza dizer que o token não alcança a WABA. Rate
    // limit e indeterminação sobem como vieram, com `graphStatus`/`graphCode`
    // preservados — nada foi provado sobre a conta.
    if (err instanceof MetaConnectError && err.stage === 'account') {
      throw new MetaConnectError('[meta] o token não alcança a WABA informada', {
        cause: err,
        stage: 'account',
        graphStatus: err.graphStatus,
        graphCode: err.graphCode,
        graphSubcode: err.graphSubcode,
      });
    }
    throw err;
  }
  return (res.data ?? []).filter(
    (p): p is WabaPhoneEntry => typeof p.id === 'string' && p.id.length > 0,
  );
}

/**
 * Ativa o telefone na WhatsApp Cloud API após a confirmação de posse no
 * Embedded Signup. A confirmação por SMS/voz não substitui este registro: a
 * Meta exige também um PIN próprio de verificação em duas etapas.
 */
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  registrationPin: string,
): Promise<void> {
  await graphFetch(`${encodeURIComponent(phoneNumberId)}/register`, {
    method: 'POST',
    stage: 'phone_registration',
    token,
    body: { messaging_product: 'whatsapp', pin: registrationPin },
  });
}

/** Assina o app à WABA (campo `messages`) para receber os webhooks daquele número. */
export async function subscribeAppToWaba(wabaId: string, token: string): Promise<void> {
  await graphFetch(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'POST',
    stage: 'webhook_subscription',
    token,
  });
}

export interface TemplateProvisionOutcome {
  name: string;
  status: 'created' | 'already_exists' | 'failed';
  /**
   * D104 — preenchido só quando o template JÁ existe e a categoria que a Meta
   * reporta hoje diverge da que o catálogo submete.
   *
   * A Meta recategoriza template aprovado por conta própria: um `UTILITY` que
   * ela julgue promocional vira `MARKETING` com a mensagem "não atendeu às
   * nossas diretrizes de utilidade". Isso não é cosmético — marketing exige
   * opt-in de marketing e tem limite por usuário, então a mensagem pode não ser
   * entregue enquanto a API responde `accepted` e o job termina `sent`.
   *
   * Só reporta: recriar não resolveria (a Meta recusa nome duplicado) e editar
   * não muda categoria. A correção é criar um template novo, com nome novo.
   */
  categoryDrift?: { expected: string; actual: string };
}

/**
 * Garante que os templates proativos existam na WABA do cliente.
 *
 * Com Embedded Signup a WABA é do CLIENTE, e template pertence à WABA — não há
 * como compartilhar um template aprovado entre clínicas. Como o app tem
 * `whatsapp_business_management` na WABA outorgada, ele cria os modelos por API
 * no connect, em vez de alguém cadastrar quatro modelos à mão por clínica.
 *
 * NUNCA lança. O canal funciona para conversa de serviço mesmo sem template
 * aprovado; derrubar o connect porque a Meta recusou um modelo transformaria uma
 * conexão boa em falha. Cada modelo é reportado individualmente para o operador
 * enxergar o que ficou de fora.
 *
 * Idempotente: relê os nomes existentes antes de criar, então reconectar não
 * tenta recriar nem depende de interpretar o subcode de "name already exists".
 */
export async function ensureMessageTemplates(
  wabaId: string,
  token: string,
  definitions: ProactiveTemplateDefinition[],
): Promise<TemplateProvisionOutcome[]> {
  if (definitions.length === 0) return [];

  // D104 — a consulta traz `category` junto com o nome. Antes pedia só `name`,
  // então um template reclassificado pela Meta passava por `already_exists` sem
  // que ninguém ficasse sabendo.
  let existing: Map<string, string | undefined>;
  try {
    const res = await graphFetch<{ data?: Array<{ name?: string; category?: string }> }>(
      `${encodeURIComponent(wabaId)}/message_templates`,
      {
        method: 'GET',
        stage: 'template_provisioning',
        token,
        query: { fields: 'name,category', limit: '250' },
      },
    );
    existing = new Map(
      (res.data ?? [])
        .filter((t): t is { name: string; category?: string } => Boolean(t.name))
        .map((t) => [t.name, t.category]),
    );
  } catch {
    // Sem a lista não dá para decidir o que falta. Criar às cegas duplicaria
    // pedidos de revisão na Meta; melhor reportar e deixar o health/retry expor.
    return definitions.map((d) => ({ name: d.name, status: 'failed' as const }));
  }

  const outcomes: TemplateProvisionOutcome[] = [];
  for (const definition of definitions) {
    if (existing.has(definition.name)) {
      const actual = existing.get(definition.name);
      outcomes.push({
        name: definition.name,
        status: 'already_exists',
        // Categoria ausente na resposta não é divergência: é falta de dado.
        ...(actual && actual !== definition.category
          ? { categoryDrift: { expected: definition.category, actual } }
          : {}),
      });
      continue;
    }
    try {
      await graphFetch(`${encodeURIComponent(wabaId)}/message_templates`, {
        method: 'POST',
        stage: 'template_provisioning',
        token,
        body: {
          name: definition.name,
          language: definition.languageCode,
          category: definition.category,
          components: [
            {
              type: 'BODY',
              text: definition.body,
              ...(definition.example.length > 0
                ? { example: { body_text: [definition.example] } }
                : {}),
            },
          ],
        },
      });
      outcomes.push({ name: definition.name, status: 'created' });
    } catch {
      // Uma recusa não pode impedir as outras: cada modelo é independente.
      outcomes.push({ name: definition.name, status: 'failed' });
    }
  }
  return outcomes;
}

/** Cancela a assinatura do app na WABA (no disconnect — para não receber webhook inútil). */
export async function unsubscribeAppFromWaba(wabaId: string, token: string): Promise<void> {
  await graphFetch(`${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'DELETE',
    stage: 'webhook_subscription',
    token,
  });
}

// ===========================================================================
// META-001 — sondagem READ-ONLY da saúde do canal.
//
// Nenhuma destas funções muta a Meta: só GET. A reinscrição do app continua
// sendo operação externa explícita (`subscribeAppToWaba`), nunca um efeito
// colateral de abrir a tela de configurações.
// ===========================================================================

/** Negativa documentada = o provedor NEGOU; rate limit/indeterminação = não sabemos. */
function outcomeFromGraphError(err: unknown): MetaProbeOutcome {
  // D78 — mesmo contrato do connect. Antes qualquer 4xx virava `failed`, então
  // um `429` durante um pico degradava o canal de toda clínica sondada.
  return classifyGraphFailure(err) === 'denied' ? 'failed' : 'unknown';
}

/**
 * Lê o estado real do canal na Meta: token, escopos, WABA, número e — o que o
 * health antigo não via — se ALGUM app está inscrito para receber os webhooks
 * daquela WABA. Nunca lança: toda falha vira `unknown`/`failed` no `probe`,
 * porque uma sonda que explode não pode derrubar a tela de configurações.
 */
export async function probeMetaChannel(input: {
  token: string;
  wabaId: string | null;
  phoneNumberId: string;
  /** App que DEVE estar inscrito. `null` quando o ambiente não o configurou. */
  expectedAppId: string | null;
}): Promise<MetaChannelProbe> {
  const probe: MetaChannelProbe = {
    token: 'unknown',
    scopes: 'unknown',
    phone: 'unknown',
    waba: 'unknown',
    appSubscription: 'unknown',
    phoneStatus: 'unknown',
    accountReview: 'unknown',
  };

  // 1. Credencial + escopos (app token; não vaza o token do tenant).
  try {
    const { appId, appSecret } = onboardingEnv();
    const res = await graphFetch<{
      data?: { is_valid?: boolean; scopes?: string[]; granular_scopes?: { scope?: string }[] };
    }>('debug_token', {
      method: 'GET',
      stage: 'permissions',
      query: { input_token: input.token, access_token: `${appId}|${appSecret}` },
    });
    const data = res.data;
    if (!data?.is_valid) {
      // Token revogado/expirado: os checks seguintes não têm como ser feitos, e
      // o veredito já é `broken` por esta causa raiz.
      probe.token = 'failed';
      return probe;
    }
    probe.token = 'ok';
    const scopes = new Set<string>([
      ...(data.scopes ?? []),
      ...(data.granular_scopes ?? [])
        .map((g) => g.scope)
        .filter((s): s is string => typeof s === 'string'),
    ]);
    probe.scopes = REQUIRED_SCOPES.every((s) => scopes.has(s)) ? 'ok' : 'failed';
  } catch (err) {
    probe.token = outcomeFromGraphError(err);
    return probe;
  }

  // 2. O número persistido ainda é alcançável por esta credencial.
  try {
    const phoneRes = await graphFetch<{ status?: string }>(
      `${encodeURIComponent(input.phoneNumberId)}`,
      { method: 'GET', stage: 'account', token: input.token, query: { fields: 'id,status' } },
    );
    probe.phone = 'ok';
    // Alcançar o número não prova que ele envia. A doc é explícita: só
    // `CONNECTED` envia e recebe pela API. Campo ausente fica `unknown` — não
    // se inventa veredito a partir de uma resposta que não trouxe o dado.
    const status = phoneRes?.status;
    if (typeof status === 'string') {
      probe.phoneStatus = status.toUpperCase() === 'CONNECTED' ? 'ok' : 'failed';
    }
  } catch (err) {
    // `phoneStatus` fica `unknown` de propósito: `phone` já carrega a negativa,
    // e duplicar a causa faria a tela listar dois motivos para um problema só.
    probe.phone = outcomeFromGraphError(err);
  }

  // 3. Assinatura do webhook — a verificação que faltava. Sem `wabaId` local
  // (linhas legadas do connect super_admin, onde a coluna é opcional) não há o
  // que consultar: fica `unknown` e o estado anterior é preservado, em vez de
  // inventar um veredito.
  if (!input.wabaId) return probe;
  try {
    const res = await graphFetch<{
      data?: Array<{ id?: string; whatsapp_business_api_data?: { id?: string } }>;
    }>(`${encodeURIComponent(input.wabaId)}/subscribed_apps`, {
      method: 'GET',
      stage: 'webhook_subscription',
      token: input.token,
    });
    probe.waba = 'ok';
    const apps = (res.data ?? [])
      .map((entry) => entry.whatsapp_business_api_data?.id ?? entry.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    if (apps.length === 0) {
      // Exatamente o estado do achado: HTTP 200 com lista vazia. Nenhum app
      // recebe os webhooks desta WABA, independente de qual seja o nosso.
      probe.appSubscription = 'failed';
    } else if (!input.expectedAppId) {
      probe.appSubscription = 'unknown';
    } else {
      probe.appSubscription = apps.includes(input.expectedAppId) ? 'ok' : 'failed';
    }
  } catch (err) {
    probe.waba = outcomeFromGraphError(err);
  }

  // 4. Revisão da conta. Só `REJECTED` é negativa: `PENDING`/`DEFERRED` são
  // estados de fila e a clínica segue atendendo — rebaixá-los marcaria como
  // quebrada uma conexão que funciona.
  //
  // Não existe sonda de método de pagamento: a Meta não expõe esse campo no nó
  // da WABA. Esta é a negativa documentada mais próxima de "a conta não pode
  // mais enviar".
  try {
    const account = await graphFetch<{ account_review_status?: string }>(
      `${encodeURIComponent(input.wabaId)}`,
      {
        method: 'GET',
        stage: 'account',
        token: input.token,
        query: { fields: 'account_review_status' },
      },
    );
    const review = account?.account_review_status;
    probe.accountReview =
      typeof review === 'string' && review.toUpperCase() === 'REJECTED' ? 'failed' : 'ok';
  } catch (err) {
    probe.accountReview = outcomeFromGraphError(err);
  }

  return probe;
}

/** `+55 11 99999-9999` → `+5511999999999`. */
function normalizeDisplayPhone(display: string): string {
  const digits = display.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}
