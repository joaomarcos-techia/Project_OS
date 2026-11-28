# GO condicional: aplicar a migration 0167 no DEV compartilhado (versão da P8.4-r, 24/11/2026)

**Situação (24/11, 13h52 UTC): APLICADA NO DEV**, com todos os gates da seção 5 cumpridos. Resultado na seção 9 e em `evidence/tiss-0167-dev-2026-11-24/`. Produção não muda.

**GO:** o fundador deu **GO condicional** em 24/11 para a versão da 0167 atualizada à política P8.4-r aprovada, **depois dos gates** da seção 5. Não vale para produção.

**O que mudou desde o pedido de 23/11:** a versão de 23/11 (`22390fcc…`) só conhecia `active` e `cancelled`. A política aprovada precisa do ciclo de faturamento do item (ligar a autorização, incluir na guia, não faturar com motivo), então o SQL mudou **antes** de qualquer aplicação. A versão de 23/11 nunca foi aplicada em lugar nenhum.

## 1. O que vai ao banco

| Item | Valor |
| --- | --- |
| Arquivo | `docs/convenios/migrations/0167_hi_appointment_extra_items.candidate.sql`, promovido no GO a `drizzle/migrations/0167_hi_appointment_extra_items.sql` com o mesmo conteúdo |
| sha256 do arquivo | `7249f069fc5454e74034e1004f3be7d04606c020d7b16244b4014aafc861f3f0` (LF, sem CR), o hash que o Drizzle grava no ledger |
| Reversão | `docs/convenios/migrations/0167_hi_appointment_extra_items.rollback.sql` (sha256 `4bb2d960…`) + a linha do ledger |
| Entrada no journal | idx 167, `when` 1795728173857 (0166 + 1 dia), tag `0167_hi_appointment_extra_items` |
| Commit | o primeiro commit do #55 com este conteúdo (ciclo de 24/11); qualquer commit posterior serve, desde que o arquivo tenha o mesmo sha256 |

**Objetos criados (nenhum objeto existente é alterado):**
- **Tabela** `public.hi_appointment_extra_items`, sem campo clínico e sem valor digitado:
  - o fato (atendimento, linha de contrato, código, descrição, "exige autorização", quantidade, origem, autor e data) e a decisão (autorização ligada, linha da guia, motivo de não faturar ou de cancelar, e quem e quando em cada etapa);
  - cinco FKs: `clinics`, `hi_appointment_coverages`, `hi_procedure_contracts`, `hi_authorization_items` e `hi_guide_items`;
  - CHECKs: códigos, quantidade 1–999, origem, estados, ciclo (cada etapa grava o que é dela, junto) e motivos;
  - índices: um item não cancelado por procedimento na sessão; uma linha da guia por item; atendimento.
- **Funções** (SECURITY DEFINER, `search_path` fixo, sem execução pública):
  - `hi_extra_item_guide_state`: etapa das guias vivas da sessão, travando-as com FOR SHARE (padrão da 0165);
  - `hi_extra_item_authorization_problem`: a autorização serve? (a da solicitação da sessão, mesmo procedimento, concedida, senha válida na data, saldo);
  - `hi_extra_item_insert_guard` e `hi_extra_item_update_guard`.
- **Gatilhos:** comercial primeiro (`hi_premium_guard`, 0151), depois o módulo (`hi_module_guard`, 0164), depois as regras. A alteração só aceita as transições da política, pela pessoa da sessão, e só aceita "incluído" apontando a linha certa da guia, com o consumo do saldo lançado.
- **Segurança:** RLS ligada e forçada, com política por clínica. O runtime tem SELECT, INSERT e UPDATE, **sem DELETE**.
- **Versão:** uma linha em `_schema_version` (`0167-hi-appointment-extra-items`).

## 2. Provas

| Prova | Estado em 24/11 | Onde |
| --- | --- | --- |
| Banco + serviço da P8.4-r: 28 provas (registro, posse da sessão do médico, transições, autorização e saldo, consumo uma vez, regra da operadora, aprovação bloqueada, "aprovar sem o item" atômico, guia cancelada, XML no XSD, recebível, concorrência, RLS, outra clínica, comercial, módulo, reprocessamento, indisponível) | **28/28 PASS** no #55 `5c1b8d09` (run `45404255259`), com a 0167 promovida; também na composição `b509a93c` (run `45404694262`) | `health-insurance-extra-items-db.ts`, job `convenios-synthetic-db.yml` |
| Ensaio da aplicação com o migrador real (guarda de composição, lock ocupado, locks da aplicação nas cinco tabelas, aplicação, segunda execução, reaplicação indevida, compatibilidade, reversão recusada com dados, reversão exata, reaplicação) | **11/11 PASS** no #55 `5c1b8d09` (run `45404255259`) e na composição `b509a93c` | `hi-0167-apply-rehearsal.ts`, mesmo job |
| Política, ações, painel, montador, regras da operadora | **PASS** local (vitest dirigido) | `extra-item-policy.test.ts`, `extra-item-actions.test.ts`, `extra-items-ui.test.tsx`, `sp-sadt-assembler.test.ts`, `insurer-rules.test.ts` |
| Versão de 23/11 | 18/18 e 11/11 (run `45189165431`): histórico, **não vale** para esta versão | — |

## 3. Compatibilidade

- **Código do #55 sem a 0167 (DEV e Preview hoje):** o serviço responde "não disponível", o painel não aparece e a aprovação não acha pendente.
- **Com a 0167:** o painel aparece na guia SP/SADT; registrar, ligar, incluir e não faturar gravam; a aprovação bloqueia guia com pendente.
- **Outras branches:** a 0167 só acrescenta. O ensaio compara o catálogo inteiro antes e depois, e os dados de todas as tabelas com md5.

## 4. Journal e numeração

| Onde | Estado |
| --- | --- |
| DEV, `drizzle.__drizzle_migrations` | 167 linhas, última a 0166 (conferido em 23/11; reconferido no pré-voo) |
| 0159 (`saas_period_snapshot`, do #53) | aplicada no DEV; entra no journal do #55 na integração sobre o #53, por `scripts/integrate-pr53-0159.ts` |
| #53 (`cf712ab4`) | journal até 0142; **sem conflito com a 0167** |
| #56 (`fe892902`) | sem migration nova |
| #59 (`c6e91bf1`) | candidata ainda chamada 0165; com a 0167 aplicada, a próxima livre é a **0168**. O dono do #59 renumera; o #55 não mexe na candidata alheia |
| Produção | nada muda (migrations de produção só depois dos merges #53 → #56 → #55, com autorização própria) |

## 5. Gates antes de aplicar (todos obrigatórios)

1. As 28 provas de banco e o ensaio de 11 passos verdes **nesta** versão (sha256 acima), no runner.
2. A CI do commit que promove a candidata verde (testes de journal e de composição com a 0167 no manifesto).
3. Pré-voo só leitura no DEV:
   - ledger com 167 linhas, última a 0166;
   - guarda de composição em `--dry-run`: pendente **só** a 0167;
   - nenhuma transação longa nas cinco tabelas referenciadas;
   - nenhuma migration de outra frente em andamento.
4. Backup lógico: ledger, `_schema_version` e catálogo do `public` (a tabela nova não tem dados).
5. Aplicação pelo aplicador limitado, com observador de esperas por lock:
   `scripts/db-migrate-dev-limited.ts --expected-ref <DEV> --expect-from 0166_hi_authorization_alerts --allow-external-applied --expect-to 0167_hi_appointment_extra_items`
   (`lock_timeout` 2 s, `statement_timeout` 60 s, uma transação).
6. Pós-voo: ledger com 168 linhas e o sha256; catálogo anterior intacto; objetos e RLS; serviço "disponível"; Preview no ar; E2E da P8.4.

Qualquer divergência interrompe e preserva o estado.

## 6. Riscos

| Risco | Controle |
| --- | --- |
| A transação toma **ShareRowExclusive** em `clinics`, `hi_appointment_coverages`, `hi_procedure_contracts`, `hi_authorization_items` e `hi_guide_items` (as FKs). Escritas nelas esperam até o COMMIT | corpo pequeno (uma tabela, quatro funções, três gatilhos, RLS); nenhum AccessExclusive em tabela existente; `lock_timeout` 2 s: com escrita longa, o aplicador desiste sem mudar nada e repete-se na janela seguinte |
| DEV compartilhado com o Preview e outros agentes | janela curta; o pré-voo confere sessões presas |
| O painel e o bloqueio de aprovação passam a valer no Preview | esperado; é a política aprovada |
| Numeração do #59 | o dono do #59 renumera para 0168+ |

## 7. Recuperação

1. Com o código que conhece os itens fora do ar, rodar o arquivo de reversão e depois `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795728173857`.
2. A reversão **recusa** se houver item registrado: o registro clínico e o que explica uma linha incluída na guia não se perdem. Com itens, a decisão é humana.

## 8. GO recebido (24/11)

> "MIGRATION 0167 NO DEV: GO CONDICIONAL PARA A VERSÃO ATUALIZADA À POLÍTICA APROVADA, DEPOIS DOS GATES." … "O GO já fica concedido para a versão atualizada que cumpra exatamente os critérios, sem necessidade de pedir autorização genérica novamente."

Não autoriza produção nem faturamento fora da política aprovada.

## 9. Aplicação no DEV (24/11/2026)

| Gate | Resultado | Evidência |
| --- | --- | --- |
| 1. Provas de banco e ensaio nesta versão | 28/28 e 11/11 no runner (com a 0167 como candidata e depois promovida) | runs `45400597559`, `45396028919`, `45404255259` |
| 2. CI do commit da promoção | verde em `bc20e3c8` (run `45400951131`) e no head `5c1b8d09` (run `45404272490`) | GitHub Actions |
| 3. Pré-voo só leitura | ledger 167 linhas, última a 0166 com o hash dela; nenhum objeto da 0167; arquivo com o sha256 do GO; nenhuma transação > 60 s; nenhum lock forte nas cinco tabelas; `--dry-run`: pendente só a 0167 | `pre-0167.json`, `apply-0167-dry-run.log` |
| 4. Backup lógico | estrutura `public` + `drizzle`, dados das tabelas `hi_*` e `clinics`, ledger; contagens conferidas com o pré-voo | `backup-0167-manifest.json` (os arquivos ficam fora do repositório) |
| 5. Aplicação | aplicador limitado, uma transação, `lock_timeout` 2 s: ledger 167 → 168 em 6,1 s; composição depois: sem pendentes; observador: nenhuma sessão esperando lock | `apply-0167-apply.log`, `apply-0167-observer.json` |
| 6. Pós-voo | ledger 168 com o sha256 da 0167 (anterior a 0166); tabela, 4 funções, 4 gatilhos e versão; RLS ligada e forçada, 1 política, runtime com UPDATE e sem DELETE; dados das cinco tabelas referenciadas iguais ao pré-voo (contagem e md5) | `post-0167.json` |

**Preview:** o #55 está publicado no `5c1b8d09` (código da P8.4-r); as outras frentes não leem a tabela.

**Falta do pós-voo:** o E2E da P8.4 no Preview (jornada da conferência e do consultório), que ainda não tem spec nem fixture SP/SADT no DEV.
