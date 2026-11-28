# Proposta — reduzir o custo do GitHub Actions (25/11/2026)

**Para:** o fundador. **Nada foi aplicado aos workflows** e nenhum run foi disparado para testar esta proposta.

## Diagnóstico (leitura gratuita da API, runs de 18/11 a 25/11)

| Workflow | Runs | Minutos de relógio | Observação |
| --- | --- | --- | --- |
| CI (`ci.yml`) | 123 | 2.368 (≈ 19 min/run) | roda em TODO push de PR para a `main`, inclusive push só de documentação; o #55, o #63 (composição c11) e o #64 (composição comercial) repetem a mesma bateria |
| ADR advisory | 123 | 837 | é um passo de bash; o relógio inclui **fila** — o tempo cobrado é bem menor |
| Provas sintéticas de banco | 42 | 556 | a cada mudança no Convênios |
| Provas de banco (legado) | 42 | 449 | idem, ~27 harnesses |
| E2E no Preview | 26 | 429 | explícito (só com mudança do `preview-run.json`) |
| Outros (R61-B, benchmark, billing do #53, backup) | — | ~300 | o backup diário (≈ 1 min/dia) deve ficar |
| **Total** | **400** | **≈ 4.943** | |

**Premissas:** minutos de relógio ≠ minutos cobrados (a cobrança é por job, arredondada para cima, sem a fila).
O plano Pro inclui 3.000 min/mês em repositório privado; o excedente é cobrado por minuto Linux. Não tenho acesso
ao faturamento: o valor real (≈ US$ 30, informado pelo fundador) não foi conferido por mim.

**Proteção de branch:** o ruleset ativo só impede exclusão e push forçado; não há check obrigatório. Mesmo assim, a
proposta usa o padrão que continua válido se os checks virarem obrigatórios (job PULADO conta como sucesso).

## Estrutura proposta (A → D)

| Nível | Quando | O quê | Custo de Actions |
| --- | --- | --- | --- |
| A | durante o desenvolvimento | testes dirigidos (`vitest` do que mudou), harness de banco do que mudou | zero |
| B | antes de cada commit | lint, tipos e testes dos arquivos tocados; inventário se mexeu em action | zero |
| C | antes de integrar | **bateria completa local**: `node scripts/ci/run-workflow-local.mjs .github/workflows/<wf>.yml` para ci, sintéticas, legado e Voa (o executor lê o próprio YAML) | zero |
| D | integração e release | CI oficial no SHA final, uma vez | o mínimo |

## Mudanças nos workflows (preparadas, NÃO aplicadas)

1. **CI não roda para push só de documentação.** Um job `changes` (git diff contra a base, sem ação de terceiros)
   decide; o job pesado roda com `if: needs.changes.outputs.code == 'true'`. Job pulado conta como sucesso, então
   nenhum PR fica com check pendente.

   ```yaml
   jobs:
     changes:
       runs-on: ubuntu-latest
       outputs: { code: ${{ steps.diff.outputs.code }} }
       steps:
         - uses: actions/checkout@v4
           with: { fetch-depth: 0 }
         - id: diff
           run: |
             base="${{ github.event.pull_request.base.sha || github.event.before }}"
             if git diff --name-only "$base" HEAD | grep -vqE '^(docs/|evidence/|QORO_TISS_MASTER_PLAN\.md$|.*\.md$)'; then
               echo "code=true" >> "$GITHUB_OUTPUT"; else echo "code=false" >> "$GITHUB_OUTPUT"; fi
     ci:
       needs: changes
       if: needs.changes.outputs.code == 'true'
   ```
2. **Provas de banco do legado** saem do push: `workflow_dispatch` + PR com o rótulo `bateria-completa` (ou
   `ready_for_review`). As sintéticas principais continuam no push, com os filtros de caminho que já têm.
3. **Composições** (#63, #64) não recebem push a cada ajuste: validar localmente e publicar uma vez por janela.
4. **Agrupar pushes:** trabalhar em commits locais e publicar um push por janela de integração (cada push de PR
   custa ≈ 19 min só de CI).
5. **Cache do build do Next** (`actions/cache` em `.next/cache`) no passo de build; o `pnpm` já tem cache.
6. `cancel-in-progress` já existe nos principais; acrescentar ao ADR advisory.

## Economia estimada (premissas explícitas)

- Push só de documentação: neste ciclo ≈ 1 em cada 4 pushes do #55 → ≈ 25% dos runs de CI do #55.
- Legado fora do push: ≈ 450 min/semana.
- Composições validadas localmente: ≈ 30–40% do total de CI (o #63 e o #64 repetiam a bateria do #55 e do #53).
- Agrupar pushes (de ~15 por dia para 1–2 por janela): é a maior alavanca; depende do ritmo de trabalho.

**Estimativa conservadora:** 50–70% menos minutos com 1, 2, 3 e 4, sem tirar nenhum gate do SHA final.

## Validação desta proposta

A lógica do filtro (item 1) pode ser conferida localmente com `git diff --name-only <base> HEAD` nos commits deste
ciclo: os commits só de documentação (`f6bc8939`, `d1ba0250`) dariam `code=false`; os de código, `code=true`. A
verificação oficial fica para uma janela autorizada.

## 26/11/2026 — janela com o repositório público (runners padrão gratuitos)

Conferido antes de usar: todos os jobs rodam em `ubuntu-latest`, grupo "GitHub Actions" (runner padrão hospedado
pelo GitHub; em repositório público, sem cobrança de minutos). Nenhum larger runner. Nenhum workflow usa
`pull_request_target`; os únicos que leem segredos são o `db-backup.yml` (agendado na `main`, **desabilitado
durante a janela pública**) e o `convenios-preview-e2e.yml` (só em push na branch do #55 com `e2e/preview-run.json`,
não disparado nesta janela). `GITHUB_TOKEN` padrão só leitura.

| Item pedido | Estado |
| --- | --- |
| cache de dependências | já existe (`actions/setup-node` com `cache: pnpm` em todos os jobs de Node) |
| cancelar runs obsoletos | já existe (`concurrency` com `cancel-in-progress: true` em todos os workflows) |
| pular jobs em mudança só de documentação | **proposto, não aplicado** (`paths-ignore: ['docs/**', 'evidence/**', '**/*.md']` no `pull_request` do `ci.yml`). Hoje a `main` não tem check obrigatório, então pular não trava merge; quando houver branch protection com check obrigatório, um job pulado por `paths-ignore` fica "pendente" e bloqueia o merge: precisa de um job "noop" com o mesmo nome |
| seleção de testes por mudança | proposto (`vitest --changed` nos PRs intermediários), com a suíte completa obrigatória no SHA final |
| artefatos volumosos e retenção | `ci.yml` só sobe o relatório do E2E em falha (7 dias); Preview E2E 14 dias; o artefato de 30 dias era o dump do `db-backup` (apagado nesta janela) |
| limite de concorrência | `concurrency` por workflow e ref; sem limite global (não necessário com runner gratuito) |

Nenhuma dessas mudanças foi aplicada ao `ci.yml` neste ciclo: a política de CI é da `main` e não foi alterada.
