# Dossiê de homologação — Convênios TISS (22/11/2026)

**Escopo:** o que pode ser comprovado em DEV, Preview e Postgres descartável.
- **Não é** homologação com operadora real: nenhuma operadora está homologada (B5).
- **Não é** autorização de produção: produção do TISS continua **NO-GO** e o PR #55 continua draft.

**Regras desta página:**
- cada linha aponta o SHA realmente testado e o run;
- dados 100% sintéticos;
- nenhuma credencial ou identificador.

Nesta página, "simulador" quer dizer a operadora stub (`stub-operator.ts`), com o XSD oficial do webservice. Ela **não** é operadora real.

## Ambientes e SHAs

| Ambiente | O que roda | SHA do #55 | Run |
| --- | --- | --- | --- |
| CI (Lint, Typecheck, Test, Build, isolamento, inventário, E2E público) | toda a suíte | `d9bf25b6` | `45004612135` |
| Provas sintéticas (Postgres descartável, código e handlers reais) | 25 harnesses | `d9bf25b6` | `45004606248` |
| Benchmark do outbox (Postgres descartável) | 23 rodadas | `85d37eb9` | `44856201932` |
| Composição #53 + patch R61-B | gates do #53 e provas do outbox | `dbddea9c` (#53 em `bc955f4e`) | `45003465119` |
| E2E no Preview (Auth e banco do DEV, navegador remoto) | 6 grupos | `75b23606` | `45005774431` (ver §E2E) |
| Produção, só leitura | agregados do outbox | — | `evidence/tiss-homologacao-final-2026-11-22/r61-producao-leitura.json` |

O SHA final do PR fica registrado no plano mestre. Os commits depois de `d9bf25b6` mudam só o pedido de E2E, o runner remoto e documentos.

## Resultado por área

| # | Área | Prova e cenário | Resultado | Evidência | Limitação |
| --- | --- | --- | --- | --- | --- |
| 1 | Configuração (módulo, plano, trial, operadora, credencial) | interruptor pela plataforma 6/6; gatilhos do módulo 9/9; classe A e C 4/4; credenciais 6/6; E2E de configuração | PASS (sintético); E2E: §E2E | job sintético `45004606248`; `convenios-config-preview.spec.ts` | trial e plano provados no banco e no serviço; `convenios.available` só como contrato com o #57 |
| 2 | Permissões (matriz I.2) | 0162 12/12; escopo e valores das leituras 6/6; `actions-gate` (regra por evento, falha fechada); E2E I.2 e overrides | PASS (sintético e unitário); E2E: §E2E | `45004606248`, `45004612135` | papéis reais do produto; superadmin só pelo console (#57) |
| 3 | Pacientes | isolamento entre clínicas no CI (`security:tenant`, `security:tenant:convenios`) | PASS | CI `45004612135` | — |
| 4 | Carteirinhas | filtro de posse (D-3), leitura auditada com finalidade, cifra | PASS (prova I.2 e testes) | `45004606248` | sem dado real |
| 5 | Atendimento | estados da cobertura não bloqueiam o atendimento clínico (P5.1) 3/3; série recorrente 4/4 | PASS | `45004606248` | — |
| 6 | Autorizações | consumo uma vez por sessão; série com autorização 4/4; comprovante em partes 4/4; avisos 9/9; manutenção 6/6 e concorrência 6/6 | PASS | `45004606248`; E2E de autorizações (§E2E) | — |
| 7 | Guias | SP/SADT 12/12 (solicitação → sessão → guia → emissão → XML no XSD); estados da guia | PASS (sintético) | `45004606248` | spec de estados da guia: NOT RUN neste ciclo (precisa de comando de fixture durante a execução; última evidência 12/12 em 15/11) |
| 8 | TISS 4.03.00 (XML, XSD, 7 operações) | adaptador SOAP 24/24 contra o simulador; conector 8/8; corpus XSD em dois motores | contrato técnico: PASS; simulador XSD: PASS; **recibo externo real: NOT VERIFIED** | CI `45004612135` | operadora simulada não é operadora homologada |
| 9 | Envio | envio pelo conector 7/7 (recibo conferido, nunca reenvia sozinho); teto total de 20 s por envio | PASS (teto "Testado") | `45004606248` | sem operadora real (B5) |
| 10 | Retorno | demonstrativos idempotentes pelo número da operadora; retorno duplicado | PASS (provas anteriores mantidas na CI) | CI `45004612135` | — |
| 11 | Recibos | recibo conferido no XSD e no hash antes de virar protocolo | PASS (simulador) | adaptador SOAP 24/24 | recibo real: NOT VERIFIED |
| 12 | Reprocessamento | retorno reprocessado idempotente; reentrega pelo janitor sem efeito duplicado | PASS | `45004606248` (invocação compartilhada, prova 3) | — |
| 13 | Cancelamento | P7.5 10/10 (pedido, recibo situação 1, recusa, concorrência, chave por guia) | PASS | `45004606248` | — |
| 14 | Substituição | substituta só com recibo de cancelamento confirmado; histórico preservado | PASS | `45004606248`; E2E P7.5 (§E2E) | — |
| 15 | Faturamento | recebível na conclusão sem duplicidade (benchmark, 23 rodadas); fórmula `valor − valorPago − valorGlosado` intacta (`financial/queries.ts:580`) | PASS | `44856201932` | — |
| 16 | Glosas | glosa parcial e total, recurso (XML do recurso no XSD), alocação de pagamento | PASS | CI e provas anteriores mantidas | — |
| 17 | Repasses | revisão humana do repasse no cancelamento 23/23 | PASS | `45004606248` | — |
| 18 | Relatórios | relatório por operadora 4/4 (somas contra o livro) | PASS (sintético) | `45004606248`; E2E de relatórios na fase 2 (§E2E) | — |
| 19 | Exportações | CSV com neutralização de fórmula (testes do relatório) | PASS | CI `45004612135` | — |
| 20 | Outbox | prazo de reserva 6/6; invocação compartilhada 6/6 com corte real aos 60 s; benchmark 23 rodadas | PASS | `45004606248`, `44856201932` | handler travado ainda segura o tick em qualquer configuração (visível em `outbox.handler_slow`) |
| 21 | Segurança | SSRF (IP na conexão, DNS trocado, IP literal, **redirecionamento nunca seguido**, novo); credenciais fora de log; XML com DTD recusado; RLS em todas as tabelas do módulo; auditoria de 100% das actions | PASS (técnico) | CI `45004612135` | P15.5 depende de S1–S9 |
| 22 | Integrações | composição #53 + patch toda verde; fusão futura só com conflitos conhecidos; #56 sem conflito na central de ajuda | PASS (composição) | `45003465119` | R61-B só fica PASS quando o #53 aplicar o patch na branch dele |
| 23 | Performance | H.2 7/7 (com o desvio registrado do lote 50) | PASS | `45004606248` | — |
| 24 | R54 | pagamento de R$ 10 conciliado; 0 estornos (3 recusas pelo prazo do Asaas) | PARTIAL | `homologacao-r54-sandbox.md` | janela: segunda, 23/11, a partir das 09h00 |
| 25 | Decisões pendentes | quadro em `decisoes-pendentes.md` | — | — | — |

## P8.4 (itens executados adicionais), novo neste ciclo

| Prova | Resultado | Onde |
| --- | --- | --- |
| Banco + serviço, candidata 0167 depois da cadeia do DEV (14 cenários) | **14/14** | `health-insurance-extra-items-db.ts`, run `45004606248` |
| Política P8.4-r (alternativas a, b, c, d e "sem decisão") | 9/9 | `extra-item-policy.test.ts` |
| Ações (regra de quem confere, validação, mensagens, auditoria) | 5/5 | `extra-item-actions.test.ts` |
| Painel da conferência | 5/5 | `extra-items-ui.test.tsx` |
| E2E | **NOT RUN** | a tabela não existe no DEV, e aplicar a 0167 no DEV exige autorização (D23) |

## E2E no Preview

Fase 1, run `45005774431`, commit `75b23606`. O resultado por grupo está no relatório do ciclo e no plano mestre.

| Grupo | Specs | Resultado |
| --- | --- | --- |
| 0 | configuração (jornada) | a preencher com o run |
| 1 | SP/SADT, fase 1 | a preencher com o run |
| 2 | matriz I.2 e overrides | a preencher com o run |
| 3 | P7.5 | a preencher com o run |
| 4 | autorizações | a preencher com o run |
| 5 | base e lote assíncrono | a preencher com o run |

Fora deste pedido:
- **Estados da guia:** precisa de comando de fixture durante a execução (NOT RUN).
- **Coparticipação no Asaas Sandbox:** precisa de pagamento humano com reCAPTCHA.
- **Agente de IA com convênio:** depende do #28.
