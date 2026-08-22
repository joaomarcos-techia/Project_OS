# Discovery Log

## Status

Canonical — registro de achados durante a execução do [plano qorov2](qorov2.md).

## Para que serve

O §0.8 (Scope Freeze) proíbe absorver requisito novo no meio de uma camada. Achado não some: entra
aqui, com destino explícito (próxima camada ou backlog). Exceção única para entrar na camada corrente:
**bug crítico · vulnerabilidade crítica · risco financeiro crítico** — e ainda assim com registro.

Regra de uso: um achado sai daqui quando é **executado** ou quando o fundador o **descarta** — e a
linha fica, com o desfecho.

## Achados

| # | Data | Achado | Origem | Destino | Status |
| --- | --- | --- | --- | --- | --- |
| D1 | 2026-08-19 | Flag por clínica não existe (`platform_settings` é global). §0.7 e §18 assumem mecanismo inexistente — ver [R1](architecture/risks.md) | Camada -1 | **Decisão antes de 1.2**: aceitar booleano por domínio (ajusta §18) ou ADR de flag por tenant | Aberto |
| D2 | 2026-08-19 | `arch:check` roda sem `--ts-config`: enxerga 5 arestas em vez de 264 — ver [R2](architecture/risks.md) | Camada -1 | Camada 1 (candidato a 1.0) — corrigir o script e reavaliar ciclos | Aberto |
| D3 | 2026-08-19 | `check:registry:strict` já é gate no CI e em `docs/development/testing.md`, mas o portão do §0.2 do `qorov2.md` não o lista | Camada -1 | Resolvido: §0.2 do plano passou a listar `check:registry:strict` | Resolvido |
| D4 | 2026-08-19 | Código cita 43 ADRs; 9 existem no disco após a limpeza documental. 34 referências penduradas | Camada -1 | Backlog — decisão do fundador (reintroduzir os citados ou limpar as citações) | Aberto |
| D5 | 2026-08-19 | Ferramental de §10 (carga) e §14 (simulação) inexistente; `dependency-cruiser` do §11 cortado | Camada -1 | Emenda aprovada: §11 desde 1.0 · §10 a partir de 1.4 · §14 no 1.H | Encaminhado |
| D6 | 2026-08-19 | `qorov2.md` §3 diz "contexts (11)"; são **12** (`feedback` é o 12º) | Camada -1 | Resolvido: §3 do plano corrigido | Resolvido |
| D7 | 2026-08-19 | `qorov2.md` §3 manda entregar em `/docs/arquitetura`; padrão do repo é `docs/architecture/` | Camada -1 | Resolvido: entregue em `docs/architecture/`; ajustar o texto do plano | Resolvido |
| D8 | 2026-08-19 | Runbooks de pagamento (`asaas-webhook-missing.md`, `billing-first-charge.md`) foram removidos na limpeza documental | Camada -1 | Camada 1 — §17 (Docs Vivas) exigirá runbook de pagamento; recriar no escopo da camada | Aberto |
| D9 | 2026-08-19 | `pnpm format:check` (gate local documentado) está vermelho na baseline: **131** arquivos com problema de formatação, todos pré-existentes. O CI não roda `format:check`, por isso passa despercebido | Camada -1 | Backlog — PR de formatação isolado (`prettier --write`), fora de qualquer camada, porque toca 131 arquivos sem gap associado | Aberto |
