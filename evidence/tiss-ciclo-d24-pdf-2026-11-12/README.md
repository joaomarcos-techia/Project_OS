# Evidências — ciclo de 12/11/2026 (D24: bloqueio comercial do trial; R33)

Logs dos harnesses rodados sobre a árvore de trabalho do commit deste ciclo (base `6b101e89`), **todos em Postgres 17
descartável** com as migrations reais (nenhum toca DEV ou produção; nenhum ensaio de DDL no DEV, D23). UUIDs trocados
por `<uuid>`; só dados sintéticos. Cada log guarda as linhas `PASS`/`OK`.

| Log | O que prova | Esperado |
| --- | --- | --- |
| `health-insurance-premium-gate-db.log` | D24 (0151): trial 1º e 14º dia, expirado, sem assinatura, pendente, cancelada, vencida, graça do dunning, plano sem o recurso, API direta, worker, reprocesso, recuperação, trial → paga, módulo desligado, isolamento | 9/9 |
| `health-insurance-union-chain-db.log` | main + #53 `e8309aee` 0136–0142 + #55 0143–0151 na ordem do DEV: política de trial real do #53, gatilhos do #53 (Asaas, WhatsApp), R33 resolvido, liberação por fatura paga | 8/8 |
| `health-insurance-batches-db.log` | P1.9 (0150) + assinatura cancelada (fatos da operadora entram, operação nova não), XSD oficial | 14/14 |
| `health-insurance-billing-reconcile-db.log` | P7.4 (0149) com a clínica paga | 19/19 |
| `health-insurance-clinic-db.log`, `-coverage-`, `-guide-issuance-`, `-guide-service-`, `-guides-` | regressões 0144–0148 | 29, 13, 6, 9, 24 |

Reproduzir (na raiz do worktree):

```bash
NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-premium-gate-db.ts
NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-union-chain-db.ts e8309aee
TISS_XMLLINT_WASM_DIR=<pasta com node_modules/xmllint-wasm> NODE_OPTIONS=--conditions=react-server npx tsx scripts/security/health-insurance-batches-db.ts
```
