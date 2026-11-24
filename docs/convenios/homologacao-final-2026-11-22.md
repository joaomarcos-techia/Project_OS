# Dossiê de homologação — Convênios TISS (22/11/2026, atualizado em 23/11)

**Escopo:** o que pode ser comprovado em DEV, Preview e Postgres descartável.
- **Não é** homologação com operadora real: nenhuma operadora está homologada (B5).
- **Não é** autorização de produção: produção do TISS continua **NO-GO** e o PR #55 continua draft.

**Regras desta página:**
- cada linha aponta o SHA realmente testado e o run;
- dados 100% sintéticos;
- nenhuma credencial ou identificador.

Nesta página, "simulador" quer dizer a operadora stub (`stub-operator.ts`), com o XSD oficial do webservice. Ela **não** é operadora real.

## Fechamento funcional (23/11/2026)

Baseline `9225f9f2`. SHA final e runs na tabela abaixo. Nenhum código do app mudou neste ciclo: só testes, fixture, workflows, a candidata 0167 (fora do journal) e documentos.

| Frente | Resultado | Evidência | Limitação |
| --- | --- | --- | --- |
| Estados da guia (E2E no Preview) | **13/13** em `cf182fdb` (run `45181012754`); repetido no SHA final pelo pedido HS23-3, com fixture nova HS23B (resultado no corpo do PR #55) | `evidence/tiss-e2e-estados-guia-2026-11-23/` | — |
| R54 | **PARTIAL, bloqueado pelo provedor:** a tentativa única de 23/11 às 09h56 foi recusada ("só pode ser estornada parcialmente no próximo dia"), 4ª recusa igual; estado igual antes e depois | `evidence/tiss-r54-estorno-sandbox-2026-11-23/`; `homologacao-r54-sandbox.md` | pedido ao suporte do Asaas com o fundador |
| P8.4 banco + serviço | **18/18** (14 anteriores + concorrência, registro × conferência nas duas ordens, reprocessamento e reentrega, XML exportado e recebível) | `health-insurance-extra-items-db.ts`, run `45189165431` (`dbf8f5a5`), repetido no SHA final (resultado no corpo do PR #55) | sem a decisão P8.4-r, o item não fatura |
| 0167: ensaio da aplicação | **11/11** com o migrador real (guarda, lock ocupado, locks, aplicação, 2ª execução, reaplicação indevida, compatibilidade, reversão recusada com dados, reversão exata, reaplicação) | `hi-0167-apply-rehearsal.ts`, run `45189165431` (`dbf8f5a5`), repetido no SHA final (resultado no corpo do PR #55) | DEV só com o GO (`go-0167-dev.md`) |
| Provas legadas | **24/24** | run `45189165514` (`dbf8f5a5`), repetido no SHA final (resultado no corpo do PR #55) | — |
| Composição | R61-B aplica limpo no `bc955f4e`; #53 + #56: 9 conflitos (cadastro e plano); + #55: 11 (journal, `acoes.md`, 2 scripts, 7 telas que o #56 repaginou) | `handoff-56-p84-consultorio.md` | 0159 do #53 fora do journal bloqueia a tripla (dono: #53) |

**Defeitos achados e corrigidos (nenhum em produção, nenhum aplicado no DEV):**
1. **Candidata 0167, corrida guia × registro.** A checagem de "guia fechada" lia a etapa sem travar a guia. Em READ COMMITTED, um item podia entrar numa guia sendo conferida. Agora a checagem usa FOR SHARE, no padrão da 0165. A prova 16 testa as duas ordens.
2. **Nota de reversão da 0167 incompleta.** Ela deixava a função `hi_extra_item_guide_closed` para trás. Agora há um arquivo executável que recusa reverter com item registrado; o ensaio prova o catálogo exato.
3. **Prova legada da configuração com data-bomba.** "Hoje + 3 dias" contra a corrida que pode encerrar o contrato em 25/11: entre 23/11 e 27/11, a prova falhava sempre que o "encerrar" vencia. A data agora é fixa no período aberto do reajuste. **O defeito era do teste, não do produto.**

**E2E sem credencial de banco no runner:**
- O spec de estados da guia troca o estado da clínica e do acesso no meio da sessão e lê o banco para provar que as recusas não mudaram nada.
- No runner, isso passa pelo relé `e2e/preview-fixture-relay.mjs`:
  - o pedido vira status do commit, de uma lista fechada;
  - o executor do lado do DEV roda a fixture e responde;
  - ao terminar, o executor restaura a clínica e a conta, mesmo se o runner cair.
- O runner só aceita o relé como comando da fixture.

## Ambientes e SHAs (22/11)

| Ambiente | O que roda | SHA do #55 | Run |
| --- | --- | --- | --- |
| CI (Lint, Typecheck, Test, Build, isolamento, inventário, E2E público) | toda a suíte | `d9bf25b6` | `45004612135` |
| Provas sintéticas (Postgres descartável, código e handlers reais) | 25 harnesses | `d9bf25b6` | `45004606248` |
| Benchmark do outbox (Postgres descartável) | 23 rodadas | `85d37eb9` | `44856201932` |
| Composição #53 + patch R61-B | gates do #53 e provas do outbox | `dbddea9c` (#53 em `bc955f4e`) | `45003465119` |
| E2E no Preview (Auth e banco do DEV, navegador remoto) | 5 pedidos, 10 specs | `75b23606` → `ca199eb4` | `45005774431`, `45036917594`, `45039290730`, `45047483355`, `45048495503` (ver §E2E) |
| Provas legadas (24 harnesses que estavam fora da CI) | Postgres descartável | `4a23bfb0` | `45036917671` |
| Produção, só leitura | agregados do outbox | — | `evidence/tiss-homologacao-final-2026-11-22/r61-producao-leitura.json` |

O SHA final do PR fica registrado no plano mestre. Depois de `d9bf25b6`, os commits mudam só os specs E2E, o runner remoto, a fixture do E2E, as provas legadas e documentos (nenhum código do app). As provas e o CI foram reexecutados sobre eles.

## Resultado por área

| # | Área | Prova e cenário | Resultado | Evidência | Limitação |
| --- | --- | --- | --- | --- | --- |
| 1 | Configuração (módulo, plano, trial, operadora, credencial) | interruptor pela plataforma 6/6; gatilhos do módulo 9/9; classe A e C 4/4; credenciais 6/6; E2E de configuração | PASS (sintético); E2E: §E2E | job sintético `45004606248`; `convenios-config-preview.spec.ts` | trial e plano provados no banco e no serviço; `convenios.available` só como contrato com o #57 |
| 2 | Permissões (matriz I.2) | 0162 12/12; escopo e valores das leituras 6/6; `actions-gate` (regra por evento, falha fechada); E2E I.2 e overrides | PASS (sintético e unitário); E2E: §E2E | `45004606248`, `45004612135` | papéis reais do produto; superadmin só pelo console (#57) |
| 3 | Pacientes | isolamento entre clínicas no CI (`security:tenant`, `security:tenant:convenios`) | PASS | CI `45004612135` | — |
| 4 | Carteirinhas | filtro de posse (D-3), leitura auditada com finalidade, cifra | PASS (prova I.2 e testes) | `45004606248` | sem dado real |
| 5 | Atendimento | estados da cobertura não bloqueiam o atendimento clínico (P5.1) 3/3; série recorrente 4/4 | PASS | `45004606248` | — |
| 6 | Autorizações | consumo uma vez por sessão; série com autorização 4/4; comprovante em partes 4/4; avisos 9/9; manutenção 6/6 e concorrência 6/6 | PASS | `45004606248`; E2E de autorizações (§E2E) | — |
| 7 | Guias | 0147 (numeração, vínculos, sem cobrança dupla, estados, substituição com recibo); SP/SADT 12/12; E2E da Consulta e da SP/SADT | PASS | legado `45036917671`; `45004606248`; E2E HF22; **estados da guia 13/13 em 23/11** (seção acima) | — |
| 8 | TISS 4.03.00 (XML, XSD, 7 operações) | adaptador SOAP 24/24 contra o simulador; conector 8/8; corpus XSD em dois motores | contrato técnico: PASS; simulador XSD: PASS; **recibo externo real: NOT VERIFIED** | CI `45004612135` | operadora simulada não é operadora homologada |
| 9 | Envio | envio pelo conector 7/7 (recibo conferido, nunca reenvia sozinho); teto total de 20 s por envio | PASS (teto "Testado") | `45004606248` | sem operadora real (B5) |
| 10 | Retorno | demonstrativos idempotentes pelo número da operadora; retorno duplicado (P9.5) | PASS | legado `45036917671` | — |
| 11 | Recibos | recibo conferido no XSD e no hash antes de virar protocolo | PASS (simulador) | adaptador SOAP 24/24 | recibo real: NOT VERIFIED |
| 12 | Reprocessamento | retorno reprocessado idempotente; reentrega pelo janitor sem efeito duplicado | PASS | `45004606248` (invocação compartilhada, prova 3) | — |
| 13 | Cancelamento | P7.5 10/10 (pedido, recibo situação 1, recusa, concorrência, chave por guia) | PASS | `45004606248` | — |
| 14 | Substituição | substituta só com recibo de cancelamento confirmado; histórico preservado | PASS | `45004606248`; E2E P7.5 (§E2E) | — |
| 15 | Faturamento | recebível na conclusão sem duplicidade (benchmark, 23 rodadas); fórmula `valor − valorPago − valorGlosado` intacta (`financial/queries.ts:580`) | PASS | `44856201932` | — |
| 16 | Glosas | glosas e pagamentos (0152), recurso com XML no XSD, alocação; E2E da jornada (glosa parcial → recurso → pagamento parcial → estorno) | PASS | legado `45036917671`; E2E HF22-3 | — |
| 17 | Repasses | revisão humana do repasse no cancelamento 23/23 | PASS | `45004606248` | — |
| 18 | Relatórios | relatório por operadora 4/4 (somas contra o livro) | PASS (sintético) | `45004606248`; E2E de relatórios na fase 2 (§E2E) | — |
| 19 | Exportações | CSV com neutralização de fórmula (testes do relatório) | PASS | CI `45004612135` | — |
| 20 | Outbox | prazo de reserva 6/6; invocação compartilhada 6/6 com corte real aos 60 s; benchmark 23 rodadas | PASS | `45004606248`, `44856201932` | handler travado ainda segura o tick em qualquer configuração (visível em `outbox.handler_slow`) |
| 21 | Segurança | SSRF (IP na conexão, DNS trocado, IP literal, **redirecionamento nunca seguido**, novo); credenciais fora de log; XML com DTD recusado; RLS em todas as tabelas do módulo; auditoria de 100% das actions | PASS (técnico) | CI `45004612135` | P15.5 depende de S1–S9 |
| 22 | Integrações | composição #53 + patch toda verde; fusão futura só com conflitos conhecidos; #56 sem conflito na central de ajuda | PASS (composição) | `45003465119` | R61-B só fica PASS quando o #53 aplicar o patch na branch dele |
| 23 | Performance | H.2 7/7 (com o desvio registrado do lote 50) | PASS | `45004606248` | — |
| 24 | R54 | pagamento de R$ 10 conciliado; 0 estornos (4 recusas do Asaas Sandbox; a única de 23/11 foi às 09h56; estado igual antes e depois) | PARTIAL (bloqueado pelo provedor) | `homologacao-r54-sandbox.md`; `evidence/tiss-r54-estorno-sandbox-2026-11-23/` | tentativas paradas; pedido ao suporte do Asaas pronto para o fundador enviar |
| 25 | Decisões pendentes | quadro em `decisoes-pendentes.md` | — | — | — |

## P8.4 (itens executados adicionais), novo neste ciclo

| Prova | Resultado | Onde |
| --- | --- | --- |
| Banco + serviço, candidata 0167 depois da cadeia do DEV (14 cenários) | **14/14** | `health-insurance-extra-items-db.ts`, run `45004606248` |
| Política P8.4-r (alternativas a, b, c, d e "sem decisão") | 9/9 | `extra-item-policy.test.ts` |
| Ações (regra de quem confere, validação, mensagens, auditoria) | 5/5 | `extra-item-actions.test.ts` |
| Painel da conferência | 5/5 | `extra-items-ui.test.tsx` |
| E2E | **NOT RUN** | a tabela não existe no DEV; o pedido de GO da 0167 está em `go-0167-dev.md` (23/11) |

## E2E no Preview (Auth e banco do DEV, navegador remoto)

Cinco pedidos (HF22-1 a HF22-5), um grupo por runner, em série. O resultado de cada spec vem da última execução **completa**:

| Spec | Resultado | Pedido, run e commit |
| --- | --- | --- |
| Jornada de configuração → atendimento → guia → lote → glosa → pagamento → repasse → coparticipação → ficha | **26/26** | HF22-3, `45039290730`, `19109b93` |
| SP/SADT fase 1 (solicitação, indicação clínica, documento, autorização, sessões) | **8/8** (2 testes da fase 2 pulados por desenho do spec) | HF22-1, `45005774431`, `75b23606` |
| SP/SADT fase 2 (guia das sessões, aprovação, lote, XML, protocolo) | **2/2** | HF22-3, `45039290730` |
| Matriz I.2 por papel | **13/13** (12 em HF22-2; o D-5 da recepção com a fase 3 em HF22-3) | `45036917594`, `45039290730` |
| Matriz I.2: overrides por pessoa | **3/3** | HF22-1 |
| P7.5: cancelamento e substituição | **5/5** | HF22-1 |
| Autorizações | **5/5** | HF22-1 |
| Relatórios por operadora e CSV | **5/5** | HF22-2 |
| Lote grande assíncrono | **2/2** | HF22-2 |
| Base (anônimo, papéis, Consulta → emissão → PDF, trial, solicitação SP/SADT, celular) | **12/12** (11 em HF22-4; o último, que parou no login pelo limite por IP, em HF22-5) | `45047483355` e `45048495503`, commits `92151417` e `ca199eb4` |

**O que o E2E encontrou (nenhum defeito de produto):**
- **Expectativas de papel anteriores à matriz I.2**, aprovada em 16/11, que a P1.12-b não atualizou nos specs: a médica "não entrava" e a recepção "não conferia nem registrava solicitação". Foram 5 pontos em 2 specs, alinhados ao seed da 0162, sem afrouxar o que continua fechado (faturamento, PDF completo e preços).
- **Fixture que reaproveitava guias** já exportadas por outros specs: o `setup` ganhou `--run`.
- **Limite de logins por IP** quando dois specs da I.2 dividiram o runner: a I.2 passou a rodar sozinha.
- **Dois erros meus no pedido:** a variável `E2E_HI_FIXTURE` da jornada e a fase da D-5.

**Fora do E2E deste ciclo:**
- **Estados da guia:** executado em 23/11, 13/13, pelo relé da fixture (seção de 23/11).
- **Coparticipação no Asaas Sandbox:** precisa de pagamento humano com reCAPTCHA.
- **Agente de IA com convênio:** depende do #28.
- **P8.4:** a tabela candidata não existe no DEV.

## Provas legadas (estavam fora de qualquer workflow)

24 harnesses escritos até 14/11 rodavam só no notebook. Agora rodam no runner a cada push relevante (`convenios-synthetic-db-legacy.yml`). **24/24 verdes** no run `45036917671` (commit `4a23bfb0`).
- Cobrem: guias (0147), emissão, serviço da Consulta, lotes (0150), lote assíncrono, glosas e pagamentos (0152), ponte com o livro (0153), demonstrativos (P9.5), recurso de glosa, concorrência (P14.2), autorizações (P6.1), cobertura (0148), coparticipação, credenciamento (P2.2), bloqueio comercial (0151), configuração (0144) e por operadora, importação de contratos, dados da Consulta (0161), troca de modalidade, leituras das telas, cadeia unida e R38.
- Quatro estavam desatualizadas em relação às guardas que vieram depois (0164 e 0165) e à 0159; foram corrigidas sem afrouxar nenhuma asserção. A prova das guias ganhou a asserção de que a substituta **sem** recibo é recusada.
