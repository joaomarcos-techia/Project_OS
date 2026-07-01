# Definition of Done

> **Status:** Ativo · **Owner:** João Marcos (Qoro) · **Última revisão:** 2026-07-01 · **Próxima revisão:** 2027-01-01
>
> ↩︎ Volta para o [índice mestre](../README.md).

Uma mudança só está **pronta** quando todos os itens abaixo aplicáveis estão satisfeitos. Não é burocracia — é o mínimo para uma pessoa solo operar em produção sem se ferrar às 2h da manhã. Marque no PR o que se aplica; itens não aplicáveis marque como `N/A` com 1 palavra de justificativa.

---

## 1. Código

- [ ] Passa em **todos os gates locais** (= os do CI): `typecheck`, `lint`, `arch:check`, `arch:db-check`, `check:migrations`, `check:registry:strict`, `test`, `build`. Ver [git-workflow.md](./git-workflow.md).
- [ ] Respeita a **matriz de imports** e os anti-padrões do [CONVENTIONS.md](../CONVENTIONS.md) (sem `console.log`, sem `dbAdmin` fora do allowlist, sem JOIN cross-context, sem forjar claims).
- [ ] Sem TODO órfão (sem data/contexto). Se é premissa de camada futura: `TODO[Cn]: ...`.
- [ ] Revisado (auto-revisão honesta no mínimo; segundo par quando houver time).

## 2. Testes

- [ ] Unit co-localizado (`foo.ts` + `foo.test.ts`) cobrindo o caminho novo e o de erro.
- [ ] Se toca camada com smoke (`smoke:cN`): smoke verde, **com a saída colada no PR**.
- [ ] Integration que envolve DB **não mocka DB** (roda contra `qoro-dev`) — [CONVENTIONS.md](../CONVENTIONS.md).
- [ ] Nenhuma afirmação de "passa" sem evidência (regra anti-alucinação, [ai-development.md](./ai-development.md)).

## 3. Segurança & Compliance

- [ ] Nova tabela tenant-scoped: `ENABLE + FORCE RLS` na mesma migration + índice em `clinic_id` + **checklist ADR-007 §10** colado no PR.
- [ ] `SECURITY DEFINER` novo: segue as 8 regras do [ADR-010](../adr/010-security-definer-patterns.md) (`REVOKE PUBLIC` + `GRANT` explícito + `search_path` fixo).
- [ ] Dado sensível de paciente: criptografado per-tenant ([ADR-012](../adr/012-encryption-strategy.md)); nada de PII em log/metrics (sanitização).
- [ ] Impacto LGPD/CFM avaliado quando toca dado pessoal/clínico (retenção [ADR-017](../adr/017-clinical-record-retention-vs-lgpd.md)/[021](../adr/021-lgpd-anonymization-on-clinical-retention.md)).
- [ ] Segredo novo: declarado em `src/lib/env.ts` + `.env.example`; **nunca** commitado com valor real.

## 4. Observabilidade & Operação

- [ ] Erros relevantes chegam ao Sentry; logs estruturados com `req_id`/`clinic_id` quando fizer sentido ([c16/](../c16/README.md)).
- [ ] Caminho crítico novo tem métrica/alerta se merece pager (não invente dashboard; [ADR-029](../adr/029-observability-stack.md)).
- [ ] Precisa de procedimento operacional repetível? Escreve **runbook** ([runbooks/](../runbooks/README.md)).

## 5. Banco & Migrations

- [ ] Migration nomeada `^\d{4}_[a-z][a-z0-9_]*\.sql$`, **atômica** (tabela + RLS + trigger juntos), imutável após aplicar.
- [ ] `pnpm check:migrations` verde (gate anti-DROP destrutivo).
- [ ] Procedimento de prod respeitado quando aplicável ([runbooks/migrations.md](../runbooks/migrations.md)): backup antes, `pg_advisory_lock`, opt-in explícito.

## 6. Documentação (Documentation-Driven Development)

- [ ] A mudança se documenta no **lugar certo** (roteamento em [ai-development.md](./ai-development.md#documentação-automática)).
- [ ] **Mudança arquitetural → ADR** existe/referenciado (regra dura; sem ADR = PR bloqueado).
- [ ] Contrato de evento novo/alterado → [contracts/](../contracts/README.md) + [ADR-015](../adr/015-event-versioning.md).
- [ ] `CHANGELOG.md` atualizado se muda comportamento visível.
- [ ] Docs tocados tiveram `Status`/`Última revisão` atualizados ([documentation-lifecycle.md](../documentation-lifecycle.md)).
- [ ] Commit segue Conventional Commits e descreve o **porquê**.

---

## Fluxo antes de abrir o PR

`brainstorm/plano` → `TDD` → implementar → **rodar gates** (§1) → documentar (§6) → preencher o [template de PR](../../.github/pull_request_template.md) com evidência de teste (§2). Dúvida "isto precisa de ADR/migration/evento?" → [decision-guide.md](./decision-guide.md).

---

## Veja também

- [git-workflow.md](./git-workflow.md) · [decision-guide.md](./decision-guide.md) · [ai-development.md](./ai-development.md)
- [../CONVENTIONS.md](../CONVENTIONS.md) — a lei que os gates enforçam.
- [README.md](../README.md) — índice mestre.
