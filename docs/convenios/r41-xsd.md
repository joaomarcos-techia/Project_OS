# R41 — validador XSD: pool persistente e exportação assíncrona (R45)

**Situação (13/11/2026):** pool **implementado e testado** (`8b720c7c`); exportação assíncrona
**implementada e testada** (`779a5702`, seção 4), com leitura delegada auditada.

## 1. O gargalo

A cada validação, o motor subia um worker novo do `xmllint-wasm`, que lia e compilava o `xmllint.wasm`
(778 KB) e carregava os XSD oficiais. Esse custo fixo dominava o tempo, mesmo para uma guia.

## 2. O que mudou (pool)

`src/contexts/health-insurance/tiss/xml/xsd-engine.ts`:

- O `.wasm` é compilado **uma vez** (`WebAssembly.compile`) a partir dos bytes já conferidos pelo SHA-256 fixado
  (`XMLLINT_PIN`), sem reler o arquivo.
- Há workers **persistentes**, no máximo `maxConcurrency` (padrão 2). Cada validação cria uma **instância nova**
  do módulo compilado (`instantiateWasm`) com **memória nova**. Nada de uma validação sobrevive para a seguinte,
  nem entre clínicas.
- Os XSD são enviados uma vez por worker (`workerData`); cada job leva só o XML.
- **Limites:**
  - prazo por job: se estourar, o worker é **encerrado e descartado**;
  - heap JS limitado por worker;
  - erro, abort ou saída inesperada também descartam o worker;
  - reciclagem a cada 200 jobs;
  - um worker ocioso é encerrado em 60 s;
  - `unref`: o worker nunca segura o processo.
- **Inalterado:** fila com teto (`busy`), barreira contra XML hostil antes do parser, saída sem dado pessoal e
  fail closed (sem motor íntegro, nada é validado).
- **Chave de desligamento:** `pooled: false` ou `TISS_XSD_POOL=off` volta ao worker novo por validação.
- **Vercel:** nenhum estado de negócio fica no pool. Se a instância cair, o custo é só subir outro worker (a
  primeira validação de um processo frio continua pagando a compilação, cerca de 300–600 ms).

## 3. Medições (mesmo processo e mesma máquina, `hi-xsd-queue-bench.ts`)

`evidence/tiss-ciclo-r41-xsd-pool-2026-11-12/fila-xsd-pool-off-on.log`. A máquina estava com carga de fundo, então
os números absolutos estão inflados; a comparação vale porque foi feita na mesma condição.

| Lote | Concorrência | Antes: isolada | Antes: vazão | Depois: isolada | Depois: vazão | RSS antes → depois |
| --- | --- | --- | --- | --- | --- | --- |
| 1 guia | 2 (padrão) | 851 ms | 2,2/s | 52 ms | **31,6/s** | 122 → 133 MB |
| 1 guia | 4 | 813 ms | 3,7/s | 53 ms | 51,8/s | 170 → 195 MB |
| 100 guias × 30 itens | 2 (padrão) | 1.181 ms | 1,6/s | 328 ms | **5,0/s** | 210 → 373 MB |
| 100 guias × 30 itens | 4 | 1.152 ms | 2,3/s | 378 ms | 8,7/s | 278 → 580 MB |

Não houve erro em nenhuma das 16 medições. O padrão continua em 2: o pool troca CPU por memória residente, e os
vCPUs e a memória da função na Vercel não foram medidos.

**Testes:**
- 23/23 do motor, dos quais 6 são do pool (reaproveitamento, isolamento, timeout com descarte, reciclagem,
  concorrência e chave de desligamento);
- corpus c1 e c2 inteiro;
- harness de lotes 16/16 com o XSD real.

**No navegador:** um lote foi montado, teve o XML gerado e validado no XSD **na Vercel** e o download foi
conferido (`e2e/convenios-preview.spec.ts`).

## 4. Exportação assíncrona (R45) — implementada e testada em 13/11

**Situação:** implementada (`779a5702`); harness `health-insurance-batch-export-async-db.ts` 10/10
com o worker real do outbox; validação no Preview em `e2e/convenios-batch-async-preview.spec.ts`.

Como ficou (sem DDL, sem infraestrutura nova):

- **Pedido** (`_lib/batch-export-actions.ts`, `manage:financial` fresca, D24): publica
  `health_insurance.batch.export_requested` `{ clinicId, batchId, version, requestedBy }` com a chave
  `hi-batch-export:<lote>:v<versão>` na mesma transação da auditoria. O mesmo lote na mesma versão é um
  job só. Logo depois da resposta, o job é processado pelas chaves exatas do request
  (`runOutboxEventsNow` via `after`); o cron do outbox é a reserva.
- **Leitura delegada** (`readBatchGuidesDelegated`, em `guide-access.ts`, o único módulo que decifra
  snapshot):
  - escopo mínimo: as guias ativas do lote pedido, lidas pela RLS da clínica (o worker não escolhe guias);
  - autorização na execução: `manage:financial` efetiva de quem pediu, conferida de novo no banco
    (`delegation-permission.ts`, só leitura, escopo fixo usuário+clínica+permissão; único ponto do
    contexto com `dbAdmin`, na allowlist do ESLint e do arch-db-check);
  - auditoria em nome de quem pediu, com o serviço e o job (`actor.kind = delegated`); negação também
    auditada; a leitura de sistema comum não aceita a operação delegada.
- **Execução** (`handlers/batch-export-requested.ts`, handler destacado): lote mudou ou foi cancelado →
  o job caduca sem gerar nada; já exportado → `already_exported`; a exportação existente gera, valida no
  XSD oficial, cifra e grava com compensação do objeto.
- **Falhas:** regra, conteúdo, autorização (`access_permission_revoked`) e bloqueio comercial
  (`premium_denied`) falham sem nova tentativa, com código; validador indisponível e armazenamento fora
  são transitórios (nova tentativa com backoff); worker interrompido é devolvido à fila pelo zelador.
- **Tela do lote:** "Gerar XML em segundo plano" e o estado (na fila, gerando, falhou com o motivo por
  código, concluído). O texto técnico do erro nunca vai para a tela.

Provas do harness: serviço não declarado recusado; outra clínica = não encontrado; quem pediu sem
permissão negado na execução e auditado; caminho feliz com 2 leituras auditadas em nome de quem pediu;
mesmo pedido = 1 job; replay e dois workers simultâneos = 1 arquivo; lote cancelado depois do pedido;
XSD reprovado; armazenamento fora e de volta; assinatura suspensa depois do pedido; worker interrompido;
backlog de 12 lotes (12 arquivos, ~2 s no worker local, concorrência 2).

### Desenho original (12/11), mantido para histórico

O desenho usa o outbox existente, sem infraestrutura nova e sem DDL.

1. **Pedido.** A ação publica `health_insurance.batch.export_requested` com o payload
   `{ batchId, version, requestedBy }` e a chave idempotente `hi-batch-export:<batchId>:v<version>`. O mesmo lote
   na mesma versão gera um job só.
2. **Execução.** Um handler **destacado** (`registerDetachedHandler`) roda a exportação existente, que já é
   idempotente (devolve `already_exported`) e tem compensação do arquivo gravado.
3. **Falhas:**
   - **de validação** (regras, TUSS, estrutura, XSD, hash, codificação): `PoisonPillError` com código e mensagem
     sem dado pessoal; o job falha sem nova tentativa e o lote continua preparado;
   - **transitórias** (validador ocupado ou indisponível, timeout, armazenamento): erro comum, e o outbox tenta
     de novo com backoff.
4. **Estado na tela.** O outbox já tem política de leitura por clínica: status, tentativas, `error_code` e
   `last_error`. A tela do lote mostra "na fila", "gerando", "falhou: <motivo>" ou o arquivo pronto.
5. **Notificação.** O job concluído aparece na tela do lote e no painel; um e-mail ou aviso ativo depende do canal
   de notificações do Qoro.

**O bloqueio.** A exportação recebe as guias **decifradas pela leitura auditada da sessão**
(`readBatchGuidesAudited`: permissão fresca e auditoria do usuário). Em segundo plano não há sessão. É preciso uma
**leitura delegada** no `guide-access`, o único módulo que decifra snapshot, com estas regras:

- a auditoria fica em nome de quem pediu, com a finalidade "exportação do lote" e o id do job;
- a permissão e o vínculo da pessoa são conferidos **na execução**, e não só no pedido;
- a mesma invariante de "quem decifra" é preservada.

Isso mexe em código sensível e fica para um ciclo próprio, com revisão.
