# P15.8 e P15.9 — pacote de liberação do Convênios/TISS (28/11/2026)

**Estado:** preparado, **não executado**. TISS em Production = **NO-GO**. P15.8 só vira PASS com a autorização de
lançamento do fundador; P15.9 só depois da observação real em Production. Nada aqui usa dado sintético como se fosse
observação de Production.

## 1. Pré-condições (todas precisam estar verdes no SHA de release)

| # | Condição | Onde se confere | Hoje |
| --- | --- | --- | --- |
| 1 | comercial (#68) integrado na `main` | PR #68 | draft, sem merge |
| 2 | #55 rebaseado sobre a `main` integrada, CI oficial verde (typecheck, lint, unitários, harnesses, cobertura ≥ 58%, build, segurança) | CI do PR #55 no SHA final | verde no head atual do #55; composição verde (#65) |
| 3 | migrations 0169–0171 no DEV com pré e pós-voo; E2E de P4.7, S3 e S4 no Preview | `manifesto-migrations-2026-11-26.md` §8 | esperando o item 1 |
| 4 | #59 (0172) e parte 2 da ADR-075 | PR #59 | draft |
| 5 | aceite financeiro P15.6 | `roteiro-revisao-financeira-p156.md` §7 | aguardando a marcação |
| 6 | decisão S9/S8 (R43) e B6 (prazos) | `consulta-regulatoria-s9.md`, `decisoes-pendentes.md` | abertas |
| 7 | alerta do Sentry entregue (P12.6) | `decisoes-pendentes.md` | token restrito ou regra pela tela |
| 8 | migrations TISS em Production com GO específico, backup verificado por restauração e pré/pós-voo | GO do fundador | **não autorizado** |

## 2. Flags e interruptores (do maior para o menor alcance)

| Interruptor | Onde | Padrão | Efeito |
| --- | --- | --- | --- |
| Disponibilidade comercial | `platform_settings` chave `convenios.available` (P1.13; console do super admin com TOTP e motivo, auditado) | **desligado** | sem ele, nenhuma clínica liga o módulo |
| Módulo por clínica | `hi_clinic_settings.enabled` (ligado pelo console, só com assinatura paga que inclui Convênios; o banco também barra) | desligado | operação nova só com ele; desligar preserva consulta e obrigação |
| Perfil de segurança TISS | env `TISS_SECURITY_PROFILE_ENFORCE` (+ `TISS_SECURITY_PROFILE_SCOPE`, `TISS_SECURITY_PROFILE_ACTIVATED_AT`) | desligado | S2–S4 para usuários das clínicas com rastro TISS; ligar só depois da 0170 no ambiente |
| Envio eletrônico por operadora | registro de operadoras homologadas (vazio em Production) | vazio | sem homologação (B5), só envio manual |
| Agente de IA com convênio (P11) | depende do módulo da clínica | — | módulo desligado = "é com a recepção" |

## 3. Plano de rollout (piloto controlado)

1. **Dia 0 (deploy, sem ativação):** merge e deploy com todos os interruptores desligados. Conferir que nenhuma clínica
   vê Convênios e que o agente responde "é com a recepção" (texto fixo do servidor).
2. **Piloto (1 clínica, escolhida pelo fundador):** ligar `convenios.available` e depois o módulo só dela, pelo
   console (TOTP + motivo). Cadastro de operadora, plano e contrato pela tela (R44), guia de Consulta, lote e
   exportação **manual**. Envio ao portal da operadora pela própria clínica.
3. **Critério para a 2ª clínica:** um ciclo de faturamento completo do piloto, sem divergência (`hi_ledger_drift` vazio)
   e sem incidente aberto. A 2ª clínica é decisão do fundador.
4. **Expansão:** por clínica, nunca global; o perfil de segurança acompanha o rastro TISS da clínica.

## 4. Treinamento e suporte

- Central de ajuda: as páginas de Convênios em `documentacao/content.ts` (P15.1), sem central paralela.
- Rotina da recepção: `runbooks-operacionais.md` §1–§3 (faturar, corrigir, reprocessar).
- Suporte: incidentes em `runbooks-operacionais.md` §5; interrupção do envio em `runbook-requisito-72-interrupcao-tiss.md`.
- Sessão de treinamento do piloto: 1 h com a recepção e a gestão da clínica (cadastro, guia, lote, glosa, recurso),
  com o roteiro da P15.2.

## 5. Monitoramento, alertas e saúde

| Sinal | Fonte | Limiar / ação |
| --- | --- | --- |
| Saúde do módulo e das trilhas | `/api/health?deep=1` (`audit_trails`, banco) | `degraded` → incidente §5 |
| Validador XSD | `/api/health/tiss-xsd` | indisponível → fail-closed, nada sai |
| Fila do outbox | heartbeat do cron e métricas `outbox.*` | fila crescendo por 3 ciclos → `outbox-capacidade.md` |
| Divergência financeira | `hi_ledger_drift` | qualquer linha → não ajustar à mão; reprocessar |
| Agente com convênio | `ai_agent.insurance.*` e `ai_agent.insurance_guard.blocked` | guarda disparando → revisar a conversa (sem dado pessoal no log) |
| Erros | Sentry com a tag `flow` | alerta real só depois da P12.6 |
| Banco | leitura só leitura de ledger, RLS exposta, locks e índices (`db-health-ro`, aplicado nos dois ambientes em 28/11) | qualquer item fora do zero → investigar antes de seguir |
| Trilhas | âncoras diárias (`scripts/security/audit-anchor.ts`) guardadas fora | `verify` com achado → incidente de integridade |

## 6. Reversão

A mesma de `runbooks-operacionais.md` §4, do menor para o maior impacto: desligar a clínica, voltar a operadora ao
manual, promover o deploy anterior (o schema é aditivo e convive com o código anterior). Migrations só com GO, backup
restaurado e os scripts de reversão; nunca apagar obrigação financeira nem arquivo TISS.

## 7. P15.9 — acompanhamento depois do lançamento (só com dado REAL de Production)

| Quando | O que medir | Quem confere |
| --- | --- | --- |
| D+1 | saúde (§5), zero erro novo no fluxo `convenios`, a guia e o lote do piloto conferem com o portal da operadora | agente (leitura só leitura) + fundador |
| D+7 | taxa de rejeição de lote, glosas por código, tempo de faturamento, chamados da clínica | fundador com a clínica |
| D+30 | um ciclo completo: envio, demonstrativo, pagamento, glosa e recurso, com o livro sem divergência | fundador |

P15.9 é PASS só com esse registro preenchido a partir de Production. Até lá: **BLOCKED pela P15.8**.
