# Conector SOAP TISS 4.03.00: o que falta para homologar uma operadora

Estado em 19/11/2026: **Testado** (P6.5). O adaptador (`src/contexts/health-insurance/internal/connectors/tiss-soap/`) fala as 7 operações do webservice da ANS e foi testado contra uma operadora stub. O stub valida o envelope no XSD oficial (`tissWebServicesV4_03_00.xsd`). **Nenhuma operadora está homologada.** O registro de produção (`NO_HOMOLOGATED_OPERATORS`) está vazio, e um teste garante isso. Por isso tudo segue pelo caminho manual.

## O que cada operadora precisa fornecer (B5)

Nada disto está no código, e nada pode ser presumido. Vem do WSDL e do manual da operadora, conferido na homologação.

| Configuração (`TissSoapConfig`) | De onde vem | Observação |
| --- | --- | --- |
| `registroANS` | cadastro da operadora | Destino dos pedidos. Toda resposta tem de vir com esta origem, senão é recusada. |
| `endpoints` por operação | WSDL de cada serviço (`tissLoteGuias`, `tissSolicitacaoProcedimento`, `tissVerificaElegibilidade`, etc.) | Só HTTPS, sem usuário ou senha na URL. Operação sem endereço segue manual. |
| `soapActions` por operação | WSDL | Sem valor, vai vazio (`""`). |
| `soapVersion` | WSDL (`soap:binding` 1.1 ou `soap12:binding`) | Define o `Content-Type` e o namespace do envelope. |
| `passwordEncoding` | manual da operadora | `md5_hex` ou `plain`. Não há regra oficial confirmada; não presumir. |
| `deduplicatesSubmissions` | manual ou contato técnico | Só com `true` um lote, uma solicitação ou um recurso é repetido depois de falha. Sem isso, falha em envio volta ao manual com aviso para conferir no portal antes de reenviar. |
| credencial (login e senha do webservice) | a clínica, na tela de credenciais | Guardada cifrada (P2.5). Decifrada só em `tiss-soap/credential.ts`, na hora do envio. |

## Roteiro da homologação (quando houver operadora e clínica piloto)

1. Obter o WSDL e o ambiente de homologação da operadora. Montar a configuração acima, sem produção.
2. Rodar, contra o ambiente de homologação, uma consulta de cada tipo (elegibilidade, status de protocolo), sem efeito na operadora.
3. Enviar um lote de teste combinado com a operadora. Conferir o protocolo devolvido, o recibo validado no XSD e o hash.
4. Registrar a evidência (recibos, sem dado de paciente fora do armazenamento cifrado) e só então incluir a operadora no registro de homologados, com aprovação do fundador (P15.8).

## O que o adaptador garante hoje (provas)

- **Antes da rede:** não envia mensagem de outra operadora, de outra transação ou com login fora do tamanho do padrão. Também não envia nada que não passe no XSD do webservice (`tiss-soap.test.ts`).
- **Na resposta:** só é aceita depois de passar no XSD, ter o hash conferido, vir com origem igual ao registro ANS e, em lote ou recurso, trazer o mesmo número de lote. Qualquer outra resposta vira `invalid_response`, sem estado falso. DTD e entidade são recusados pelo leitor estrito.
- **`tissFault`:** `LoginInvalido`, `HashInvalido`, `SchemaInvalido`, `VersaoInvalida`, `DestinatarioInvalido` e `RemetenteInvalido` viram recusa com explicação. `ErroInesperadoServidor` vira indisponível, e a porta volta ao manual.
- **Tempo, retentativa e circuito** por operadora seguem o contrato da P2.5. Consultas repetem; envios repetem só com deduplicação declarada.
- **A senha** não aparece em resultado, recusa, erro nem recibo. Com `md5_hex`, a senha em claro não trafega.
- **Credencial:** a leitura para envio devolve só a credencial ativa de login. Ela marca o uso, é isolada por clínica (RLS) e não devolve nada depois de revogada. Prova em Postgres 17: `health-insurance-insurer-credentials-db.ts`, 6/6, no job sintético.
