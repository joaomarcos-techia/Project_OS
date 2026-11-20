# Homologação com operadora e clínica piloto — roteiro

> Parte do [QORO_TISS_MASTER_PLAN.md](../../QORO_TISS_MASTER_PLAN.md) (P15.3, P15.4; bloqueio **B5**).
> Preparado em 11/11/2026. **Nenhum cenário foi homologado ainda.** A homologação depende de
> terceiros (operadora e clínica piloto) e só é registrada com evidência emitida pela operadora.

## 1. Regras

- **Homologado** só quando a operadora aceitar o arquivo ou a transação no ambiente dela e houver
  prova emitida por ela: protocolo, recibo, demonstrativo ou e-mail formal. Validação nossa ou de
  validador de terceiros (Paniquar, TISS Manager, Validador TISS) **não** é homologação.
- Nenhum resultado é presumido, simulado ou copiado de outra operadora. Cada operadora é homologada
  separadamente.
- Autorização de procedimento só existe se a operadora a conceder. O Qoro nunca registra
  autorização "como se" tivesse sido concedida.
- Dados: no ambiente de homologação da operadora, usar o que ela fornecer (carteirinhas de teste) ou
  pacientes da clínica piloto **com base legal e consentimento** registrados pela clínica. Em
  validadores de terceiros, só o corpus sintético (`data/tiss/corpus/`).
- Produção do Qoro continua intocada: a homologação roda na Preview, com o módulo ligado só para a
  clínica piloto (flag `hi_clinic_settings.enabled`), depois da aprovação do fundador (B8).

## 2. Pré-requisitos (dependências externas)

| # | Item | Quem fornece | Situação |
| --- | --- | --- | --- |
| R1 | Operadora piloto e contato técnico | fundador | pendente (B5) |
| R2 | Clínica piloto credenciada nessa operadora | fundador | pendente (B5) |
| R3 | Código do prestador na operadora, CNPJ ou CPF, CNES ou declaração de que não tem | clínica | pendente |
| R4 | Acesso ao ambiente de homologação (portal ou webservice), usuário e senha | operadora | pendente |
| R5 | Tabela de valores contratados (TUSS × valor × vigência), regras de autorização, retorno e coparticipação | clínica + operadora | pendente |
| R6 | Manual ou orientação de faturamento da operadora (regras próprias além do Padrão TISS) | operadora | pendente |
| R7 | Certificado ICP-Brasil, **se** a operadora exigir assinatura (a ANS classifica como *recomendado*, requisito 30 do Componente de Segurança) | clínica | a confirmar |
| R8 | Orientação jurídica sobre retenção de guias e carteirinhas | jurídico | pendente (B6) |

### 2.1 Conexão com a operadora (P2.5): o que falta para ligar o conector

Pronto no Qoro, sem operadora (14/11):

- credencial por operadora cifrada por clínica, com rotação e revogação; nunca volta à tela, ao log nem à auditoria;
- contrato do conector com resultado tipado (aceito, recusado, indisponível, circuito aberto, não configurado);
- limite de tempo com aborto da requisição;
- nova tentativa só quando o transporte for idempotente;
- circuito por operadora;
- transporte padrão que **recusa sempre**. Sem homologação, nada sai.

Para ligar a primeira operadora, a clínica e a operadora precisam informar:

| # | Informação | Por que o conector precisa |
| --- | --- | --- |
| C1 | Endereço do webservice de **homologação** e de **produção** (e o WSDL de cada um) | O transporte não tem endereço padrão, e nenhum é inventado |
| C2 | Versão TISS de cada ambiente | O XML e o envelope saem da versão declarada |
| C3 | Forma de autenticação: usuário e senha no corpo, certificado cliente (mTLS) ou assinatura XAdES | Define o tipo de credencial (`webservice_login` ou `certificate`) |
| C4 | Tipo de certificado, se houver (e-CNPJ ou e-CPF, A1 ou A3) e quem o guarda | A1 pode ser cifrado no Qoro; A3 exige outro desenho, a decidir |
| C5 | Se o reenvio da mesma mensagem é idempotente do lado da operadora (mesmo protocolo) | Sem isso, nova tentativa automática fica desligada |
| C6 | Tempo de resposta esperado, limite de requisições e janelas de manutenção | Calibra o limite de tempo e o circuito |
| C7 | Códigos de erro e de recusa da operadora | Separa "recusado" (não repetir) de "indisponível" (tentar depois) |
| C8 | Formato do protocolo de recebimento e como consultar a situação do lote | O lote só vira "enviado" com protocolo da operadora |
| C9 | Carteirinhas e beneficiários **sintéticos** do ambiente de homologação | Nenhum documento real é enviado sem piloto e autorização |
| C10 | Contato técnico e canal para registrar a evidência de cada cenário | Seção 5 deste documento |

Até C1–C10 existirem, o estado do conector na tela é "não configurado", e os lotes seguem pelo envio manual
registrado (canal, data, autor e comprovante).

## 3. Perguntas para a operadora (antes do primeiro envio)

Cada resposta vira configuração da operadora (P2.5) ou registro em L.1 do plano. Sem resposta, o
Qoro usa o Padrão TISS puro e a pendência fica registrada.

1. Versão TISS aceita hoje no ambiente de homologação e no de produção (esperado: 4.03.00).
2. Canal de envio do lote: portal (upload) ou webservice SOAP? Endereço e WSDL de homologação.
3. Exige `xsi:schemaLocation` no XML? O XSD e o Componente Organizacional não exigem; um validador
   de mercado exige (defeito B1, G.6).
4. Exige assinatura digital XAdES na mensagem? Se sim, qual certificado (e-CNPJ ou e-CPF)?
5. Aceita CNPJ alfanumérico do prestador (`[A-Z0-9]{12}[0-9]{2}`)?
6. Numeração: o número da guia no prestador precisa ser único por prestador, por lote ou por ano?
   Há faixa reservada?
7. Lote: limite de guias (o padrão permite até 100), periodicidade, prazo de envio após o atendimento.
8. Consulta: usa código de validação (`codValidacao`)? Quando não houver, aceita `ausenciaCodValidacao`?
9. Retorno: janela em dias e se o retorno é pago.
10. SP/SADT de terapias seriadas: uma guia por sessão ou sessões agrupadas sob a mesma autorização?
    Exige equipe por item (`equipeSadt`)? (hipótese a confirmar, P15.4)
11. Indicação clínica: em quais procedimentos é obrigatória? (o Qoro pede ao médico e nunca copia o
    prontuário, D17)
12. Autorização: canal (portal, webservice ou telefone), validade da senha e como informar a
    quantidade autorizada.
13. Demonstrativo de retorno: formato (XML TISS de análise de conta e pagamento, PDF ou planilha) e
    periodicidade.
14. Glosa e recurso: recurso por XML (`recursoGlosa`), portal ou documento? Prazo de recurso.
15. Coparticipação: a clínica cobra do paciente no atendimento ou a operadora desconta depois?

## 4. Cenários de homologação

Os arquivos saem do fluxo real do Qoro (agenda → atendimento → guia → lote), não do corpus. O corpus
continua sendo a prova interna e de validadores (P13).

| ID | Cenário | Pré-condição | Resultado esperado da operadora | Evidência |
| --- | --- | --- | --- | --- |
| H1 | Guia de Consulta simples, PJ com código na operadora, sem CNES | contrato com valor vigente | lote aceito; guia processada | protocolo + demonstrativo |
| H2 | Guia de Consulta com CNES informado | CNES real da clínica | idem | idem |
| H3 | Retorno dentro da janela não pago | contrato com retorno não faturável | Qoro não gera guia (sem envio) | registro interno + confirmação da regra pela operadora |
| H4 | Retorno pago (tipo de consulta 2) | contrato com retorno faturável | guia aceita com tipo 2 | protocolo |
| H5 | SP/SADT de terapia com autorização e senha | autorização concedida pela operadora | guia aceita; quantidade consumida confere | protocolo + demonstrativo |
| H6 | SP/SADT com sessões do mês sob uma autorização | regra de agrupamento confirmada (pergunta 10) | guia aceita conforme a regra | idem |
| H7 | Lote com várias guias de Consulta | 2 ou mais atendimentos | lote aceito, um protocolo | protocolo |
| H8 | Lote com erro conhecido devolvido pela operadora (ex.: carteirinha inexistente no ambiente de teste) | combinado com a operadora | recusa com código da tabela 38 | mensagem de retorno; Qoro mostra a pendência ao responsável |
| H9 | Glosa parcial informada no demonstrativo | demonstrativo de homologação | importação concilia a guia; glosa fica "informada", sem baixa | arquivo do demonstrativo + tela |
| H10 | Recurso de glosa | glosa do H9 | recurso aceito pelo canal da operadora | protocolo do recurso |
| H11 | Pagamento integral e parcial | demonstrativo de pagamento | recebível da operadora conciliado; paciente nunca cobrado pelo valor da operadora | demonstrativo + financeiro |
| H12 | Coparticipação confirmada | regra da pergunta 15 | cobrança ao paciente só do valor confirmado | registro de confirmação |
| H13 | Guia de Consulta impressa (PDF oficial, modelo da p. 469) | guia emitida | operadora aceita o impresso na contingência e na conferência de assinatura | PDF + aceite da operadora |
| H14 | SP/SADT de solicitação impressa (modelo da p. 520) | solicitação registrada | operadora autoriza a partir do impresso; devolve senha e quantidade autorizada | PDF + autorização registrada |
| H15 | Clínica piloto com assinatura paga e ativa (D24) | assinatura liberada pelo #53 | o módulo é ligado pela habilitação controlada; nenhum recurso premium em clínica em trial | estado da assinatura + registro da habilitação |
| H16 | Demonstrativo de análise com glosa por item (tabela 38) | lote em análise | glosa registrada uma vez (reenvio do mesmo demonstrativo não duplica); guia "parcialmente glosada"; pendente correto | demonstrativo + conta da guia |
| H17 | Recurso de glosa (XML `recursoGlosa` ou portal) com justificativa da clínica | glosa contestada | operadora devolve protocolo real; resposta (aceito, parcial, negado) decide cada glosa | protocolo + resposta registrada |
| H18 | Demonstrativo de pagamento (integral, parcial e por lote) | guias em análise | pagamento atribuído às guias certas; parcial não quita; valor sem guia fica "não conciliado"; conciliação por uma pessoa | demonstrativo + conta e conciliação |
| H19 | Demonstrativo XML REAL da operadora importado pelo Qoro (P9.5) | lote enviado com protocolo | o arquivo passa no XSD e no hash; operadora e prestador conferem; glosas e pagamentos aplicados uma vez; o que não confere aparece como divergência (nunca aplicado "por aproximação"); débitos da operadora conferidos por uma pessoa | arquivo da operadora (guardado cifrado) + resultado da importação + auditoria |
| H20 | XML de recurso de glosa gerado pelo Qoro aceito pela operadora (P9.7) | glosa contestada com justificativa da clínica | a operadora aceita o `recursoGlosa` (protocolo real) e responde | XML enviado (SHA-256) + protocolo + resposta |
| H21 | Recebível no financeiro da clínica (0153) igual ao extrato da operadora | 0144–0154 aplicadas no ambiente, guias pagas e glosadas | faturado, recebido e glosa definitiva no Caixa e nos relatórios batem com o demonstrativo; nada cobrado do paciente | conferência do financeiro × demonstrativo |

### 4.0 Envio pelo webservice da operadora (P9.4; só com a B5 decidida)

O conector está pronto e testado contra a operadora simulada (7/7, `health-insurance-batch-connector-db.ts`).
- Estes cenários só rodam no **ambiente de homologação da operadora piloto**, com dados sintéticos combinados com ela e com GO específico.
- Antes deles, preencher a configuração de `conector-soap-homologacao.md` (endereços, SOAPAction, versão SOAP, codificação da senha, deduplicação) a partir do WSDL e do manual da operadora.

| ID | Cenário | Pré-condição | Esperado | Evidência |
| --- | --- | --- | --- | --- |
| H22 | Consulta de elegibilidade e de status de protocolo pelo webservice (sem efeito na operadora) | credencial de homologação cadastrada pela clínica piloto | respostas válidas no XSD, hash conferido, origem igual ao registro ANS | recibos guardados (SHA-256) |
| H23 | Envio de lote de homologação pelo webservice | lote sintético combinado com a operadora, exportado e validado no XSD | protocolo real; lote "enviado" pelo canal `connector` e "recebido" com o recibo guardado cifrado | protocolo, recibo e trilha `sent_via_connector` |
| H24 | Recusa pelo webservice (erro combinado, como carteirinha inexistente no ambiente de teste) | combinado com a operadora | lote segue exportado; o job termina com "a operadora recusou" e o código; nada vira "enviado" | código da recusa e trilha `connector_rejected` |
| H25 | Indisponibilidade (operadora fora ou lenta) | janela combinada ou endereço de teste lento | sem reenvio automático; o job pede conferência no portal; a contingência manual segue valendo | trilha `connector_unavailable` e registro manual |
| H26 | Destino de rede | endereço da operadora resolvido | conexão só a IP público, conferido na conexão; endereço interno recusado | teste do conector e log de conexão sem segredo |

**Critério de PASS da P9.4:** H22 a H25 com evidência real na operadora piloto, nenhuma senha em log, resultado ou recibo, e a contingência manual exercitada (H25).

**Critério de interrupção:** recusa de login, resposta sem hash conferível, protocolo de outro lote ou qualquer dado real fora do combinado. Nesse caso, parar e voltar ao manual.

### 4.1 O que já pode ser testado sem operadora (12/11)

| Item | Onde | Situação |
| --- | --- | --- |
| XML de lote, solicitação SP/SADT e recurso de glosa contra o XSD oficial (dois motores) | corpus `c1`/`c2`, harness de lotes | provado internamente; **não é homologação** |
| PDF oficial da Consulta e da SP/SADT (cobrança e solicitação) contra o modelo da ANS | `tiss/print/print.test.ts`, `scripts/tiss/print/visual-check.ts` | provado internamente (posição dos rótulos, campos, paginação); aceite da operadora pendente (H13, H14) |
| Bloqueio comercial do trial | `health-insurance-premium-gate-db.ts`, cadeia unida com o #53 | provado em Postgres descartável |
| Validador XSD dentro do app (motor, 13 passos da exportação, rota de prontidão no build) | `xsd-engine.test.ts`, harness de lotes, `security:http` | provado internamente; falta a chamada na Preview da Vercel; **não é homologação** |
| Glosas (6 estados), recurso (registro, protocolo, resposta), pagamentos e conta da guia | `health-insurance-glosses-payments-db.ts` (16/16) | regras provadas com dados sintéticos; o comportamento com demonstrativo real é H16–H18 |
| Protocolo, retorno, glosa, recurso e pagamento REAIS | só com operadora e clínica piloto | dependem de credenciais e de demonstrativo real (H8–H11, H16–H18) |

## 5. Registro de cada execução

Uma linha por execução, no Registro (seção M) do plano e em `evidence/tiss-homologacao-<operadora>-<data>/`:

| Campo | Conteúdo |
| --- | --- |
| Cenário | H1…H12 |
| Operadora e ambiente | nome, registro ANS, homologação ou produção |
| Arquivo | nome, SHA-256, hash do epílogo, versão TISS |
| Envio | data e hora, canal, quem enviou |
| Retorno da operadora | protocolo, status, mensagens (códigos da tabela 38) |
| Evidência | caminho dos arquivos de retorno e capturas |
| Divergência | descrição e classificação pela regra da ANS ou da operadora |
| Correção | commit, se houve; nunca edição manual do XML |
| Resultado | aceito / recusado com motivo / pendente |

## 6. Critério para marcar "Homologado" em A.5

- Todos os cenários aplicáveis à operadora executados com evidência.
- Nenhuma recusa sem causa explicada e corrigida no código.
- Respostas da seção 3 registradas como configuração da operadora.
- Aprovação do fundador registrada.

Mesmo homologado, "Pronto para produção" depende ainda dos outros requisitos do plano (A.7 e K),
incluindo a aderência ao Componente de Segurança e Privacidade (P12.8, B10).
