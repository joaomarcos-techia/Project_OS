# Pacote de homologação com operadora real (B5), pronto para executar

**Estado:** BLOCKED. Faltam a operadora, a clínica piloto e o acesso legítimo ao ambiente de homologação.
Nada aqui foi executado contra uma operadora. **O simulador não conta como homologação.** Production TISS
continua NO-GO.

Documentos de detalhe: [`homologacao-operadora.md`](homologacao-operadora.md) (pré-requisitos R1–R8, C1–C10,
perguntas e cenários) e [`conector-soap-homologacao.md`](conector-soap-homologacao.md) (adaptador SOAP).

## 1. O que o fundador e a clínica piloto fornecem

| Item | O que é | Quem |
| --- | --- | --- |
| Operadora | uma com ambiente de homologação TISS **4.03.00**; não inventamos operadora | fundador |
| Clínica piloto | real, com assinatura paga e ativa, credenciada nessa operadora | fundador |
| Responsável | quem fala com a operadora e assina o aceite de cada cenário | fundador ou clínica |
| Contrato | tabela TUSS × valor × vigência, regras de autorização, retorno e coparticipação (R5) | clínica + operadora |
| Manual da operadora | regras próprias além do Padrão TISS (R6) | operadora |
| Endpoint e WSDL | homologação e produção, separados (C1) | operadora |
| SOAP | versão, `SOAPAction`, codificação e se o reenvio é idempotente (C5) | operadora |
| Autenticação | usuário e senha no corpo, certificado cliente (mTLS) ou assinatura XAdES (C3) | operadora |
| Certificado | e-CNPJ ou e-CPF, A1 ou A3, só se exigido (R7, C4). A3 exige outro desenho, a decidir | clínica |
| Dados de teste | carteirinhas e beneficiários **sintéticos** do ambiente de homologação (C9) | operadora |
| Canal de evidência | contato técnico e onde registrar o resultado de cada cenário (C10) | operadora |

## 2. O que o Qoro já garante (provado sem operadora)

- **XML:** 4.03.00 validado no XSD oficial antes de sair, em dois motores (libxml2 e .NET). Também passou
  numa validação independente com a Voa `tiss`: 38/38 no XSD e 37/37 no hash
  (`validacao-independente-voa.md`). Hash do epílogo conferido.
- **Correlação:**
  - um envio por lote e por versão, com chave única no outbox;
  - o lote só vira "enviado" com o protocolo da operadora;
  - o recibo é conferido no XSD e no hash e guardado cifrado.
- **Recuperação:**
  - nunca reenvia sozinho;
  - sem deduplicação do lado da operadora, a segunda tentativa pede conferência no portal;
  - recusa e indisponibilidade nunca viram "enviado";
  - o envio manual registrado (canal, data, autor e comprovante) segue como contingência.
- **Segurança:**
  - credencial cifrada por clínica, decifrada só no envio, nunca em log, tela ou auditoria;
  - destino só IP público, conferido na conexão (H26);
  - limite de 20 s por chamada; circuito por operadora.
- **Registro de produção:** a lista de operadoras homologadas em produção está **vazia**. Nenhuma operadora
  entra nela sem o seu GO (P15.8).
- **Provas:** conector contra o simulador 7/7 (`health-insurance-batch-connector-db.ts`); `tiss-soap.test.ts`.

## 3. Cenários obrigatórios

| # | Cenário | Pré-condição | PASS | Evidência |
| --- | --- | --- | --- | --- |
| H22 | consulta sem efeito (elegibilidade e situação de protocolo) | credencial de homologação cadastrada | resposta válida no XSD, hash conferido, origem igual ao registro ANS | recibos guardados |
| H23 | envio de lote com protocolo real | lote sintético combinado com a operadora, validado no XSD | protocolo real; lote "enviado" pelo canal `connector` e "recebido" com o recibo guardado cifrado | protocolo, recibo e trilha |
| H24 | recusa combinada (ex.: carteirinha inexistente no ambiente de teste) | erro combinado com a operadora | o lote segue exportado; o job termina com "a operadora recusou" e o código; nada vira "enviado" | código da recusa e trilha |
| H25 | indisponibilidade (operadora fora ou lenta) | janela combinada ou endereço de teste lento | sem reenvio automático; o job pede conferência no portal; o envio manual exercitado | trilha `connector_unavailable` e registro manual |
| H26 | destino de rede | endereço da operadora resolvido | conexão só a IP público; endereço interno recusado | teste do conector e log sem segredo |

**PASS da P9.4:** H22 a H25 com evidência real na operadora piloto, nenhuma senha em log, resultado ou recibo,
e a contingência manual exercitada (H25).

**Interromper na hora se houver:**

- recusa de login;
- resposta sem hash conferível;
- protocolo de outro lote;
- qualquer dado real fora do combinado.

## 4. Perguntas à operadora antes do primeiro envio

As 15 perguntas de `homologacao-operadora.md` §3 (versão, canal, `schemaLocation`, XAdES, CNPJ alfanumérico,
numeração, limites do lote, código de validação, retorno, terapias seriadas, indicação clínica, autorização,
demonstrativo, glosa e recurso, coparticipação). Mais duas:

16. A operadora aceita item de guia com valor total zero? A Voa trata como erro; o XSD e o Qoro aceitam.
17. O `valorTotal` do item é conferido como unitário × quantidade × fator de redução/acréscimo? É a regra que o
    Qoro segue.

## 5. Ordem de execução (quando houver B5)

1. Cadastrar a operadora e a credencial **só no ambiente de homologação**. Gravar as respostas às 17 perguntas.
2. Rodar H26, depois H22.
3. Montar um lote sintético combinado e rodar H23.
4. Rodar H24 e H25.
5. Registrar cada execução: data, versão, SHA do Qoro, resultado e evidência, conforme §5 do documento de
   detalhe.
6. Marcar P9.4, P2.5 (C1–C10), P13.6, P15.3 e P15.4 conforme o resultado.
7. Pedir o GO de produção (P15.8). Nada vai para produção por este roteiro.

## 6. Limites

- nenhuma operadora inventada;
- nenhum dado real de paciente;
- nenhuma guia real transmitida;
- nenhum "homologado" com base em simulador ou validador externo.

## Pesquisa pública de operadoras (25/11/2026, noite)

Resumo (detalhe em `QORO-TISS-CONFORMIDADE-REGULATORIA.md`, seção 17):

- Saúde Petrobras (manual público, webservices em 4.01.00) e Saúde Caixa (webservices públicos em 4.02.00): **não
  servem**, o Qoro só emite 4.03.00;
- Unimed Planalto Médio e Copass Saúde: aceitam **só 4.03.00 desde 01/07/2026**; a Copass publica o Coordenador TISS
  e o suplente com contato;
- nenhuma publica ambiente de homologação aberto: todas exigem prestador credenciado; o canal oficial é o
  Coordenador TISS do Portal TISS da operadora (RN 501, art. 16, II).

**Pergunta 18 (nova):** "A operadora aceita a versão 4.03.00 em todas as transações (lote, recurso, demonstrativo,
elegibilidade, cancelamento)?" — várias versões convivem no pacote de set/2026 (04.00.00 a 04.03.00).
