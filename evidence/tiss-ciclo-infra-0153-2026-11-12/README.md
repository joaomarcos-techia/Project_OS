# Evidências — ciclo de 12/11/2026 (tarde): bucket, Preview, 0153/0154, interface, recurso

Tudo com dados sintéticos. **Nenhuma migration aplicada no DEV; produção intocada.** No DEV houve só: criação do bucket
`tiss-files` (autorizada) e leituras de catálogo/agregados (autorizadas).

| Arquivo | O que prova |
| --- | --- |
| `bucket-dev-preflight.json` | pré-voo só de leitura: projeto DEV, buckets existentes, RLS de `storage.objects` e **zero** políticas |
| `bucket-dev-criacao.json` | criação SÓ do `tiss-files` (privado, 30 MiB, `application/octet-stream`) |
| `bucket-dev-postflight.json` | depois: demais buckets intactos, ainda zero políticas |
| `bucket-dev-aceite.log` | aceite 13/13 contra o bucket real (ver `docs/convenios/armazenamento-tiss.md`) |
| `preview-tiss-xsd-61494392.json` | P9.2 na Preview da Vercel: 302/401/200, válido/inválido/hostil, sonda de limites (namespace, lote grande, timeout, memória, fila), regressão (login, raiz, health), sem segredo no arquivo |
| `ensaio-aplicacao-0153-0154-1M.log` | aplicação da 0153+0154 sobre 1 M lançamentos: tempo e lock por instrução, espera da escrita concorrente, custo do gatilho do livro (R38) |
| `recurso-glosa-sintetico.xml` | XML RECURSO_GLOSA gerado do registro de um recurso sintético e validado no XSD oficial |

Harnesses (Postgres 17 descartável, migrations reais 0000–0154): bloqueio comercial 11/11, cadeia unida 10/10, ponte
financeira 18/18, glosas 16/16, lotes 16/16, leituras da interface 6/6, XML do recurso 6/6, P7.4 19/19, clínica,
cobertura, emissão, serviço da guia e guias verdes.
