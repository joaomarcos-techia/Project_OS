# Estratégia de migração e simulações

**Proposta.** Nenhum comando de produção é autorizado por este texto. Procedimento operacional detalhado em [provider-cutover](../runbooks/provider-cutover.md); critérios em [gates](09-gates-de-validacao.md).

## Um eixo de mudança por vez

Manter schema/aplicação compatíveis por expand-and-contract. Introduzir novas leituras antes de novas escritas; backfill idempotente e verificável; selecionar cohort por identidade persistida. Não fazer dual-write remoto como padrão: falha em um destino cria divergência sem transação global. Shadow pode comparar leituras/decisões com dados sintéticos ou autorizados, sem criar cobrança, conta ou mensagem.

```mermaid
flowchart LR
  A[Inventário congelado e autorizações] --> B[Snapshot protegido + manifestos + restore provado]
  B --> C[Destino isolado com schema/roles/config compatíveis]
  C --> D[Cópia inicial e validação]
  D --> E[Delta por checkpoint ou pausa aprovada]
  E --> F[Congelar writers e drenar jobs/leases]
  F --> G[Delta final + constraints + hashes + financeiro]
  G --> H{Gate aprovado?}
  H -->|não| I[Manter origem e corrigir]
  H -->|sim| J[Um writer e uma geração de scheduler no alvo]
  J --> K[Smoke + reconciliar + observar]
  K --> L[Retenção da origem até obrigações/aceite]
```

## Preparação por capacidade

| Eixo       | Antes                                                                        | Durante                                                               | Depois                                                                      |
| ---------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Hosting    | Build e config equivalentes, novos endpoints seguros, mesmo backend de teste | Release coerente, writer/scheduler único; DNS com período compatível  | Smoke/heartbeats/alertas, preservar host anterior e callbacks               |
| Storage    | Lista/ACL/hash/metadata e referências lógicas                                | Cópia, delta/overwrite/delete com tombstone, freeze final             | Byte/ACL/URL compatibility, não remover fonte antes da janela               |
| Identidade | UUID/binding, MFA/hash/capacidades, recuperação e política de sessão         | Um escritor de credenciais; issuers allowlisted só na janela aprovada | Revogação/epoch/estado, reauth se preciso, suporte e audit                  |
| PostgreSQL | Versões/roles/extensões, snapshot e queries                                  | Writer único, delta/seq/partições e queues                            | Constraints/RLS/crypto/consultas e divergência zero                         |
| Gateway    | Binding persistido, checklist de obrigações e consentimentos                 | Novo cohort somente; nenhuma duplicação de recorrência                | Webhooks/reconcile antigos ativos até liquidação/refund/disputas resolvidos |

## Flags e roteamento

**Existentes:** SIGNUP_ENABLED e OFFER_2026_ANNUAL_NEW_SALES_ENABLED controlam cadastro e novas vendas anuais; não controlam migração de dados/provedor. **Propostos:** rollout por release/adapter em composição e binding persistido financeiro/identidade/objeto. Os nomes finais e schema serão decididos em B02; não há flag operacional implementada por este plano. Variável global pode escolher provider para novas operações elegíveis, nunca reescrever o binding de contratos existentes.

## Exercícios de saída

- **A / X03:** banco Postgres genérico + identidade alternativa + Storage alternativo; login/refresh/reset/MFA/roles, duas clínicas, agenda/prontuário/PDF/financeiro e reconstrução. Manter Supabase self-hosted não passa independência tecnológica total.
- **B / X02:** gateway secundário Sandbox, recorrência/métodos homologados, trial, quota, upgrade/downgrade/cancelamento, evento duplicado/fora de ordem/ausente, readback, origens e retorno. Simulador pode provar domínio; API e consentimentos exigem prova externa.
- **C / X01:** app Node e landing estática em host não Vercel, crons/headers/Actions/PDF/segredos/observabilidade, teste browser/API e rollback.
- **Combinado / X04:** somente após A/B/C, falhas C01–C07 e recuperação de escrita pós-corte. Oportunidade de testar interação; não proposta de trocar tudo junto em produção.

## Desativação futura

Antes de apagar qualquer origem: zero dependência operacional não declarada, nenhuma cobrança pagável/recorrência cobrante duplicada, nenhum refund/disputa pendente sem operador, URLs temporárias expiradas ou roteadas com segurança, chaves/config/backup recuperáveis, retenção legal e suporte aprovados. Revogar credentials somente após inventário de todos os consumidores e autorização. O plano não apaga recursos, nem deixa "limpeza" como efeito colateral do teste.
