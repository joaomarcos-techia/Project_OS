# Evidências — ciclo de 12/11/2026 (P9.2, 0152, P12.7, seções 7 e 8)

Tudo em ambiente isolado: Postgres 17 descartável por harness, build isolado sem credenciais, dados sintéticos.
Nada foi aplicado no DEV nem em produção; nenhum bucket foi criado.

## Harnesses (Postgres descartável, migrations reais 0000–0152)

| Arquivo | Resultado | O que prova |
| --- | --- | --- |
| `harness-premium-gate.log` | 10/10 | D24 + carência limitada (`period_expired`; `past_due` dentro e fora do `grace_period_until`; cancelada no fim do período; assinatura antiga sem período) |
| `harness-union-chain.log` | 9/9 | cadeia main + #53 `9ddc432a` + #55 (153 migrations); decisão do banco = decisão do código real do #53 em 8 estados |
| `harness-batches.log` | 16/16 | ciclo de lotes; os 13 passos da exportação com falhas injetadas nos passos 2, 5, 7 e 9; P12.7 (download auditado, ausente, adulterado, órfão, descarte) |
| `harness-glosses-payments.log` | 16/16 | 0152: glosa parcial e integral, recurso, revertida, definitiva, pagamento parcial, integral, duplicado, retorno duplicado, pagamento após recurso, guia substituída, lote cancelado, falha transacional, concorrência, reprocessamento, acesso entre clínicas, D24 (preservação), sem lançamento no livro financeiro |
| `harness-billing-reconcile.log` | 19/19 | regressão P7.4 com a 0152 |
| `harness-clinic.log`, `harness-coverage.log`, `harness-guide-issuance.log`, `harness-guide-service.log`, `harness-guides.log` | 29, 13, 7, 9, 24 | regressões com a troca da `hi_guide_transition` (0152) |

## Validador XSD no build real

- `build-isolado.log`: `next build` da cópia isolada (sem `.env`, variáveis sintéticas do `local-build`), "Compiled
  successfully"; a rota `ƒ /api/health/tiss-xsd` está no build. Localmente foi preciso `--use-system-ca` (a rede da
  máquina intercepta TLS ao baixar as fontes do Google) e o heap de 4 GB que o CI já usa.
- `build-isolado-tiss-xsd.json`: o `security:http` contra o `next start` desse build — sem credencial 401; com o Bearer
  de monitoramento 200, `xmllint-wasm@5.3.0`, conjunto de XSD `928fa2ca…`, válido aceito (687 ms), inválido recusado
  pelo XSD, hostil (DTD/XXE) recusado antes do parser; e os 11 arquivos que o rastreamento da função inclui (worker,
  `.wasm`, `package.json` do pacote, 7 XSD e o MANIFEST), que é o que a Vercel empacota.
- **Pendente:** chamar a mesma rota na Preview da Vercel (exige a credencial de monitoramento da Preview).

## Dependência

- `dependencia-xmllint-wasm.diff`: `package.json` (+1) e `pnpm-lock.yaml` (+13), gerados numa cópia isolada; o
  `pnpm add` sozinho também deduplicava `caniuse-lite`, `picomatch` e `minimatch` (descartado, para não mexer em
  resolução alheia nem conflitar com o #53). `pnpm install --frozen-lockfile` e a checagem de supply chain passaram.

## Suíte e gates

Resultado da suíte completa com cobertura e dos gates no relatório do ciclo (`QORO_TISS_MASTER_PLAN.md`, registro de
12/11) e no CI do commit.
