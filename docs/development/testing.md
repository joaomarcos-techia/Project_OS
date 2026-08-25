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

## Níveis de prova

- Unitário/integração local: contrato e regra determinística.
- Smoke DEV: banco/RLS/worker reais, mas provider pode estar stubado.
- CI: reprodutibilidade do commit.
- E2E/deploy: comportamento do candidato no ambiente.
- Live provider: borda externa real.

Relate qual nível passou. Um build verde não prova Meta/Asaas/Gemini/e-mail; um teste live antigo não prova o commit atual.
