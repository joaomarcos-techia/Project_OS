# Documentação do ClinicaOS

## Status

Canonical — índice da documentação atual.

## Scope

Esta pasta descreve o código presente neste repositório. O nome técnico é **ClinicaOS**; a marca exibida no produto é **Qoro**. Evidência histórica não é usada como prova de estado atual.

## Ordem de autoridade

1. Código, migrations e configuração versionada.
2. Testes e scripts executáveis.
3. Documentos canônicos abaixo.
4. Evidência histórica e intenção futura.

`IMPLEMENTADO` significa que há implementação no repositório. Não significa que migration, credencial, webhook, template ou deploy estejam ativos em produção.

## Leitura recomendada

1. [Estado atual](CURRENT-STATE.md)
2. [Arquitetura](VisãoGeral.md)
3. [Mapa de contexts](architecture/context-map.md)
4. Documento do domínio a alterar
5. [Testes e gates](development/testing.md)

## Fontes canônicas

| Assunto | Documento |
| --- | --- |
| Arquitetura e fluxos principais | [Visão geral](VisãoGeral.md) |
| Bounded contexts e dependências | [Context map](architecture/context-map.md) |
| Visão C4, grafos gerados e riscos | [C4](architecture/c4.md) e [riscos](architecture/risks.md) |
| Achados adiados durante a execução | [Discovery log](discovery-log.md) |
| Cobertura E2E: auditoria e matriz | [Auditoria E2E](quality/e2e-coverage-audit.md) e [matriz](quality/e2e-coverage-matrix.md) |
| Inventário do implementado, com ADRs | [qorov2 §32](qorov2.md#32-inventário-do-implementado--mapa-com-adrs-14092026) |
| Banco, migrations, pools e RLS | [Schema e tenancy](database/schema.md) |
| Backend, APIs, crons e outbox | [HTTP, jobs e outbox](backend/http-jobs-outbox.md) |
| Frontend, rotas e acesso | [Rotas e permissões](frontend/routes-and-access.md) |
| Identidade e onboarding | [Onboarding](onboarding-spec.md) |
| Pacientes, clínica e LGPD | [Paciente, clínico e LGPD](domains/patient-clinical-lgpd.md) |
| Agenda e financeiro da clínica | [Scheduling e financial](domains/scheduling-financial.md) |
| Agente e tools de IA | [Agente de IA](ai/agent.md) |
| Planos, cobrança e acesso | [Billing](billing/subscriptions.md) |
| Providers externos | [Integrações](integrations/providers.md) |
| Autenticação, autorização e criptografia | [Modelo de segurança](security/model.md) |
| Deploy, observabilidade e retenção | [Operações](operations/deployment-observability.md) |
| Ambiente local | [Setup](development/setup.md) e [variáveis](development/environment.md) |
| Processo de mudança | [Guia de decisão](engineering/decision-guide.md) e [Definition of Done](engineering/definition-of-done.md) |
| Decisões arquiteturais vigentes | [Decisões](adr/README.md) |
| Limitações e validações externas | [Limitações conhecidas](roadmap/known-limitations.md) |
| Procedimentos operacionais | [Runbooks](runbooks/README.md) |

## Estados documentais

- `Canonical`: fonte documental principal do assunto.
- `Reference`: complemento operacional; não redefine um documento canônico.
- `Historical`: evidência datada; não descreve o presente.
- `REQUIRES_MANUAL_VALIDATION`: não determinável apenas pelo repositório.
- `NOT_IMPLEMENTED`: contrato, skeleton ou intenção sem comportamento funcional.

Documentos antigos redundantes foram removidos. O resumo do material histórico preservado está em [evidence snapshots](archive/evidence-snapshots.md); versões completas continuam recuperáveis pelo Git.
