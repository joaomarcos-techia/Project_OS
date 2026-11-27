# Plano Asaas: contratos e convivência financeira

Fontes [E10–E16](../architecture/01-contexto-atual.md). Não realizar troca financeira nesta fase. Não escolher segundo gateway por taxa antes de comprovar recorrência, métodos, readback, idempotência e operação de contas recebedoras.

## Estado atual e fronteiras

O contrato PaymentProvider existe dentro de `lib/payments/asaas/index.ts`. O adapter normaliza parte do transporte, mas tipos como AsaasBillingType, strings de status/ciclo e parâmetros asaasSubscriptionId chegam a consumidores. Billing tem máquinas próprias e sincronização de recorrência; schema mantém campos asaas\_\* e dedup sem namespace multi-provider. Payments paciente tem coluna provider, mas single-gateway explícito; isso não permite convivência automaticamente.

| Fluxo existente               | Regra a preservar ao extrair adapter                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Cliente / cadastro / contrato | Relacionar à identidade interna; preço vem do servidor; externalReference e operação estável permitem reconciliação                |
| Trial                         | Oferta nova: 14 dias desde Auth; dia de cobrança evita antecipação; checkout tardio exige confirmação; preservar contratos legados |
| Mensal / anual                | Não abrir novas vendas anuais por migração; flag de oferta preservada; anual existente e cancelamento mantêm direitos              |
| Upgrade e médico extra        | Rateio do domínio, operação persistida, pagamento confirmado e recorrência remota sincronizada antes da cota                       |
| Downgrade / troca de ciclo    | Efetivação aprovada no vencimento e capacidade elegível; não gerar assinatura paralela por conveniência                            |
| Atraso / dunning              | Preservar política de acesso e período, não traduzir qualquer erro de provider em bloqueio total                                   |
| Cancelamento / reativação     | Auditar cancelamento e cobranças ainda vivas, paginação completa; pagamento tardio não reativa cancelado genericamente             |
| Sinal / saldo paciente        | Conta pertence à clínica; dedup e vínculos por tenant/conta; crédito antecipado não é consulta concluída                           |
| Refund / chargeback           | Intenção pendente ou ação manual não é DONE; manter reconciliação na origem e revisão de repasse                                   |
| Repasse / NF                  | Repasse interno é cálculo/relatório; adapter auditado não implementa payout/split nem emissor de NF                                |

## Evolução F01–F06

1. **F01:** extrair portas pequenas e DTOs internos preservando a facade atual. Não mover todos os métodos de um arquivo para outro e declarar desacoplamento concluído. Remover statuses/ciclos proprietários dos casos de uso por PR comportamental.
2. **F02:** traduzir notificação para envelope com namespace e ler snapshot autoritativo. Manter limite de corpo, autenticidade, erro transitório e dedup atômico. Não transformar HTTP 200 imediato em garantia de processamento se ainda não existe inbox durável.
3. **F03:** adicionar binding imutável por contrato/conta/operação e unicidades compostas. Backfill explícito `asaas` sem mudar IDs, valores, price_id, datas ou desconto. Leitores compatíveis antes de ativar qualquer escritor novo. Migration exata somente após especificar schema e revisar locks.
4. **F04:** reservar operação no DB e reconciliar resultado desconhecido. Manter erro `unknown_outcome`; não enviar POST em outro gateway para compensar timeout. Persistir checkpoint dos passos remotos e retomar com prova da conta certa.
5. **F05:** homologar capacidades do segundo gateway em Sandbox sintético identificado. Se não oferecer ajuste de recorrência, lookup, método ou ciclo necessários, marcar unsupported e voltar à decisão de produto; não inventar regra comercial.
6. **F06:** novos contratos no novo provider após aprovação, contratos antigos continuam roteados à origem. Transferência de contrato ativo exige plano individual e comunicação/consentimento se necessário. Manter origin gateway até zerar obrigações e janela legal/operacional de readback.

### Checklist de portabilidade financeira

| Item                                        | Transferibilidade considerada pelo plano                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| IDs de cliente, contrato e cobrança         | Mapeáveis para IDs internos; nunca reutilizar como ID no destino                                                         |
| Histórico                                   | Copiar somente dados aprovados de auditoria/reconciliação; gateway origem continua fonte das transações antigas          |
| Cartão tokenizado / mandato / consentimento | **PENDENTE externo**; não presumir exportação nem reuso. Checkout/reconsentimento pode ser necessário                    |
| Pix/boleto em aberto                        | Permanecem pagáveis na origem até expiração/cancelamento confirmado; não emitir substituto simultâneo sem regra aprovada |
| Refund e chargeback                         | Processar no gateway que recebeu; conservar binding e credencial de leitura/ação autorizada                              |
| Saldo e liquidação                          | Não são saldos transferidos por migration SQL; settlement exige comprovação financeira própria                           |
| Recebedores/split                           | Contas, KYC e contrato separados; sem fallback para conta Qoro                                                           |

## Webhooks e reconciliação

O [Asaas documenta entrega at-least-once e dedup pelo ID de evento](https://docs.asaas.com/docs/sobre-os-webhooks). No Qoro, token constante autentica a notificação e readback confirma estado/valor/vínculo. Preservar esse limite de confiança no adapter novo; assinatura criptográfica mais forte do novo provider não elimina dedup, reordenação nem reconciliação.

Manter `/api/webhooks/asaas` e `/api/webhooks/asaas/patient/[ref]` disponíveis durante convivência. Não redirecionar POST via 301/302 nem trocar secret de todos os contratos por uma env global. Cadastro de webhook do novo gateway é endpoint separado; alias estável e conta/ambiente esperados. Reconciliação seleciona adapter pelo binding, não pela flag comercial atual.

Inbox nova é opcional arquitetural: só necessária se orçamento de latência/retries demonstrar a necessidade. Se adotada, criptografar/minimizar dados, persistir envelope e pointer seguro, responder após commit durável, processar com lease e DLQ auditável; não duplicar o outbox já existente.

**Gate G4:** mesmo contrato sintético percorre criação, trial, pagamento, upgrade, downgrade, cancelamento, falha, replay e reconciliação no segundo provider; zero dupla cobrança/benefício e nenhuma divergência sem resolução. Não declarar renovação anual temporal de um ano porque relógio simulado passou. Valores/ciclos e tokenização ainda exigem evidência específica.
