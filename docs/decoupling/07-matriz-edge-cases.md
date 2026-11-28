# Matriz sistemática de cenários

**Estado de todas as execuções em adapters/hosts novos: PENDENTE.** Testes unitários atuais não são marcados como prova de migração. A [suíte executada](08-plano-de-testes.md) protege parte do comportamento AS-IS; cada linha abaixo exige evidência própria na fase indicada.

## Invariantes e evidência comum

- **A:** sujeito verificado, perfil ativo, MFA/claims_version e tenant/permissão autoritativos; zero acesso cruzado.
- **F:** uma operação comercial, uma cobrança efetiva pretendida, um benefício; binding provedor/conta imutável; cents/BRL/datas preservados.
- **D:** integridade de registros/constraints e escritor único; nenhum estado "sucesso" com efeito ausente.
- **S:** bytes/hash/ACL/retention corretos; privado nunca anônimo; exclusão não é ressuscitada.
- **H:** origem/ambiente corretos, segredo protegido, job/lease verificável, runtime e rollback suportados.

Cada execução deve registrar: ID abaixo, SHA/build/adapter/ambiente, fixture identificada, estado inicial agregado, estímulo, códigos/resposta, estado final no DB/provedor, invariantes e cleanup. Usar assert de estado e efeito, não somente status <500. Evidências sem cookies, payload clínico, tokens, PAN/CVV ou URLs assinadas. Recuperação indicada é proposta, não comando já disponível.

## Identidade (I01–I05)

| ID  | Estado inicial / estímulo                                    | Resultado e invariante                                            | Recuperação / teste                              |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------ |
| A01 | Conta nova; cadastrar e confirmar código válido              | Um subject/perfil/jornada; próxima etapa correta; A,D             | E2E + DB; reconciliar provisioning               |
| A02 | Código aberto; incorreto/expirado/replay                     | Recusa, tentativas e consumo corretos; A                          | Reenvio com cooldown; integração + E2E           |
| A03 | Código reenviado; duas confirmações simultâneas              | Consumo único, nenhuma clínica duplicada; A,D                     | Relê estado; teste concorrente                   |
| A04 | Sessão Supabase ativa durante cutover                        | Usuário admitido só por política de issuer aprovada; A            | Reautenticar, não confiar JWT antigo por default |
| A05 | Sessão expira no cutover                                     | Retoma jornada sem recriar conta/trial; A,D                       | Login/refresh válido; E2E                        |
| A06 | Refresh inválido, indisponível ou revogado                   | Sem loop/infinite loading nem elevação de acesso; A               | Erro claro e login; falha controlada             |
| A07 | Login simultâneo em duas réplicas                            | Mesma identidade; rate limit compartilhado; A,H                   | Retry sem nova conta; integração                 |
| A08 | Dois dispositivos; logout global                             | Refresh e sessão sujeitos à política de revogação; A              | Epoch/estado autoritativo; E2E replay            |
| A09 | Request em curso; usuário desativado/removido                | Nenhuma mutação sensível após verificação autoritativa vencida; A | Revalidar na fronteira crítica; concorrência     |
| A10 | Sessão ativa; papel/overrides mudam                          | claims_version antigo recusado; A                                 | Reemitir sessão aprovada; integração             |
| A11 | JWT assinado por chave antiga                                | Aceitar só janela/issuer/audience aprovados; A                    | Invalidar e reautenticar; segurança              |
| A12 | Hash não importável                                          | Não criar credencial fraca nem reset silencioso; A                | Recuperação comunicada; adapter contract         |
| A13 | MFA antigo presente                                          | Sem degradar AAL nem auto-marcar fator; A                         | Re-enrollment aprovado; E2E                      |
| A14 | Subject repetido em dois issuers                             | UUIDs não colidem por e-mail; A                                   | Resolver por issuer+subject; DB constraints      |
| A15 | Perfil com clinicId único; tenta tenant B                    | Recusa cruzada; multi-tenant por conta não presumido; A           | Sem fallback admin; isolamento real              |
| A16 | Criação Auth termina antes do profile                        | Sem acesso sem perfil; recuperação idempotente; A,D               | Provisioning reconciliável; integração           |
| A17 | Reset iniciado na origem e concluído após corte              | Token só no validador correto, consumo único; A                   | Encaminhar/expirar conforme janela; E2E          |
| A18 | E-mail confirmado/plano salvo; recarregar ou trocar aparelho | Preservar estado real sem senha duplicada indevida; A,D           | Retomada central; E2E completo                   |
| A19 | Conta convertida acessa recovery antigo                      | Nenhuma nova conta/assinatura; A,F                                | Direcionar acesso; integração + UI               |

## Financeiro (F01–F06)

| ID  | Estado inicial / estímulo                                  | Resultado e invariante                                         | Recuperação / teste                                    |
| --- | ---------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| F01 | Cobrança aberta; receber confirmação válida                | Um pagamento/invoice/benefício na conta correta; F             | Readback+DB+UI Sandbox                                 |
| F02 | Evento aplicado; repetir o mesmo evento                    | 2xx sem segundo benefício/registro indevido; F                 | Dedup namespace; integração                            |
| F03 | Pagamento já confirmado; evento atrasado/fora de ordem     | Não regredir paid nem reativar cancelado; F                    | Snapshot autoritativo; teste de sequência              |
| F04 | Webhook chega antes da resposta de create                  | Vincular operação/reserva, sem órfão; F,D                      | Reconciliar external ref; concorrência                 |
| F05 | Evento perdido                                             | Job materializa efeito correto uma vez; F                      | Reconciliação por binding e conta; integração          |
| F06 | POST criou cobrança; timeout local                         | Unknown outcome, sem POST novo em outro provider; F            | Lookup/ação humana se API não suporta; fault injection |
| F07 | Dois cliques/duas requests de checkout                     | Um checkout cobrante ou reconciliação explícita; F             | Lease/reserva; concorrência                            |
| F08 | Duas mudanças de plano simultâneas                         | Uma mudança elegível, sem duas cotas; F                        | Locks e conflito; DB + Sandbox                         |
| F09 | Cancelar enquanto upgrade processa                         | Estado auditado e cobrança viva identificada; F                | Reconciliação, não refund automático; integração       |
| F10 | Confirmação depois de hold/trial/checkout expirado         | Regra explícita preserva dinheiro e acesso; F                  | Tratamento de pagamento tardio existente; integração   |
| F11 | Refund total/parcial após uso                              | Acesso/repasse/revisão sem alegar DONE antecipado; F           | Readback e intenção manual; fixture terminal           |
| F12 | Chargeback depois de consumo                               | Risco e revisão registrados, histórico íntegro; F              | Fluxo de disputa na origem; adapter fixture            |
| F13 | Upgrade durante trial                                      | Relógio original não reinicia; rateio/termos preservados; F    | Teste com relógio e Sandbox                            |
| F14 | Downgrade no limite do vencimento                          | Cota elegível e preço remoto/local convergentes; F             | Guardas de ciclo; concorrência                         |
| F15 | Cartão recusado                                            | Sem acesso pago indevido; motivo seguro; F                     | Nova tentativa autorizada; Sandbox                     |
| F16 | Pix pago tardiamente ou boleto liquidado em atraso         | Readback e período correto; não duplicar dívida; F             | Reconciliar por cobrança de origem                     |
| F17 | Contrato Asaas ativo; default muda para gateway B          | Contrato antigo segue no Asaas; F                              | Binding persistido; teste multi-provider               |
| F18 | Ativo com próxima cobrança pendente                        | Direitos conforme período, não string ACTIVE isolada; F        | DB/provider snapshot; integração                       |
| F19 | Repasse suspenso e refund parcial confirmado               | Motivo/histórico/teto da revisão preservados; F                | Teste financial, sem payout fictício                   |
| F20 | Mesmo externalId em duas contas/providers                  | Nenhum evento/valor cruza conta ou clínica; A,F                | Unicidade composta; DB real                            |
| F21 | Corte em andamento; scheduler antigo cria próxima cobrança | Detectar contrato cobrante duplicado antes da nova cobrança; F | Pausar nova criação e reconciliar ambos; ensaio        |
| F22 | Refund pendente na origem após troca                       | Consulta/ação continua na origem; F                            | Manter credentials/binding mínimo; integração          |
| F23 | Eventos desconhecidos ou corpo forjado/inflado             | Recusa ou ignore observável sem concessão; F,H                 | Limite/autenticidade/readback; segurança               |
| F24 | Mudança anual/renovação/cancelamento                       | Flag de novas vendas e contratos existentes preservados; F     | Clock test ≠ renovação anual temporal                  |

## Dados e Storage (S01–S04, D01–D04)

| ID  | Estado inicial / estímulo                          | Resultado e invariante                                               | Recuperação / teste                             |
| --- | -------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- |
| D01 | Registro muda durante snapshot                     | Delta/watermark ou pausa final mantém versão correta; D              | Replay controlado; integração                   |
| D02 | Lote importado pela metade                         | Checkpoint idempotente e erro visível; D                             | Retomar lote sem duplicar; restore sintético    |
| D03 | Duplicatas, FK inválida ou constraint não validada | Corte impedido; D                                                    | Corrigir origem/transformação aprovada; SQL     |
| D04 | Sequence atrasada                                  | Próximo insert sem colisão; D                                        | Ajustar sequence em janela aprovada; SQL        |
| D05 | UTF-8/acentos ou timezone/collation diferentes     | Igualdade e agenda/datas mantidas; D,F                               | Rejeitar ambiente incompatível; golden fixtures |
| D06 | RLS/role não preservadas                           | Fail closed, nunca fallback admin; A,D                               | Abortar corte; tenant tests reais               |
| D07 | Migrations/hash/schema divergem                    | Plano bloqueia DDL/corte; D                                          | Rebase/replay isolado, sem editar histórico     |
| D08 | Objeto referenciado inexistente                    | Missing explícito e inventariado; S,D                                | Reparar fonte aprovada, não ignorar silently    |
| D09 | Arquivo copiado corrompido                         | Hash diferente reprova lote; S                                       | Retry e hash; bytes sintéticos                  |
| D10 | Upload interrompido/overwrite simultâneo           | Sem marcar completo antes da integridade; S,D                        | Version/checkpoint e conditional write          |
| D11 | Download começou na origem; cutover ocorre         | Stream termina ou retry seguro, ACL preservada; S                    | Janela de leitura de origem autorizada          |
| D12 | Signed URL expirada                                | Recusa e regeneração após autorização; A,S                           | E2E de TTL e permissão                          |
| D13 | Privado recebe request anônima ou tenant errado    | 401/403/404 conforme contrato, zero bytes; A,S                       | Abortar corte; teste real do storage            |
| D14 | Exclusão durante sincronização                     | Tombstone impede ressuscitar arquivo/registro; S,D                   | Replay tombstone; concorrência                  |
| D15 | Objeto sem referência                              | Inventário separado, sem delete por suposição; S                     | Classificar retenção antes de limpar            |
| D16 | Ciphertext antigo após mudança de host/DB          | Decrypt só com versão/chave aprovada, sem reencrypt improvisado; A,D | Restaurar acesso ao cofre; teste sintético      |

## Infraestrutura (H01–H04, O01–O04)

| ID  | Estado inicial / estímulo                      | Resultado e invariante                              | Recuperação / teste                               |
| --- | ---------------------------------------------- | --------------------------------------------------- | ------------------------------------------------- |
| H01 | Deploy interrompido                            | Release anterior íntegra; H                         | Blue-green e health real                          |
| H02 | Build verde; runtime sem pacote lazy/font/PDF  | Readiness reprova antes de tráfego; H               | Imagem anterior; smoke de capacidade              |
| H03 | Env ausente/secret inválido/ambiente errado    | Fail closed no recurso; sem prod em Preview; H      | Corrigir config + redeploy; teste matrix          |
| H04 | Cache antigo entre réplicas                    | Nenhum dado tenant cruzado; UI converge; A,H        | Invalidation e release coerente; E2E              |
| H05 | DNS parcial/TLS inválido                       | Endpoints válidos nas duas pontas durante janela; H | Rota anterior e TTL; probe externo                |
| H06 | Webhook aponta host anterior                   | Handler antigo preservado e evento conciliável; F,H | Encaminhamento servidor seguro ou endpoint retido |
| H07 | Cron repete, atrasa, falha ou sobrepõe         | Sem efeito duplo; heartbeat alerta; H,F,D           | Lease/retry/deadline; falha induzida              |
| H08 | Réplicas excedem pools/limite DB               | Backpressure e alertas; nenhum bypass RLS; H,A      | Reduzir réplicas/concurrency; load test           |
| H09 | Cold start / rede lenta / timeout              | Orçamento e unknown outcome preservados; H,F        | Retry somente seguro; fault injection             |
| H10 | Rollback de app com schema expandido           | Versão antiga lê/escreve compatível; D,H            | Ensaio N/N-1; não reverter só commit              |
| H11 | SSR/middleware/Actions em runtime incompatível | Teste reprova plataforma antes de corte; A,H        | Host homologado anterior                          |
| H12 | Novo host da landing                           | 404/redirect/CSP/CTA e atribuição corretos; H       | Static release anterior; desktop/mobile           |
| H13 | Alert collector indisponível                   | Falha observável em canal independente; H           | Uptime/heartbeat alternativo; entrega de teste    |

## Falhas compostas (X04)

| ID  | Estado inicial / estímulo                          | Resultado / recuperação / evidência                                                                                    |
| --- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| C01 | DB snapshot + pagamento simultâneo                 | Writer único ou log de delta; binding e evento não se perdem; reconciliar após restauração; DB/provedor agregados      |
| C02 | Auth cutover + sessão ativa + upgrade              | Um sujeito interno, autorização fresca, um benefício; reautenticar antes de concluir efeito sensível; trace sanitizado |
| C03 | Host novo + webhook atrasado + rollback            | Dedup global por operação/conta no DB autoritativo; endpoint antigo não cria efeito novo; ensaio de sequência          |
| C04 | Outage parcial + retry + timeout de POST           | Operação unknown reconciliada antes de nova criação; zero pagamento duplicado; Sandbox + fault injection               |
| C05 | App N-1 + schema expandido + nova escrita          | N-1 compatível ou corte interrompido; preservar delta posterior; SQL e E2E                                             |
| C06 | Storage move + delete concorrente + rollback       | Tombstone propagado nos dois destinos; sem restauração de acesso eliminado; hashes/manifesto sem nomes sensíveis       |
| C07 | Novo gateway + refund no antigo + conta desativada | Manter custódia/roteamento mínimo da origem; nenhuma tentativa de refund no gateway novo; fixtures e auditoria         |

São **79 cenários identificados** (19 identidade, 24 financeiro, 16 dados/Storage, 13 infraestrutura e 7 compostos). Não representam cobertura absoluta. Acrescentar casos quando a escolha de um provider revelar diferenças reais de contrato.
