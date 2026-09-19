# IA e privacidade - evidencia local

## Medicao anterior ao diff (2026-09-10)

Comando: `rg -n "beforeSend|sendDefaultPii|tracesSampleRate" sentry.server.config.ts sentry.edge.config.ts src/instrumentation-client.ts`

```text
src/instrumentation-client.ts:16:  tracesSampleRate: 0.1,
src/instrumentation-client.ts:28:  sendDefaultPii: false,
src/instrumentation-client.ts:30:  beforeSend: scrubEvent,
sentry.server.config.ts:19:  tracesSampleRate: 0.1,
sentry.server.config.ts:21:  sendDefaultPii: false,
sentry.server.config.ts:25:  beforeSend: scrubEvent,
sentry.edge.config.ts:17:  tracesSampleRate: 0.1,
sentry.edge.config.ts:18:  sendDefaultPii: false,
sentry.edge.config.ts:20:  beforeSend: scrubEvent,
```

Comando: `rg -n "preflightToolCalls|safeParse|unknown_tool|multiple_mutations" src/contexts/ai-agent/tools/registry.ts`

```text
6: *   - INPUT (do LLM): Zod safeParse ANTES de executar. Inválido → rejeita,
8: *   - OUTPUT (do handler): Zod safeParse ANTES de devolver ao LLM. Inválido →
70:      kind: 'unknown_tool' | 'invalid_input' | 'invalid_output' | 'handler_error';
80:      kind: 'unknown_tool' | 'invalid_input' | 'multiple_mutations';
170:export function preflightToolCalls(
186:        kind: 'unknown_tool',
192:    const parsedInput = tool.inputSchema.safeParse(call.args);
214:    metrics.emit('ai_agent.tool.multiple_mutations_rejected', {
221:      kind: 'multiple_mutations',
246:    return { ok: false, kind: 'unknown_tool', error: `tool desconhecida: ${call.name}` };
249:  const parsedInput = tool.inputSchema.safeParse(call.args);
278:  const parsedOutput = tool.outputSchema.safeParse(raw);
```

Fonte: sentry-scrub.ts mantem request.data estruturado via sanitizePayload; keys.ts nao inclui nome/convenio. Os runtimes ja desativam PII padrao e compartilham beforeSend. A whitelist real tem 15 tools e nao inclui escrita de prontuario nem criacao de cobranca.

## Teste negativo antes da correcao

Comando: `pnpm exec vitest run src/lib/observability/sentry-scrub.test.ts --reporter=verbose`

```text
FAIL src/lib/observability/sentry-scrub.test.ts > scrubEvent > remove CPF, nome, convenio, body, cookie e authorization de um evento clinico
AssertionError: expected '{"request":{"data":{"campoNovo":"text…' not to contain 'Paciente Sintetico Privado'
Test Files  1 failed (1)
     Tests  1 failed | 2 passed (3)
```

## Diff e validacao executada

- **Peso 6, corrigido no escopo testado:** `src/lib/observability/sentry-scrub.ts` substitui todo corpo HTTP, inclusive objeto, por `[REDACTED_REQUEST_BODY]`; `src/lib/sanitize/keys.ts` inclui nome, convenio, body e aliases, inclusive em arrays e objetos aninhados de extra/contexts. O teste verifica ausencia dos seis valores sinteticos e preservacao do identificador operacional. Esta denylist nao prova ausencia de prosa clinica em chave nova de extra/contexts, tags, mensagem de erro ou breadcrumb.
- **Peso 9, controles existentes com regressao nova:** `src/contexts/ai-agent/guards/prompt-injection-security.test.ts` executa 15 vetores deterministas. A whitelist nao oferece escrita de prontuario, cobranca ou envio em massa; schemas descartam identidade, papel e opt-in injetados; o preflight impede duas mutacoes por turno; gates de confirmacao, identidade ambigua e horizonte usam politica server-side. O vetor 03h testa rejeicao da ferramenta direta removida, nao disponibilidade real do banco; replay testa estabilidade da chave, nao segunda escrita no banco. Nao houve chamada ao Gemini nem afirmacao de que o modelo resistiu aos prompts.

Comando executado (relatorio bruto: [ia-privacidade-tests.json](./ia-privacidade-tests.json)):

```powershell
pnpm exec vitest run src/contexts/ai-agent/guards/prompt-injection-security.test.ts src/contexts/ai-agent/guards/semantic-guard.test.ts src/contexts/ai-agent/tools/registry.test.ts src/contexts/ai-agent/tools/register.test.ts src/contexts/ai-agent/internal/pending-action.test.ts src/lib/observability/sentry-scrub.test.ts src/lib/sanitize/redact.test.ts --reporter=verbose --outputFile=docs/security/ia-privacidade-tests.json --reporter=json
```

```text
Test Files  7 passed (7)
     Tests  255 passed (255)
  Duration  15.77s
JSON report written to C:/dev/ClinicaOS_V2/docs/security/ia-privacidade-tests.json
```

ESLint dos 4 arquivos TypeScript alterados: exit 0, sem saida. Prettier dos mesmos arquivos e deste documento: `All matched files use Prettier code style!` (exit 0). `git diff --check` dos arquivos rastreados alterados: exit 0. Typecheck/build e suite integral ficam registrados no relatorio principal desta mesma execucao.

## Limites locais e Fase 2

**LGPD (peso 5, nao entregue como correcao):** `docs/domains/patient-clinical-lgpd.md` documenta exportacao com URLs assinadas por 24h, permissoes especificas e anonimizacao quando ha retencao clinica; `src/lib/db/retention-policy.ts` centraliza descarte. `getProntuarioById` em `src/contexts/clinical/queries.ts:192` decifra e retorna sem registrar leitura, e a pagina `pacientes/[id]/prontuarios/[pid]/page.tsx:33` valida permissao mas nao acrescenta motivo/trilha de acesso; nao foi executado teste que prove auditoria em toda leitura. Completar essa trilha, limitar exportacao massiva e obter registro de tratamento/base legal assinado continuam pendentes; este documento nao constitui aceite juridico. Os 3 configs Sentry tem destino fallback `ingest.us.sentry.io` e tracing 0.1: remover fallback, definir amostragem por ambiente e decidir transferencia/regiao com responsavel, data e validade permanecem pendentes, sem acesso ao console ou decisao inventada.

**Rate limit (peso 3, nao entregue como correcao):** `src/contexts/ai-agent/limits.ts` ja limita rodadas, mutacoes e caracteres, e o handler calcula/persiste custo; o schema possui `monthlyBudgetUsd`. Nao houve teste local de teto de custo por clinica por hora; esse limite nao esta declarado como implementado ou aceito neste trabalho.
