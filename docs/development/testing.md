---
title: "Testes e gates"
description: "Comandos reais, limites de execução e níveis de evidência para validar mudanças no Qoro."
docType: "guide"
---

## Escolha a validação pela mudança

Leia `package.json`, a configuração do runner e `.github/workflows/ci.yml` antes
de executar. Alguns smokes acessam provedores, enviam mensagens, escrevem dados
ou geram pagamentos. O nome “teste” não torna essas operações inofensivas.

| Mudança | Verificação inicial | Limite |
| --- | --- | --- |
| Regra TypeScript | `pnpm exec vitest run caminho/do/arquivo.test.ts` | Mock não comprova provedor |
| Tipos | `pnpm typecheck` | Não comprova execução |
| Estilo e imports | `pnpm lint` e `pnpm format:check` | Markdown é ignorado pela configuração geral; usar os checks documentais abaixo |
| Interface pública isolada | `pnpm security:build` e `pnpm test:e2e:ci` | Não equivale ao fluxo completo de cliente autenticado |
| Isolamento | `pnpm security:tenant` | Ler requisitos de PostgreSQL e fixture antes |
| Arquitetura | `pnpm arch:check` e `pnpm arch:db-check` | Grafos gerados podem exigir atualização separada |
| Migrations versionadas | `pnpm check:migrations` | Não aplica nem comprova histórico remoto |
| Contratos de rotas/crons | `pnpm check:observability` e `pnpm check:registry:strict` | Sem comprovação de cron ativo no deployment |
| Build | `pnpm build` | Não comprova credenciais ou integrações externas |
| Cobertura | `pnpm test:coverage` | Respeitar thresholds da configuração vigente |

`pnpm arch:graphs --check` compara os snapshots de arquitetura. Use
`pnpm arch:graphs` para regenerar quando o acoplamento tiver mudado e revise o
diff; não atualize snapshots para esconder uma dependência indevida.

## O que a CI executa

Na revisão-base desta organização, o workflow verifica instalação congelada,
auditoria de dependências de produção, TypeScript, lint, arquitetura, migrations,
observabilidade, registry, cobertura e os gates de segurança e superfície pública
configurados. **Não assuma que todos os comandos locais rodam na CI.** O próprio
workflow é a fonte para a lista e sua ordem.

E2E autenticado, prova com e-mail externo, Checkout, webhook, Meta e pagamento
precisam de ambiente e fixture autorizados. `SKIP` por falta de chave Turnstile
não prova o desafio; positivo/negativo com chave de teste não comprovam o widget
e domínio de Produção.

## Documentação Mintlify

Na raiz do checkout:

```powershell
node docs/tooling/catalog.mjs
node --test docs/tooling/catalog.test.mjs
```

Depois, no diretório `docs`:

```powershell
npx --yes mint@4.2.1203 --telemetry=false validate
npx --yes mint@4.2.1203 --telemetry=false broken-links
npx --yes mint@4.2.1203 --telemetry=false dev --port 3334 --no-open
```

Após adicionar ou classificar arquivos, regenere o catálogo na raiz:

```powershell
node docs/tooling/catalog.mjs --write
```

O validador local cobre navegação, metadados, links internos, favicon e cobertura
do catálogo. O `mint validate` compila as páginas; nenhum dos dois envia e-mail,
aplica migration ou modifica integrações. O preview fica em `localhost` e não
publica o acervo interno.

## Testes externos

Leia o script e sua autorização antes de usar `test:e2e:prod`, `billing:*`,
`payments:*`, `email:*`, `wa:*`, `smoke:*` ou `ai:live-check`. Prepare fixture,
resultado esperado, limpeza e identificação do ambiente. Nunca reutilize um
cliente real como fixture nem repita um pagamento aprovado sem necessidade.

## Como registrar

Registre comando, revisão, ambiente, resultado, cenário e limpeza. Diferencie
unitário, banco isolado, DEV compartilhado, Preview, CI, provedor e Produção.
Consulte [evidências](/quality/index) e [catálogo](/catalog) para execuções
anteriores; os números antigos não foram reexecutados nesta reorganização.
