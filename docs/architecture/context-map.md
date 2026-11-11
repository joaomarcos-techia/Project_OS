# Mapa de bounded contexts

## Status

Canonical — ownership e dependências de domínio.

## Source of Truth

`src/contexts/*`, barrels públicos `index.ts`/`api.ts`, `eslint.config.mjs` e checks `arch:*`.

## Contexts

| Context | Owns | Integrações principais |
| --- | --- | --- |
| `tenancy` | clínicas, unidades, slugs | base de todos os dados tenant-scoped |
| `identity` | profiles, roles, permissions e login attempts | Supabase Auth, tenancy e billing quota |
| `onboarding` | convites e `step_state` | Asaas, Supabase Auth, tenancy, identity e billing |
| `patient` | cadastro, PII, consentimento, vínculos e LGPD | scheduling, clinical, Storage e outbox |
| `scheduling` | agenda, procedimentos, disponibilidade, recursos, fila e waitlist | patient, financial, AI e messaging |
| `clinical` | prontuário, versões, prescrições e documentos | patient, scheduling, Storage e crypto |
| `financial` | lançamentos, pagamentos, estornos, fornecedores e caixa | scheduling, messaging e outbox |
| `messaging` | números WhatsApp, inbound/outbound e status de provider | Meta, AI e outbox |
| `ai-agent` | conversas, mensagens, tools, pending actions e handoff | Gemini e APIs públicas de outros contexts |
| `billing` | catálogo de planos, clientes, assinaturas, invoices e uso | Asaas, identity, tenancy e outbox |
| `feedback` | sugestões privadas e histórico | identity/actor GUC e super-admin |
| `platform-admin` | consultas e operações cross-tenant do admin | `dbAdmin`, impersonação e auditoria |
| `health-insurance` | convênios e faturamento TISS: operadoras, contratos, carteirinhas, coberturas, autorizações, guias, lotes, glosas e terminologia TUSS ([ADR-072](../adr/072-convenios-e-tiss.md)) | scheduling, financial, payments, clinical (API pública) e AI |

## Regras de dependência

- Um context expõe contratos por `index.ts`, `api.ts` ou eventos. `internal/*` é privado.
- FK cross-context só existe quando a migration/arquitetura a autoriza; import direto de schema alheio é bloqueado.
- `src/lib` não depende de context. A infraestrutura oferece primitivas; o domínio decide quando usá-las.
- Contexts não compartilham transações abrindo novos pools. O chamador passa `Tx` para repositories envolvidos.
- Eventos são contratos versionados e validados. Um producer pode existir antes do consumer; o registry lista isso como `PRODUCER_AHEAD`.

## Fluxos entre contexts

```text
onboarding -> tenancy + identity + billing
patient <-> scheduling -> financial
scheduling -> health-insurance -> financial (recebível da operadora pela guia)
patient -> clinical
messaging -> ai-agent -> patient/scheduling/financial
scheduling/ai-agent -> billing usage metrics
billing -> tenancy access mode
all mutations -> audit + outbox
```

As setas indicam fluxo, não autorização para importar internals. Para regras específicas, use o documento canônico do domínio no [índice](../README.md).
