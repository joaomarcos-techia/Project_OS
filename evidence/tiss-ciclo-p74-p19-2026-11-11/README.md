# Evidências — 3º ciclo de 11/11/2026 (P7.4, P1.9, XMLs)

Logs dos harnesses rodados no commit indicado na primeira linha de cada arquivo, **todos em Postgres 17 descartável**
com as migrations reais (nenhum toca DEV ou produção; nenhum ensaio de DDL no DEV, D23). UUIDs trocados por `<uuid>`;
nenhum dado real, só sintéticos. Cada log guarda as linhas `PASS`/`OK` e eventuais erros.

| Log | O que prova | Esperado |
| --- | --- | --- |
| `health-insurance-billing-reconcile-db.log` | P7.4 (0149): convênio sem guia, reconcile, correção administrativa, os 14 cenários pedidos | 19/19 |
| `health-insurance-batches-db.log` | P1.9/P9.3 (0150): lotes, XSD oficial (xmllint-wasm), arquivo cifrado, estados, falhas, concorrência | 13/13 |
| `health-insurance-union-chain-db.log` | cadeia unida `main` + #53 0136–0142 + #55 0143–0150, na ordem do DEV, com os gatilhos de trial do #53 | 6/6 |
| `health-insurance-coverage-db.log` | regressão da 0148 ponta a ponta (particular x convênio) depois da P7.4 | 13/13 |
| `health-insurance-guides-db.log` | regressão da 0147 depois da 0150 (troca de CHECKs de `hi_files`) | 24/24 |
| `health-insurance-guide-service-db.log` | regressão do serviço da Guia de Consulta depois da refatoração da derivação | 9/9 |
| `health-insurance-guide-issuance-db.log` | regressão da emissão com snapshot cifrado | 6/6 |

Corpus `c2` (solicitação SP/SADT e recurso de glosa): `data/tiss/corpus/4.03.00/c2/` — XMLs, `MANIFEST.json` (SHA-256),
`XSD_RESULTS.json` (libxml2 via xmllint-wasm) e `XSD_RESULTS_DOTNET.json` (System.Xml.Schema em modo estrito): 14/14 nos
dois.

Reproduzir (na raiz do worktree):

```bash
NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/<harness>.ts
# lotes e corpus c2 precisam do xmllint-wasm avaliado na P0.8:
TISS_XMLLINT_WASM_DIR=<pasta com node_modules/xmllint-wasm> NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-batches-db.ts
npx tsx scripts/tiss/corpus/generate-c2.ts
TISS_CORPUS=c2 TISS_XMLLINT_WASM_DIR=<...> npx tsx scripts/tiss/corpus/validate-xsd.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/tiss/corpus/validate-xsd-dotnet.ps1 -CorpusName c2
```
