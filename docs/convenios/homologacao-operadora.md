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
