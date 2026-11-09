# Critérios de aceite

## Propostas quantitativas — precisam de aprovação G1

| Indicador                | Meta proposta para o cohort/ensaio                                                                     | Como medir                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Isolamento/autorização   | Zero acesso cruzado, elevação de papel/AAL ou uso de secret exposto                                    | Testes negativos de browser/API/DB real                                 |
| Integridade da migração  | 100% registros/objetos elegíveis contabilizados; hashes/constraints corretos; zero perda não explicada | Manifesto, snapshots, FKs, contagens por tenant e checkpoints           |
| Consistência financeira  | Zero duplicidade e zero diferença não resolvida de valor/período/binding/benefício                     | Reconciliação DB/provedores e ledger/invoice                            |
| E2E crítico              | 100% dos cenários críticos aplicáveis aprovados, sem skip usado como prova                             | Matriz A01–C07 com run IDs                                              |
| Contratos de adapter     | 100% capacidades anunciadas testadas; unsupported explícito                                            | Suite comum + prova externa onde aplicável                              |
| Latência                 | p95 até 20% acima da baseline na mesma carga/dados, sem timeout novo                                   | Teste reproduzível antes/depois, separar cold start                     |
| Jobs/outbox              | 21/21 schedules representados e autenticados; backlog dentro de SLO existente                          | Heartbeat, oldest age e efeitos; outbox usa 300 s no health atual       |
| Retorno de host          | Até 30 min em ensaio, com reconciliação e scheduler único                                              | Cronometrar desde acionamento até smoke saudável                        |
| RPO de cutover planejado | Zero escrita confirmada perdida entre freeze e promoção                                                | Delta/checkpoint e contagem de operações confirmadas                    |
| Recuperação de desastre  | Usar ~24 h só como planejamento do intervalo diário, não perda garantida; medir RTO completo           | Último backup saudável, restore do serviço/arquivos/config e tempo real |
| Fronteiras de código     | Zero import de adapter externo em consumidores migrados fora da composição permitida                   | AST/ESLint/madge; include dynamic/reexport fixtures                     |

A meta de cutover sem perder escrita confirmada não significa disponibilidade contínua, RPO zero em desastre ou PITR. O aceite anterior de risco diário não altera a meta de migração planejada e precisa ser reavaliado para a janela concreta.

## Definition of Done por capacidade

### Recorte de homologação AbacatePay com suporte pendente

A [matriz diferencial](asaas-to-abacatepay/MATRIZ-CENARIOS-E-TESTES.md#continuidade-aguardando-suporte--gates-s1-l1l7-e-e1e4) separa S1/L1–L7 de E1–E4. O pacote local deve compilar, passar lint/testes/segurança e comprovar persistência/rollback com migrations reais. Isso não substitui os quatro gates externos: renovação real; recuperação autoritativa sem webhook; checkout sem múltiplas recorrências e com histórico preservado; procedimento/eventos de refund/disputa de assinatura. A [solicitação consolidada](asaas-to-abacatepay/SOLICITACAO-SUPORTE-HOMOLOGACAO.md) não foi enviada pela engenharia. Permanecer NO-GO de Production enquanto houver P0 ou critério obrigatório não comprovado; não usar aprovação local como aceitação de risco.

Contrato e adapter atual equivalentes; alternativa suportada funcionando; testes e evidência reais; observabilidade e alerta; configuração/segredos corretos; isolamento e dados; cutover/retorno exercitados; documentação operacional; revisão/risco residual aprovados. Interface ou mock isolado não passa.

## Definition of Done global

Regras de domínio independentes dos SDKs dos três fornecedores; imports/persistência/config inventariados; identidade/autorizações e dados preservados; Storage com referências e ACL; gateway secundário homologado com limitações; app+landing em host alternativo; Postgres genérico e restore; contratos legados intactos; sem divergência financeira; monitoramento e rollback reproduzíveis; exercícios A/B/C e composto concluídos. O novo operador deve conseguir executar o procedimento sem credenciais no Git e sem depender do perfil Windows original para toda a recuperação.

Dependências deliberadas (PostgreSQL, Next, protocolo S3, OIDC/serviço de identidade escolhido, provedor financeiro com obrigações antigas) devem constar em ADR/scorecard. Não se exige independência de qualquer tecnologia existente, e sim capacidade de saída dos fornecedores definidos e riscos residuais explícitos.
