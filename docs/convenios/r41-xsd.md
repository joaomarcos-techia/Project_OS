# R41 — validador XSD: pool persistente (feito) e exportação assíncrona (desenho)

**Situação (12/11/2026, noite 3):** pool **implementado e testado** (`8b720c7c`); exportação assíncrona **não
implementada** (desenho abaixo, depende de uma leitura delegada auditada).

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

## 4. Exportação assíncrona (desenho; não implementada)

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
