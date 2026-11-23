# Pedido de GO: aplicar a migration 0167 no DEV compartilhado (23/11/2026)

**O que se pede:** autorização específica para aplicar **uma** migration, a `0167_hi_appointment_extra_items` (itens executados adicionais da P8.4), no **banco DEV compartilhado**.

**Escopo:**
- **Não** é produção.
- **Não** fatura nada: com a P8.4-r sem decisão, o item fica registrado e fora da guia.
- O pedido **não** se autoaplica: nada acontece até você responder com o texto do fim.

## 1. O que vai ao banco

| Item | Valor |
| --- | --- |
| Arquivo | `docs/convenios/migrations/0167_hi_appointment_extra_items.candidate.sql`, promovido no GO a `drizzle/migrations/0167_hi_appointment_extra_items.sql` com o mesmo conteúdo |
| SHA do commit | **`c066805a`** (branch `feat/convenios-tiss-20261110`, PR #55 draft), o último commit que mudou a candidata. Qualquer commit posterior serve, desde que o arquivo tenha o mesmo sha256 |
| sha256 do arquivo | `22390fcc58a5f41f92323a67be9d8d33743ae29b918d10af9e7377114979ed5e`, o hash que o Drizzle grava no ledger |
| Entrada no journal | idx 167, `when` 1795728173857 (0166 + 1 dia), tag `0167_hi_appointment_extra_items` |
| Reversão | `docs/convenios/migrations/0167_hi_appointment_extra_items.rollback.sql` + a linha do ledger |

**Objetos criados (nenhum objeto existente é alterado):**
- **Tabela** `public.hi_appointment_extra_items`, com 17 colunas, sem campo clínico e sem valor digitado:
  - chave primária e duas restrições únicas, uma delas o índice "um item ativo por procedimento na sessão";
  - três FKs: `clinics`, `hi_appointment_coverages` e `hi_procedure_contracts`;
  - cinco CHECKs: códigos, quantidade 1–999, origem, estados e motivo do cancelamento.
- **Funções:** `hi_extra_item_guide_closed` (trava a guia com FOR SHARE), `hi_extra_item_insert_guard` e `hi_extra_item_update_guard`, todas SECURITY DEFINER com `search_path` fixo e sem execução pública.
- **Gatilhos:**
  - comercial primeiro (`hi_premium_guard`, 0151), depois o módulo (`hi_module_guard`, 0164);
  - inclusão e atualização: só item de contrato SP/SADT da operadora do atendimento, autor = pessoa da sessão, cancelado não volta, guia fechada não muda.
- **Segurança:** RLS ligada e forçada, com política por clínica. O papel do runtime tem SELECT, INSERT e UPDATE, **sem DELETE**.
- **Versão:** uma linha em `_schema_version` (`0167-hi-appointment-extra-items`).

## 2. Resultados dos testes

Todos em Postgres descartável, com dados sintéticos e o código real.

| Prova | Resultado | Onde |
| --- | --- | --- |
| Banco + serviço da P8.4 (regras, RLS, comercial/módulo, guia fechada, Consulta, sem DELETE, concorrência, reprocessamento, XML exportado, recebível) | **18/18** | `health-insurance-extra-items-db.ts`, run `45189165431` (`dbf8f5a5`); repetido no SHA final |
| Ensaio da aplicação com o migrador real (guarda de composição, lock ocupado, locks da aplicação, aplicação, segunda execução, reaplicação indevida, compatibilidade, reversão recusada com dados, reversão exata, reaplicação) | **11/11** | `hi-0167-apply-rehearsal.ts`, run `45189165431` (`dbf8f5a5`); repetido no SHA final |
| Política P8.4-r, ações, painel | 9/9, 5/5, 5/5 | CI |

**Defeito encontrado e corrigido neste ciclo, antes de qualquer aplicação:**
- **Corrida guia × registro.** A checagem de "guia fechada" lia a etapa sem travar a guia. Em READ COMMITTED, um item podia ser gravado no instante em que a guia era conferida. Agora a função trava a guia com FOR SHARE, no padrão da 0165. A prova 16 testa as duas ordens.
- **Nota de reversão incompleta.** A nota antiga da candidata deixava para trás a função `hi_extra_item_guide_closed`. Agora existe um arquivo de reversão executável, que recusa reverter se houver item registrado; o ensaio prova que ele devolve o catálogo exato.

## 3. Compatibilidade

- **Código atual do #55 sem a 0167 (DEV e Preview hoje):** o serviço responde "não disponível", sem erro, e o painel não aparece.
- **Com a 0167:**
  - o painel aparece na conferência das guias SP/SADT em edição;
  - o registro grava;
  - a guia não muda, porque a política P8.4-r está em "sem decisão".
- **Código das outras branches:** a 0167 só **acrescenta**. O ensaio compara o catálogo inteiro antes e depois (todas as tabelas, colunas, restrições, índices, gatilhos, funções, políticas e permissões). Nada existente muda, e os dados de todas as tabelas ficam com o mesmo md5, exceto a linha nova de `_schema_version`.

## 4. Estado do journal e da numeração

Conferido hoje, só leitura no DEV e `git` nas branches:

| Onde | Estado |
| --- | --- |
| DEV, `drizzle.__drizzle_migrations` | **167 linhas**; última `created_at` 1795641773857 = 0166 (`ccf1639b…`); nenhum objeto da 0167 no banco |
| 0159 (`saas_period_snapshot`, do #53) | **aplicada no DEV** (`eb00a4e3…`, `when` 1795036973858), mas **fora do journal de qualquer branch** (pacote congelado do #53). É a lacuna que bloqueia a composição tripla; o dono é o #53. **Não** se resolve com migration vazia nem renumeração |
| 0164, 0165, 0166 | aplicadas no DEV; no journal do #55; fixadas no manifesto de composição |
| #55 | journal com 159 entradas (0000–0135, 0143–0158, 0160–0166); as 0136–0142 e a 0159 do #53 entram como exceções conferidas por hash no ledger |
| #53 (`bc955f4e`) | journal até 0142; a 0159 só no pacote; **sem conflito com 0167** |
| #56 (`fe892902`) | journal até 0136; sem migration nova |
| #57 (`93a79601`) | sem migration |
| #59 (`c6e91bf1`) | candidata **ainda chamada 0165** (`0165_super_admin_actions_append_only.candidate.sql`), mas a 0165 e a 0166 já são do #55 no DEV. Com a 0167 aplicada, a próxima livre é a **0168**. O #59 precisa renumerar antes de qualquer aplicação; a mudança de número já existia antes deste pedido |
| Produção | nada muda (produção só recebe migrations depois dos merges, na ordem #53 → #56 → #55) |

## 5. Ordem de aplicação (depois do GO)

1. **Promover a candidata** em um commit do #55:
   - criar o arquivo em `drizzle/migrations/`, com conteúdo idêntico (mesmo sha256);
   - criar a entrada do journal e fixar a 0167 no manifesto de composição;
   - esperar a CI verde.
2. **Pré-voo, só leitura no DEV:**
   - ledger com 167 linhas, última a 0166;
   - guarda de composição em modo `--dry-run` do aplicador: pendente **só** a 0167;
   - nenhuma transação longa nas três tabelas referenciadas.
3. **Backup lógico:** ledger e `_schema_version`, mais o catálogo do `public` para comparar depois. A tabela nova não tem dados para salvar.
4. **Aplicar** pelo aplicador limitado, com observador de esperas por lock numa conexão separada. É o mesmo procedimento da 0160–0166:
   `scripts/db-migrate-dev-limited.ts --expected-ref <DEV> --expect-from 0166_hi_authorization_alerts --allow-external-applied --expect-to 0167_hi_appointment_extra_items`
   (`lock_timeout` 2 s, `statement_timeout` 60 s, uma transação).
5. **Pós-voo:**
   - ledger com 168 linhas e o sha256 do arquivo;
   - catálogo anterior intacto;
   - objetos e RLS conferidos;
   - serviço "disponível";
   - E2E da P8.4 no Preview (jornada da conferência, outro perfil, outra clínica, concorrência, sem recebível a mais).

## 6. Riscos

| Risco | Tamanho | Controle |
| --- | --- | --- |
| A transação toma **ShareRowExclusive** em `clinics`, `hi_appointment_coverages` e `hi_procedure_contracts` (as FKs). Escritas nessas tabelas esperam até o COMMIT | no ensaio, a aplicação inteira levou 1,1 s **contando a partida da CLI** (o corpo em si é menor); nenhum AccessExclusive em tabela existente; 51 objetos novos, todos da 0167 | `lock_timeout` 2 s: com escrita longa em andamento, o aplicador **desiste sem mudar nada** (prova 3 do ensaio: desistiu em ~3 s com a partida da CLI, catálogo e ledger iguais) e repete-se na janela seguinte |
| DEV compartilhado com o Preview e com outros agentes | uma janela curta | avisar antes; o pré-voo confere sessões presas |
| O painel da P8.4 passa a aparecer no Preview | esperado | sem faturamento (política "sem decisão") |
| Divergência de numeração com o #59 | já existe | o #59 renumera para 0168+ (dono do #59) |

## 7. Recuperação

1. Com o código que conhece os itens fora do ar (ou com a política sem decisão, que não depende da tabela), rodar o arquivo de reversão e depois `DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1795728173857`.
2. A reversão **recusa** se houver item registrado: o registro clínico não se perde. Com itens, a decisão é humana (exportar, decidir e só então reverter por um procedimento próprio).
3. O ensaio prova:
   - a reversão sem itens devolve o catálogo e os dados **exatamente** ao estado anterior;
   - o migrador reaplica igual depois dela.

## 8. Texto exato da autorização

> "Autorizo aplicar a migration 0167_hi_appointment_extra_items (commit c066805a, sha256 22390fcc58a5…) no banco DEV compartilhado, pelo aplicador limitado, com promoção ao journal, pré-voo, backup e pós-voo descritos em go-0167-dev.md, na janela de ____. Não autoriza produção nem faturamento de itens."

Sem essa frase, a 0167 continua candidata, o DEV fica como está e o E2E da P8.4 continua **NOT RUN**.
