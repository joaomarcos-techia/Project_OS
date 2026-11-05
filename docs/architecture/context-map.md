---
title: "Mapa de contextos"
description: "Quem possui cada dado e como os 13 domínios do Qoro se conectam."
docType: "reference"
reviewedAt: "2026-11-05"
---

## Status

Canonical — ownership e dependências de domínio.

## Source of Truth

`src/contexts/*`, barrels públicos `index.ts`/`api.ts`, `eslint.config.mjs` e checks `arch:*`.

## Contexts

| Context | Owns | Integrações principais |
| --- | --- | --- |
| `tenancy` | clínicas, unidades, slugs | base de todos os dados tenant-scoped |
| `identity` | profiles, roles, permissions e login attempts | Supabase Auth, tenancy e billing quota |
| `onboarding` | convites, intenção de cadastro, prova de e-mail, retomada e provisionamento | Asaas, Supabase Auth, tenancy, identity e billing |
| `patient` | cadastro, PII, consentimento, vínculos e LGPD | scheduling, clinical, Storage e outbox |
| `scheduling` | agenda, procedimentos, disponibilidade, recursos, fila e waitlist | patient, financial, AI e messaging |
| `clinical` | prontuário, versões, prescrições e documentos | patient, scheduling, Storage e crypto |
| `financial` | lançamentos, pagamentos, estornos, fornecedores e caixa | scheduling, messaging e outbox |
| `payments` | conta recebedora da clínica, instrumentos de cobrança do paciente, checkout e fatos do provedor | Asaas, financial, scheduling, patient e outbox |
| `messaging` | números WhatsApp, inbound/outbound e status de provider | Meta, AI e outbox |
| `ai-agent` | conversas, mensagens, tools, pending actions e handoff | Gemini e APIs públicas de outros contexts |
| `billing` | catálogo de planos, preços, contratos SaaS, invoices, uso e direitos por plano | Asaas, identity, tenancy e outbox |
| `feedback` | sugestões privadas e histórico | identity/actor GUC e super-admin |
| `platform-admin` | consultas e operações cross-tenant do admin | `dbAdmin`, impersonação e auditoria |

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
patient -> clinical
payments -> financial (fatos de pagamento e conciliação)
messaging -> ai-agent -> patient/scheduling/financial
scheduling/ai-agent -> billing usage metrics
billing -> tenancy access mode
all mutations -> audit + outbox
```

As setas indicam fluxo, não autorização para importar internals. Para regras específicas, use o documento canônico do domínio no [índice](/index).

## Fronteiras financeiras

- `billing`: a clínica paga pela Qoro;
- `payments`: o paciente utiliza um instrumento para pagar a clínica;
- `financial`: a clínica reconhece e concilia obrigação, dinheiro e repasse.

Um checkout não cria outra obrigação por si, e um estado de conversa não substitui
o estado persistido de agendamento ou recebível.

## Percursos de investigação

| Sintoma | Siga os fatos nesta ordem |
| --- | --- |
| Cadastro não conclui | Sessão → Auth/prova → draft → plano → checkout → reconciliação → tenant |
| IA promete agendamento | Turno → ferramenta/ação pendente → validação da agenda → linha persistida |
| Mensagem não chegou | Reserva outbound → resposta Meta → callback de status → motivo de falha |
| Pagamento não aparece | Instrumento → fato do provedor → evento → crédito/recebível no financeiro |
| Médico não pode acessar | Identidade → capacidade clínica → permissão → recurso no plano → tenant/RLS |
| Vaga extra não liberada | Intenção de mudança → pagamento → assinatura Asaas → plano/cota local |
