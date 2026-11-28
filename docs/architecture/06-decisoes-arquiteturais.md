# Registro de decisões propostas

Não substitui ADRs aprovadas existentes. **Todas as decisões D01–D12 estão propostas, não aprovadas nem implementadas.** Ao aprovar, criar ADR na sequência livre do repositório e referenciar estes IDs; não reutilizar números existentes.

| ID  | Decisão recomendada e motivo                                                                            | Alternativa / trade-off                                             | Quem aprova / quando                                            |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| D01 | Manter monólito Next e PostgreSQL; desacoplar capacidades                                               | Reescrita troca muitos riscos ao mesmo tempo                        | Responsável técnico, G1                                         |
| D02 | Provar hosting alternativo antes de trocar Auth/DB                                                      | Pode não ser a maior economia, mas menor blast radius               | Founder aprova ambiente/custo; técnico G1                       |
| D03 | APP_ENV explícito + identidade esperada do backend + allowlist                                          | Heurística de host é simples mas incompleta para custom domains     | Segurança/técnico, antes de H01                                 |
| D04 | Extrair contratos a partir dos casos de uso atuais                                                      | Adapter universal cresce e esconde incompatibilidades               | Técnico, antes de F01/S01                                       |
| D05 | Roteamento financeiro persistido por contrato e conta; sem failover de criação                          | Exige schema e convivência, protege recorrência e chargeback        | Founder/técnico, antes de migration F03                         |
| D06 | Novos clientes primeiro no futuro gateway; antigos permanecem até consentimento/capacidade demonstrados | Saída completa é mais lenta; reduz dupla cobrança                   | Comercial/jurídico/financeiro, antes de cutover financeiro      |
| D07 | Identidade interna estável e autorização Qoro preservada                                                | Mapping/adaptação de FKs é trabalho adicional                       | Segurança/técnico, antes de I02                                 |
| D08 | Storage por referências lógicas; manter proxy clínico e classificação público/privado                   | Logos/exports existentes exigem compatibilidade transitória         | Segurança/técnico, antes de S02                                 |
| D09 | Um escritor e um scheduler ativo por geração; shadow somente sem efeitos                                | Cutover com pausa curta pode ser preferível a dual-write complexo   | Operação/founder aprova janela, antes de cada ensaio externo    |
| D10 | Não contratar PITR por este plano; preservar aceite limitado anterior                                   | O aceite de lançamento não aprova perda de dados numa nova migração | Founder aceita risco novo com RPO/RTO medidos no G0 operacional |
| D11 | Sessões/MFA não serão considerados transferíveis sem prova                                              | Reautenticação/re-enrollment pode exigir comunicação e suporte      | Segurança/produto, antes de I03                                 |
| D12 | Nova independência só é PASS após exercício externo correspondente                                      | Interface+mock é preparação; não é homologação                      | Técnico/QA no G4/G5/G6/G7/G8                                    |

## Aprovações estritamente necessárias

O plano não pede nova aprovação geral para leitura ou documentação. Implementação de interfaces públicas, CI/build/deploy, migrations, novas dependências de produção e alterações amplas seguem o AGENTS.md. Custos/contas alvo, credenciais, dados médicos fora dos destinos já aprovados, comunicação e qualquer janela de produção exigem autorização concreta. Não reutilizar a autorização de rollout antigo para este programa.

Nenhuma condição de preço, trial, plano anual ou desconto vitalício é alterada. A oferta observada está em E16; parâmetros comerciais são fixtures de regressão, não configurações que o gateway alternativo possa redefinir.
