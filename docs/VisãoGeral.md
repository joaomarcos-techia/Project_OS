# Arquitetura do ClinicaOS

## Status

Canonical — visão arquitetural atual.

## Scope

Explica componentes, fronteiras e fluxos. Schemas, payloads e regras específicas vivem nos documentos de domínio.

## Sistema

O ClinicaOS é uma aplicação full-stack Next.js para operação de clínicas. A UI usa a marca Qoro. O mesmo deploy atende o shell das clínicas e o shell de super-admin.

```text
Browser / WhatsApp / Providers
              |
        Next.js App Router
   pages + actions + route handlers
              |
     bounded contexts em src/contexts
              |
  PostgreSQL/Supabase + Redis + Storage
              |
       outbox worker e crons
              |
 Meta · Gemini · Asaas · Resend · Sentry
```

## Camadas

| Camada | Responsabilidade | Fonte |
| --- | --- | --- |
| `src/app` | rotas, layouts, Server Actions e HTTP | [Frontend](frontend/routes-and-access.md), [Backend](backend/http-jobs-outbox.md) |
| `src/contexts` | regras e persistência dos 12 domínios | [Context map](architecture/context-map.md) |
| `src/lib` | DB, auth, outbox, crypto, storage, env e observabilidade | [Banco](database/schema.md), [Segurança](security/model.md) |
| `drizzle` | histórico executável do schema | [Migrations](runbooks/migrations.md) |
| `scripts` | checks, seeds, smoke tests e operações explícitas | [Testes](development/testing.md) |
| `e2e` | jornadas Playwright e fixtures | [Testes](development/testing.md) |

## Fronteiras essenciais

- Contexts não acessam tabelas de outro context diretamente; APIs públicas e eventos mediam dependências.
- Toda operação tenant-scoped usa a mesma transação recebida por `withTenant`.
- `db`, `dbAdmin` e `dbWorker` são pools fisicamente separados para runtime tenant, plataforma e worker.
- Side effects que precisam acompanhar uma mutation são publicados na outbox dentro da transação.
- Chamadas a providers e ao LLM não ficam dentro de transações longas.
- Autorização de aplicação e RLS são defesas complementares; middleware não é fronteira de segurança.

## Fluxos principais

### Operador da clínica

Supabase Auth cria a sessão. O servidor relê o profile autoritativo, valida `claims_version`, aplica permission guard e executa a mutation via `withTenant`. A RLS valida o mesmo `clinic_id` na conexão.

### Paciente no WhatsApp

Meta valida e entrega o webhook → payload bruto é persistido/quarentenado → evento da outbox inicia o agente → Gemini escolhe uma tool permitida → tools consultam/mutam domínios → resposta outbound é reservada, enviada e finalizada. Contato desconhecido é cadastrado antes de retomar o pedido de agenda.

### Checkout da clínica

Convite com token HMAC → dados de clínica/owner/plano persistidos em `step_state` → cartão e contato de cobrança ficam somente na request → Asaas cria cliente/assinatura → Supabase Auth cria owner → transação admin cria tenant, perfil, configuração de IA e registros de billing → convite é concluído.

### Side effects

Producer grava negócio + outbox na mesma transação. O cron de minuto reserva com `SKIP LOCKED`, valida o payload, executa o handler tenant-scoped e finaliza condicionalmente. Falhas usam backoff e terminam em `failed`; eventos intencionalmente sem consumer ficam `skipped`.

## Restrições arquiteturais

- Dados clínicos assinados não são sobrescritos.
- Billing inadimplente bloqueia escrita, nunca login/leitura clínica.
- Super-admin não pertence a tenant e só entra no shell clínico por impersonação auditada.
- Asaas, Meta e Gemini são escolhas atuais; abstrações não tornam Z-API/OpenAI funcionais.
- Estado de produção deve ser provado externamente, não inferido do código.

## Documentos relacionados

- [Schema e tenancy](database/schema.md)
- [Modelo de segurança](security/model.md)
- [HTTP, jobs e outbox](backend/http-jobs-outbox.md)
- [Integrações](integrations/providers.md)
