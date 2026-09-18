# Testes e gates

## Status

Canonical — comandos executáveis e interpretação da evidência.

## Gate local completo

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm arch:check
pnpm arch:graphs --check
pnpm arch:db-check
pnpm check:migrations
pnpm check:observability
pnpm check:registry:strict
pnpm test:coverage
pnpm build
```

`pnpm arch:graphs --check` compara os snapshots de arquitetura em `docs/architecture/` com o
código: se o acoplamento mudou, regenere com `pnpm arch:graphs` e commite o diff no mesmo PR
(modelo lockfile — o diff é o que a revisão lê para julgar se o acoplamento novo era intencional).

O CI executa todos acima exceto `format:check`; inclui também `pnpm audit --prod --audit-level high`. Thresholds Vitest atuais: lines 29%, functions 41%, branches 74%, statements 29%.

## Gate E2E em CI (desde 2026-09-13)

```bash
pnpm test:e2e:ci     # exige `pnpm security:build` antes
```

Roda `e2e/public-surface.spec.ts` contra o build isolado que `security:build`
produz em `dist/security-local/app`. Cobre o que dispensa credencial: fronteira
sem sessão (22 rotas, incluindo as 8 de `/admin`), cabeçalhos de segurança e
integridade estrutural do formulário de login.

**Por que só isso.** Os 51 specs `production-*` exigem variável de autorização
própria, credenciais de clínica sintética e conexão ao Postgres de PRODUÇÃO —
não podem rodar em CI, e até esta data **nenhum E2E rodava**. O diagnóstico
completo e a matriz de cobertura estão em
[`docs/quality/e2e-coverage-audit.md`](../quality/e2e-coverage-audit.md).

Acrescentar um spec a `playwright.ci.config.ts` é decisão explícita: ele passa a
poder quebrar o merge de todo mundo.

```bash
# Rode com E2E_AUTH_REUSE=1: o admin-boundary faz login de verdade, e a conta é
# compartilhada com os outros cenários. Sem o reuse, repetir a suíte dentro de
# 15 min esgota o rate limit DUAL (IP + e-mail) e o caso vira skip.
E2E_AUTH_REUSE=1 pnpm test:e2e:public
```

Três specs: `public-surface`, `signup-session-api` e `admin-boundary-rbac`, todos
contra `E2E_BASE_URL`.

`signup-session-api` e `admin-boundary-rbac` ficam fora do CI: um precisa de banco,
o outro de credencial. Ele exercita
`/api/signup/*` por HTTP real e **pula com anotação** quando o orçamento de IP
do próprio produto (20 aberturas/15 min) estoura — skip anotado, nunca verde,
pelo mesmo motivo do `n/v` acima.

### Cadastro autônomo local com persistência real

Depois de `pnpm security:build`, execute:

```bash
pnpm exec tsx --conditions=react-server scripts/security/signup-regression.ts --browser
```

O runner não carrega `.env.local`: cria Postgres 17 temporário, aplica migrations 0096–0102, inicia
Auth e Redis REST sintéticos pelos SDKs instalados e abre o build isolado no Chromium. O fixture Redis
roda em processo separado, implementa pipeline/EVALSHA e pode simular indisponibilidade sem bloquear o
Next. Um retry de transporte local só é permitido depois de provar que banco e contador do provider
não mudaram.

Ele cobre `/cadastro`, criação/`me`/`answers`, duas abas/CAS, identidade, confirmação, ownership,
reenvio, `/cadastro/continuar`, `/cadastro/plano`, catálogo elegível, preço/trial server-side,
adulteração do payload, seleção idempotente, plano inativo, TTL, rate limit/falha de rede na UI e
cleanup zero. O resultado é gravado em `dist/signup-regression/results.json`; uma execução completa
deve terminar com todos os checks `PASS`, cleanup zero e `own Postgres stopped`. Cloudflare, Upstash,
Supabase e SMTP externos permanecem fora dessa prova. As portas locais usadas são 55447 (Postgres),
55449 (Redis) e 3217 (Next); deixe-as livres.

**No Windows, rode a partir do PowerShell.** O runner limpa o ambiente antes de subir o Postgres e a
allow list preserva `SystemRoot`. Sob Git Bash as variáveis chegam em caixa alta (`SYSTEMROOT`), a
limpeza remove essa, e o Postgres sobe sem Winsock utilizável — falha com
`could not create IPv4 socket for address "???"`, sem relação com o código sob teste.

**E exporte `NODE_OPTIONS=--conditions=react-server`.** A primeira fase (migrations e SQL) roda sem
isso, mas a segunda importa o código da aplicação e morre em `server-only` — "This module cannot be
imported from a Client Component module". Passar `--conditions` na linha do `node` não basta: o
transformer CJS do tsx não herda a flag, só a variável.

```powershell
$env:NODE_OPTIONS = '--conditions=react-server'
node node_modules/tsx/dist/cli.mjs scripts/security/signup-regression.ts --browser
```

## Verificações contra o provedor real (sandbox)

```bash
pnpm billing:live-check     # assinatura, na conta do Qoro
pnpm payments:live-check    # cobrança de PACIENTE, com chave de clínica (modelo B)
```

Não rodam no CI (precisam de credencial). São o único jeito de pegar regra de
provedor que a documentação não conta — o `payments:live-check` nasceu achando três:
mínimo de R$ 5,00 por cobrança, `email` obrigatório no webhook, e restrições de
formato no `authToken`. Depois achou uma quarta, que teria custado caro: **cobrança
apagada NÃO devolve 404** — o Asaas responde 200 com `deleted: true` e o `status`
congelado no que era antes. Rode-os **antes de qualquer release que toque pagamento**.

`payments:live-check` recusa chave que não seja de sandbox: ele CRIA cobranças.

Um passo pode aparecer como **`n/v`** (não verificável) em vez de `ok` ou `FALHA`:
é o caso em que o ambiente não permite provar o caminho — hoje, o estorno de uma
cobrança efetivamente paga, porque a conta de sandbox recusa simular recebimento.
Ele não conta como falha (vermelho permanente treina todo mundo a ignorar vermelho)
e **não vira verde** (check verde forjado é pior: passa a impressão de prova).

## Testes focados

```bash
pnpm test -- caminho/do/arquivo.test.ts
pnpm test:e2e -- caminho/do/spec.spec.ts
```

Use o comando real do manifesto; não desabilite teste nem altere threshold para obter verde.

## E2E

`pnpm test:e2e` roda Playwright no ambiente configurado. A suíte completa mistura specs locais e specs `production-*`; estes três testes read-only lançam erro em localhost em vez de fazer `skip`:

- `production-dashboard-financial-rbac.spec.ts`;
- `production-dashboard-operational-a.spec.ts`;
- `production-whatsapp-settings-rbac.spec.ts`.

Eles consultam o banco PROD, autenticam fixtures operacionais e comparam `app.qoro.dev`; o guard de host é a causa das três falhas locais. Para validação local, selecione explicitamente um spec compatível, por exemplo:

```bash
pnpm test:e2e e2e/login-and-navigation.spec.ts
```

`test:e2e:prod` pode operar em produção e exige autorização, contas/fixtures descartáveis e cleanup estrito. E2E não faz parte do CI atual.

### Execução read-only em produção — 2026-08-18

Com contas sintéticas autorizadas e `E2E_BASE_URL=https://app.qoro.dev`, os três specs acima passaram: `3 passed` em 28,4 s, Chromium, um worker e zero retry.

- `production-dashboard-financial-rbac`: médico sem `view:financial` não recebeu KPIs/gráfico financeiro, foi bloqueado em `/financeiro` e não viu o card financeiro em relatórios. O PDF permaneceu disponível, mas a rota o gera sem colunas financeiras para esse usuário.
- `production-dashboard-operational-a`: KPIs, próximos atendimentos, checklist e atividade coincidiram com o banco; a atividade ficou oculta para o médico sem `view:audit`.
- `production-whatsapp-settings-rbac`: médico sem `manage:settings` recebeu `Sem acesso` e não viu status, telefone ou controle de desconexão.

Os objetos JSON impressos pelos specs financeiro e WhatsApp ainda contêm flags/resultados legados que contradizem as assertivas atuais. Considere o status Playwright e as assertivas como evidência; não use esses dois `console.log` como resultado semântico.

## Smokes

Existem smokes C3–C14, onboarding, admin, conversas e jornadas. Muitos escrevem no banco DEV; leia guard/cleanup do script antes. `ai:live-check`, `ai:adversarial`, `billing:*`, `email:live-check` e `wa:*` atingem providers e podem gerar custo/efeito externo.

## Carga local descartável

`test:load` exige um build atual e PostgreSQL 17 local. O DEV é usado **somente** como origem de
`pg_dump --schema-only`; todas as fixtures, tráfego e escritas ficam num cluster PostgreSQL TLS criado
sob o diretório temporário do sistema. Meta é substituído por provider falso e qualquer outro HTTP
externo é bloqueado. O guard recusa produção, Preview, DEV compartilhado como destino e confirmação
ausente/incorreta.

```powershell
pnpm build
$env:LOAD_TEST_CONFIRM = 'LOCAL_SCRATCH_ONLY'
pnpm test:load
Remove-Item Env:LOAD_TEST_CONFIRM
```

Aceite P8: 500 consultas, 5.000 jobs C14, 1.000 webhooks, outbox 5.000, reconcile concorrente, 100
amostras SQL, SLOs do `qorov2.md`, zero duplicata/retry/falha/deadlock e cleanup confirmado. Nunca
reduza os guards nem aponte o harness a Preview, produção ou DEV compartilhado.

## Níveis de prova

- Unitário/integração local: contrato e regra determinística.
- Smoke DEV: banco/RLS/worker reais, mas provider pode estar stubado.
- CI: reprodutibilidade do commit.
- E2E/deploy: comportamento do candidato no ambiente.
- Live provider: borda externa real.

Relate qual nível passou. Um build verde não prova Meta/Asaas/Gemini/e-mail; um teste live antigo não prova o commit atual.
