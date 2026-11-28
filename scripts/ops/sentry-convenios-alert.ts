/**
 * P12.6 — regra de alerta do Sentry para Convênios e a prova de que ela dispara, num comando só. NÃO roda sem a
 * credencial: o token (escopos mínimos `alerts:write`, `project:read`, `org:read`) entra só pela variável
 * `SENTRY_ALERTS_TOKEN` do processo (segredo; nunca em commit, comentário ou log). O DSN NÃO é token administrativo e
 * nunca é usado como um: ele só envia o evento sintético (`SENTRY_TEST_DSN`).
 *
 *   SENTRY_ALERTS_TOKEN=... SENTRY_TEST_DSN=... npx tsx scripts/ops/sentry-convenios-alert.ts
 *
 * 1. cria (ou reaproveita, pelo nome) a regra de issue "Convênios — falha da manutenção TISS": primeira ocorrência,
 *    filtro de tag `flow` começando por `cron.insurance-maintenance`, ação e-mail aos responsáveis (membros ativos
 *    como reserva);
 * 2. envia UM evento sintético com mensagem única e a tag `flow=cron.insurance-maintenance.synthetic` (sem dado de
 *    paciente, de clínica ou de ambiente);
 * 3. espera até 3 min a regra registrar o disparo (`lastTriggered`).
 * A entrega do e-mail é conferida pelo destinatário (fora do alcance desta ferramenta). HTTP 401/403 = para, sem
 * tentar outro caminho.
 */
export {};

const ORG = process.env.SENTRY_ORG_SLUG ?? 'qoro-1v';
const PROJECT = process.env.SENTRY_PROJECT_SLUG ?? 'qoro';
const API = 'https://sentry.io/api/0';
const RULE_NAME = 'Convênios — falha da manutenção TISS';

const token = process.env.SENTRY_ALERTS_TOKEN;
const dsn = process.env.SENTRY_TEST_DSN;
if (!token || !dsn) {
  console.error(
    'faltam SENTRY_ALERTS_TOKEN (token restrito: alerts:write, project:read, org:read) e SENTRY_TEST_DSN; nada foi feito',
  );
  process.exit(2);
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `o Sentry recusou a credencial (HTTP ${res.status}); confira os escopos. Nada foi contornado.`,
    );
  }
  if (!res.ok) throw new Error(`Sentry ${init.method ?? 'GET'} ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

type Rule = { id: string; name: string; lastTriggered?: string | null };

const rules = await api<Rule[]>(`/projects/${ORG}/${PROJECT}/rules/`);
let rule = rules.find((r) => r.name === RULE_NAME);
if (!rule) {
  rule = await api<Rule>(`/projects/${ORG}/${PROJECT}/rules/`, {
    method: 'POST',
    body: JSON.stringify({
      name: RULE_NAME,
      actionMatch: 'all',
      filterMatch: 'all',
      frequency: 5,
      conditions: [{ id: 'sentry.rules.conditions.first_seen_event.FirstSeenEventCondition' }],
      filters: [
        {
          id: 'sentry.rules.filters.tagged_event.TaggedEventFilter',
          key: 'flow',
          match: 'sw',
          value: 'cron.insurance-maintenance',
        },
      ],
      actions: [
        {
          id: 'sentry.mail.actions.NotifyEmailAction',
          targetType: 'IssueOwners',
          fallthroughType: 'ActiveMembers',
        },
      ],
    }),
  });
  console.log(`regra criada: ${rule.id}`);
} else {
  console.log(`regra já existia: ${rule.id}`);
}
const before = rule.lastTriggered ?? null;

// Evento sintético pelo envelope do DSN (sem SDK; mensagem única = issue nova = a condição de primeira ocorrência).
const u = new URL(dsn);
const projectId = u.pathname.replace(/^\//u, '');
const eventId = crypto.randomUUID().replace(/-/gu, '');
const syntheticEvent = {
  event_id: eventId,
  timestamp: new Date().toISOString(),
  platform: 'node',
  level: 'error',
  message: `P12.6 teste sintético do alerta de Convênios ${eventId}`,
  tags: { flow: 'cron.insurance-maintenance.synthetic' },
};
const envelope = [
  JSON.stringify({ event_id: eventId, sent_at: syntheticEvent.timestamp }),
  JSON.stringify({ type: 'event' }),
  JSON.stringify(syntheticEvent),
].join('\n');
const sent = await fetch(`${u.protocol}//${u.host}/api/${projectId}/envelope/`, {
  method: 'POST',
  headers: {
    'content-type': 'application/x-sentry-envelope',
    'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${u.username}, sentry_client=qoro-p12-6/1.0`,
  },
  body: envelope,
});
if (!sent.ok) throw new Error(`o envio do evento sintético falhou (HTTP ${sent.status})`);
console.log(`evento sintético enviado: ${eventId}`);

for (let i = 0; i < 18; i++) {
  await new Promise((r) => setTimeout(r, 10_000));
  const current = await api<Rule>(`/projects/${ORG}/${PROJECT}/rules/${rule.id}/`);
  if (current.lastTriggered && current.lastTriggered !== before) {
    console.log(`PASS: a regra disparou em ${current.lastTriggered}; confira a chegada do e-mail`);
    process.exit(0);
  }
}
console.error('a regra NÃO registrou disparo em 3 min: P12.6 continua pendente');
process.exit(1);
