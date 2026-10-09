# Decisões arquiteturais vigentes

## Status

Canonical — decisões atuais consolidadas.

## Scope

Os 48 ADRs antigos registravam muitas etapas intermediárias e repetiam regras de domínio. O Git preserva esse histórico. Esta tabela contém somente decisões ainda sustentadas pela implementação; arquivos individuais permanecem quando código/scripts os referenciam.

| Decisão | Estado atual | Fonte canônica |
| --- | --- | --- |
| Bounded contexts com internals privados | Accepted | [context map](../architecture/context-map.md) |
| PostgreSQL/Supabase + Drizzle/postgres.js | Accepted | [database](../database/schema.md) |
| RLS forçada e `withTenant` na mesma tx | Accepted | [ADR-007](007-rls-implementation-patterns.md) |
| Supabase Auth + roles/permissions no profile | Accepted | [ADR-008](008-identity-patterns.md) |
| `claims_version` contra drift JWT | Accepted | [ADR-009](009-claims-drift-mitigation.md) |
| SECURITY DEFINER somente como seam mínimo auditado | Accepted | [ADR-010](010-security-definer-patterns.md) |
| Outbox transacional at-least-once | Accepted | [ADR-011](011-outbox-audit-idempotency-patterns.md) |
| Cobrança de paciente e sinal anti-no-show | Accepted | [ADR-049](049-pagamentos-paciente-sinal.md) |
| Identidade de pagamento do paciente (customer Asaas por clínica) | Accepted | [ADR-050](050-identidade-de-pagamento-do-paciente.md) |
| `financial` é a fonte da verdade; `patient_charges` é instrumento de cobrança; crédito antecipado concilia os dois | **Implementado (1.5b)** | [ADR-051](051-conciliacao-sinal-e-recebivel.md) |
| Chargeback/disputa altera dinheiro, não o fato clínico; perdas compensam o ledger append-only | Accepted | [ADR-052](052-risco-e-reversao-de-pagamento-do-paciente.md) |
| PII/clínico cifrado por tenant | Accepted | [security](../security/model.md) |
| Prontuário assinado imutável; retenção legal sobre anonimização | Accepted | [patient/clinical](../domains/patient-clinical-lgpd.md) |
| Meta Cloud API é o único messaging provider funcional | Accepted | [ADR-020](020-messaging-provider-patterns.md) |
| Gemini é o provider de IA funcional | Accepted | [ADR-022](022-ai-agent-foundation.md) |
| Confirmação em dois turnos e segurança clínica | Accepted | [ADR-048](048-ai-agent-conversational-safety.md) |
| Asaas-only, planos/preços separados, sem overage | Accepted | [billing](../billing/subscriptions.md) |
| Trial 14d e convite mágico HMAC/versionado | Accepted | [onboarding](../onboarding-spec.md) |
| Cadastro autônomo, atribuição e provisionamento pós-billing | Proposed | [ADR-053](053-cadastro-autonomo-seguro.md) |
| Comprovante de pagamento separado de recibo fiscal/Receita Saúde | Accepted | [ADR-054](054-documento-de-pagamento-e-recibo-fiscal.md) |
| Documento clínico centrado no paciente; consulta é vínculo opcional | Accepted (UI/DEV/Preview implementados) | [ADR-055](055-documentos-clinicos-fora-da-consulta.md) |
| Integração Memed depende de contrato, homologação, segurança frontend e SNCR real | Proposed / external gate | [ADR-056](056-spike-integracao-memed.md) |
| Recuperação separa retorno clínico existente de contato após falta | Accepted (2.4A e 2.4B em código/DEV/Preview; E2E Meta pendente) | [ADR-057](057-recuperacao-falta-retorno.md) |
| CSV mensal do ledger para contabilidade, sem valor fiscal | Accepted (código/DEV/Preview) | [ADR-058](058-exportacao-financeira-contabilidade.md) |
| PDF clínico servido por rota Qoro autenticada, sem bearer URL no cliente | Accepted (implementação local; rollout pendente) | [ADR-059](059-acesso-autenticado-pdfs-clinicos.md) |
| Sessão anônima de cadastro: fatia O-2 cortada em O-2a/O-2b, perguntas antes da identidade, limiter graduado | O-2a Accepted; O-2b Accepted no servidor; quatro perguntas e sessão HttpOnly com provas locais datadas, sem novo rollout | [ADR-060](060-sessao-anonima-de-cadastro.md) e [Qoro v2 §35.5–§35.6](../qorov2.md) |
| Inadimplência bloqueia escrita, não login/leitura | Accepted | [billing](../billing/subscriptions.md) |
| Sentry + logs + métricas + health/heartbeats | Accepted | [operations](../operations/deployment-observability.md) |

Decisão futura só entra aqui quando adotada na implementação. Uma ideia descartada ou sem código não é `Accepted`.

## Decisões locais — sem rollout externo

| Contrato | Estado | Documento |
| --- | --- | --- |
| Identidade + consentimento + nome da clínica; corte O-3a/staging e O-3b/Auth/ownership | O-3a e O-3b.1–6 Accepted local em 15–16/09/2026; sem rollout externo | [ADR-062](062-identidade-consentimento-cadastro.md) |
| C14 reenvia com uma chave por geração: recusa retentável da Meta gera chave nova e backoff; definitiva falha na hora, com o código; timeout nunca reenvia | Accepted em código em 08/10/2026; 0118 não aplicada; sem rollout | [ADR-064](064-c14-reenvio-por-geracao.md) |

ADR-061 permanece reservada ao perfil WhatsApp de Qoro v2 §33; não foi criada nesta fatia.
