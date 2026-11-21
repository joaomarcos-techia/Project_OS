# Divergências do TISS Manager (validador B), execução de 10/11/2026

Corpus `tiss-4.03.00-c1`, dados 100% sintéticos. Padrão TISS **4.03.00** (Comunicação), Componente Organizacional
**202609**. SHA-256 de cada arquivo conferido contra o `MANIFEST.json` antes da submissão
(`tissmanager/results.json`). A referência para classificar divergência é o XSD oficial e o texto da ANS. **Nenhuma
divergência motivou mudança no gerador do Qoro**: alterar o gerador para agradar o validador contrariaria a regra
oficial.

Ferramentas de comparação:
- **XSD oficial:** `xmllint-wasm` 5.3.0 com os XSDs do pacote ANS (`XSD_RESULTS.json`).
- **Interno:** regras, verificação do hash a partir do texto e checagem de codificação (`corpus.test.ts`).
- **A:** Paniquar (`paniquar/results.json`).
- **B:** TISS Manager, validador grátis (`tissmanager/results.json`).

---

## B3 — hash do epílogo recalculado lendo ISO-8859-1 como UTF-8

| Campo | Valor |
| --- | --- |
| Arquivos | 12 com o aviso; representativo: `V18-consulta-acentos-latin1.xml` |
| SHA-256 (V18) | `60588ec774e160d1b48b1ece76470b1dea0be871a1f1275f7ac9d2b093dd9d8b` |
| Esperado | válido; hash do epílogo confere |
| XSD oficial | válido |
| Interno | hash confere (`verifyEpilogueHash`); codificação coerente |
| A (Paniquar) | válido; "HASH Confere ✓" |
| B (TISS Manager) | "Hash divergente. Informado `836fdab1…`. Esperado (recalculado conforme regra da ANS): `5036cc73…`" |
| Explicação | A regra da ANS (Componente Organizacional 202609, p. 49) diz que o hash usa "sempre o ISO-8859-1". O valor "esperado" pelo B sai de outra conta: o arquivo é lido como UTF-8, os bytes acentuados (inválidos em UTF-8) viram U+FFFD, gravado como "?", e só então se calcula o MD5. Em arquivo só com ASCII as duas contas coincidem, por isso o V1a passa. |
| Reprodução independente | `reproduce-tissmanager-hash.mjs` → `reproduce-tissmanager-hash.out.txt`: **12/12** "esperados" do B reproduzidos exatamente pela leitura UTF-8; nos 11 arquivos corretos, o hash ANS calculado de novo confere com o declarado |
| Consequência | o B acusa erro em arquivo correto e **não** acusa o arquivo de fato errado (`M17`, gravado em UTF-8 com declaração ISO-8859-1, SHA `52e4265c…`), que o A, o XSD e o interno pegam pelo hash ou pela codificação |
| Classificação | defeito do validador B; o Qoro segue a ANS |

## B2 — "lote não contém nenhuma guia" em Consulta sem `numeroGuiaOperadora`

| Campo | Valor |
| --- | --- |
| Arquivos | todos os de Consulta sem `numeroGuiaOperadora`; representativo: `V1a-consulta-pj-codigo-operadora.xml` |
| SHA-256 (V1a) | `383c483bd08fb3cefca0c0557f0e02d6a25aaadb23e61bdba23bd88ce2c0870d` |
| Contraprova | `V1e-consulta-opcionais-valor-maximo.xml` (`990150d9…`), que tem `numeroGuiaOperadora`: o B conta "1 (Consulta)" |
| Esperado | 1 guia de Consulta |
| XSD oficial / Interno / A | válido / sem pendência / "GUIAS 1 (Consulta)" |
| B | "Qtd Guias 0", "Limite mínimo de guias no lote. O lote não contém nenhuma guia." |
| Explicação | no `ctm_consultaGuia` do XSD 4.03.00, `numeroGuiaOperadora` é `minOccurs="0"` (`tissGuiasV4_03_00.xsd`, linha 369). O contador do B depende desse campo opcional. |
| Classificação | defeito do validador B |

## B1 — exige `xsi:schemaLocation`

| Campo | Valor |
| --- | --- |
| Arquivos | todos os 37 com resultado |
| Esperado | sem exigência: o XSD não declara o atributo como obrigatório e o Componente Organizacional 202609 não o cita |
| XSD oficial / A | válido / sem apontamento |
| B | "Atributo xsi:schemaLocation ausente. A mensagem TISS deve referenciar o XSD oficial da versão declarada." |
| Classificação | regra própria do B, sem base oficial encontrada. **Confirmar com a operadora piloto** (pergunta 3 do roteiro de homologação); o gerador só muda se a operadora exigir |

## Checagem de TUSS que não confere o código

| Campo | Valor |
| --- | --- |
| Arquivos | `N10-consulta-tuss-inexistente.xml` (`3b5b4048…`, código `99999999`); `N11-consulta-tuss-fora-de-vigencia.xml` (`14bb12de…`, `50000802` vigente até 31/12/2026, atendimento em 05/01/2027) |
| Esperado | inválido pelas regras (TUSS inexistente; TUSS fora de vigência) |
| XSD oficial | válido (o XSD aceita texto no código) |
| Interno | `PROCEDURE_CODE_UNKNOWN` / `PROCEDURE_CODE_NOT_EFFECTIVE` |
| A | aceita (no N11, só aviso de data futura) |
| B | "1 código(s) vigente(s) na data da guia" nos dois |
| Classificação | a verificação TUSS do B não é confiável; só a camada interna cobre |

## DV do CNPJ não conferido

| Campo | Valor |
| --- | --- |
| Arquivo | `N-consulta-cnpj-digito-errado.xml` (`8c18db13…`, `12ABC34501DE36`) |
| Esperado | inválido (DV errado) |
| XSD / Interno / A / B | válido / `CONTRACTOR_CNPJ` / aceita / "Todos os CPFs e CNS … válidos" (não cita CNPJ) |
| Classificação | limite do B, embora ele declare conferir CNPJ; só a camada interna cobre |

## M21 sem resultado

| Campo | Valor |
| --- | --- |
| Arquivo | `M21-consulta-truncado.xml` (`3d44fcf6…`) |
| Esperado | inválido (XML truncado) |
| XSD / Interno / A | inválido / hash não confere / "5 erros encontrados" (XML mal formado) |
| B | a tela de resultado não apareceu em 60 s; **sem veredito** (não registrado como aprovação nem recusa) |

---

## Comunicação ao fornecedor

Rascunho em `COMUNICADO-TISS-MANAGER.md`. Não foi enviado: o envio é ação externa e fica com o fundador. O texto não
contém dado real, credencial nem informação interna do Qoro além do necessário para reproduzir.
