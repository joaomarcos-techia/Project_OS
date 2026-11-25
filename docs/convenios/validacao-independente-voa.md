# Validação independente dos XMLs TISS 4.03.00 com a Voa `tiss` (25/11/2026)

**O que é:** o corpus sintético de XMLs que o Qoro gera e mantém (`data/tiss/corpus/4.03.00/c1`) passou pela
biblioteca aberta da Voa Health. É uma terceira opinião sobre os mesmos 38 arquivos que já validamos com
dois motores XSD.

**O que não é:** não é homologação com operadora. **A B5 continua pendente** até existir um protocolo
genuíno devolvido por uma operadora real. Nenhum dado real foi usado e nada foi enviado a serviço externo.
Production TISS continua **NO-GO**.

## Ferramenta e procedência

| Item | Valor |
| --- | --- |
| Biblioteca | `tiss` 0.5.0 (PyPI, publicada em 28/10/2026), Apache-2.0, repositório `github.com/Voa-Health/tiss` |
| Wheel | `tiss-0.5.0-py3-none-any.whl`, sha256 `e0cad0c364a81ee11edcc185f995500f9b598c597fee386caa0c0e7e1dc66ec9` (conferido no download) |
| Dependências | `lxml` 6.1.3 (libxml2 2.11.9 no Windows local) e `google-re2` 1.1.20251105 |
| Modo | só a biblioteca local (`tiss.validate`); playground, API HTTP e MCP remotos **não** foram usados |
| Rede | bloqueada no processo (socket) antes de importar a biblioteca; nenhuma tentativa de conexão. Os módulos que acessam rede (`rede`, `referencia`, `server/*`) não são importados por `validate` (conferido no código) |
| Reprodução | `scripts/tiss/corpus/validate-voa.py` (grava `VOA_RESULTS.json`; `--check` compara com o gravado) e o workflow `convenios-voa-tiss.yml` (Python 3.12, pacote fixado pelo sha256) |

## Resultado nos 38 arquivos

Os 38 arquivos são 13 válidos e 25 inválidos, por XSD, regras, hash do epílogo ou codificação. O 39º cenário
do manifesto (`B-consulta-nome-fora-do-latin1`) não tem arquivo por desenho: o montador recusa antes de gerar
o XML.

| Camada | Resultado |
| --- | --- |
| XSD 4.03.00 | **38/38 iguais** aos dois motores atuais (xmllint-wasm/libxml2 e System.Xml.Schema/.NET). O XML truncado (M21) a Voa recusa como malformado, antes do XSD |
| Esquemas | os 7 XSD 4.03.00 embutidos na biblioteca são **byte a byte iguais** aos do Qoro (sha256 por arquivo no `VOA_RESULTS.json`) |
| Hash do epílogo | **37/37 iguais** (implementação independente da nossa): detecta o hash adulterado (M20) e o UTF-8 declarado como ISO (M17); o truncado não chega ao hash |
| Válidos aceitos | 12 de 13 |
| Inválidos recusados | 15 de 25: todos os que o XSD, o hash ou a codificação recusam |
| Falso positivo | 1 arquivo, `V2c-sadt-itens-variados`, com dois achados (abaixo) |
| Não detectados | 10 arquivos, todos de regras de negócio do Qoro que a validação base da Voa não implementa (abaixo) |

### Divergências investigadas

| Arquivo | Achado da Voa | Diagnóstico | Classificação |
| --- | --- | --- | --- |
| V2c, linha 2 | `item.valor_divergente`: "valorTotal 69.99 diverge de valorUnitario × quantidade" | a linha tem `reducaoAcrescimo` 0,70: 3 × 33,33 × 0,70 = 69,993 → 69,99. A regra de `validate()` compara só unitário × quantidade, mas o próprio `line_total` da biblioteca calcula unitário × quantidade × fator | **defeito da Voa 0.5.0** (falso positivo em toda linha com fator diferente de 1). O XML do Qoro está correto |
| V2c, linha 3 | `item.valor_zerado`: item com `valorTotal` 0,00 | o XSD aceita 0,00, e o validador interno do Qoro também | **regra mais restritiva da Voa**, não do padrão. Vale perguntar à operadora piloto se ela aceita item com valor zero (B5) |

**Não detectados pela Voa** (a validação base não tem estas regras; algumas dependem de tabelas ou do pacote de
regras de uma operadora):

| Arquivo | Regra do Qoro |
| --- | --- |
| N16b | valor negativo (o XSD aceita) |
| N10, N11 | TUSS inexistente e TUSS fora de vigência |
| N15a, N15b | atendimento no futuro; senha que vence antes da autorização |
| N-sadt-terapia-sem-indicacao-clinica | indicação clínica exigida para terapias |
| N24 | lote 4.02.00: a Voa aceita a 4.02.00 por desenho; o Qoro só emite 4.03.00 |
| N-consulta-operadora-diferente-do-destino | operadora da guia diferente do destino do lote |
| N-consulta-cnpj-digito-errado, N-consulta-cpf-digito-errado | dígito verificador de CNPJ e CPF |

Nenhum desses é defeito do Qoro: nos 10, o validador interno recusa como esperado, com o código previsto no
manifesto.

## Independência dos motores (o que a Voa acrescenta e o que não acrescenta)

- **XSD:** a Voa usa `lxml`, que é **libxml2**, a mesma família do nosso xmllint-wasm (libxml2 compilado para
  WebAssembly). No XSD ela **não** é um motor independente. A independência de motor no XSD continua sendo o
  .NET (`System.Xml.Schema`). A concordância 38/38 confirma que o conjunto de esquemas é o mesmo.
- **Hash do epílogo:** implementação independente da nossa. Concordância de 37/37.
- **Regras:** implementação independente, com cobertura diferente. A Voa achou o que o Qoro não confere
  (valor zero) e não confere várias regras que o Qoro tem.

## B7: a Voa substitui o Validador TISS para Windows?

**Ainda não, e a B7 não vira PASS.** O critério da P13.5 nomeia uma terceira camada externa (o programa
Windows), cuja instalação na máquina principal não está autorizada. A Voa:

- não substitui a independência de **motor** no XSD (é libxml2);
- é uma camada **externa e independente** de hash e de regras, rodável em CI, sem telemetria e sem dado real;
- tem um defeito conhecido (fator de redução/acréscimo) que precisa de correção ou de exceção registrada
  antes de servir de portão.

**E o próprio programa Windows, em ambiente isolado?** Tecnicamente um runner Windows efêmero do GitHub, ou uma
VM, serviria, só com o corpus sintético. O impedimento não é técnico: a licença gratuita do programa veda uso
comercial, e ele tem telemetria do aparelho e dos arquivos (registrado em 11/11, P13.5). Rodá-lo para validar o
produto exige licença comercial ou autorização do fornecedor, e isso é despesa que precisa da sua aprovação. Não
foi executado.

**Proposta para a sua decisão:** trocar o critério da P13.5 de "o programa Windows" para "camada C =
Voa `tiss` fixada por versão e sha256 (hash e regras) + .NET (XSD)". O CI rodaria o corpus a cada mudança,
com o falso positivo do fator registrado como exceção até a correção pela Voa. Até a sua aprovação:

- P13.5 continua **BLOCKED (B7)**;
- P13.6 ganha a classificação das divergências da camada Voa (esta página).

**Correção a montante (precisa do seu OK, porque é comunicação externa):** o texto abaixo está pronto para uma
issue no repositório da Voa. Não abri a issue.

> **Título:** `validate()` ignora `reducaoAcrescimo` em `item.valor_divergente` (falso positivo)
>
> Em `tiss` 0.5.0, a regra `item.valor_divergente` de `_validate.py` compara `valorUnitario × quantidadeExecutada`
> com `valorTotal`, sem o fator `reducaoAcrescimo`. Um item SP/SADT com `quantidadeExecutada` 3,
> `valorUnitario` 33,33, `reducaoAcrescimo` 0,70 e `valorTotal` 69,99 (3 × 33,33 × 0,70 = 69,993) é recusado
> como divergente. O próprio `line_total` da biblioteca calcula `unitário × quantidade × fator`. Sugestão:
> usar o fator, com 1 quando ausente, na conferência do `validate()`. Caso 100% sintético, sem dado de paciente.

## Reavaliação da B7 (25/11/2026, noite)

- **O que a norma exige:** compatibilidade com os arquivos oficiais (Componente Organizacional 202609, item 142). A ANS
  não publica nem nomeia validador. A exigência do programa Windows é do plano (P13.5), não da norma.
- **Política composta proposta:** A (libxml2) + B (.NET, motor independente) + C (Voa: hash e regras independentes,
  XSD não) + D (validadores do Qoro). Cobre a compatibilidade com o padrão em dois motores independentes e uma terceira
  opinião externa de hash e regras. Limite: não há terceiro motor XSD independente.
- **Reprodução mínima do falso positivo:** `scripts/tiss/corpus/voa-repro-reducao-acrescimo.py`, offline, só o
  corpus sintético; roda no workflow `convenios-voa-tiss.yml` e acusa "CORRIGIDO" quando a Voa consertar. Em 25/11 a
  versão no PyPI continua 0.5.0 (sem correção).
- **Issue:** texto pronto acima; **não publicada** (comunicação pública em nome do Qoro; a autorização foi para
  preparar e reproduzir).
- **B7 VALIDATION: PARTIAL** até o aceite da troca do critério da P13.5 (ou a licença comercial do programa Windows).
