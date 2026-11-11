**Assunto:** Validador TISS online: hash do epílogo calculado em UTF-8 e contagem de guias de Consulta

Olá, equipe do TISS Manager.

Ao testar o validador grátis (`tissmanager.com.br/validador-tiss-online`) com arquivos 100% fictícios do Padrão TISS
4.03.00, encontramos dois comportamentos que parecem divergir da especificação da ANS. Compartilhamos para ajudar.

**1. Hash do epílogo em arquivos com acento**

Arquivos ISO-8859-1 com caracteres acentuados recebem "Hash divergente", mesmo quando o hash confere pela regra do
Componente Organizacional (setembro/2026, seção "HASH MD-5": concatenação dos valores, encoding "sempre o
ISO-8859-1"). O "esperado" exibido pelo validador é reproduzido exatamente quando o arquivo é lido como UTF-8, com os
bytes acentuados virando o caractere de substituição e depois "?", antes do MD5. Em arquivos só com ASCII, os dois
cálculos coincidem.

Exemplo mínimo: um lote de Consulta com o nome do profissional "Conceição Araújo Müller". O hash ISO-8859-1 dos
valores confere com o epílogo, e o validador acusa divergência.

Efeito colateral: um arquivo realmente gravado em UTF-8, com declaração ISO-8859-1, passa sem aviso.

**2. Contagem de guias de Consulta**

Lotes de Consulta sem `numeroGuiaOperadora` aparecem com "Qtd Guias 0" e "O lote não contém nenhuma guia". No
`tissGuiasV4_03_00.xsd`, `ctm_consultaGuia` define `numeroGuiaOperadora` com `minOccurs="0"`. Quando o campo está
presente, a guia é contada.

Podemos enviar os arquivos fictícios de exemplo, se ajudar.

Atenciosamente,
[nome e contato do responsável no Qoro]
