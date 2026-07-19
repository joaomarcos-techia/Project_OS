# infra/observability — alerting como código

> Achado **C1** da [auditoria de monitoramento](../../docs/achados/auditoria-monitoramento-producao.md):
> *"o alerting não está comprovadamente conectado"*.

## Por que este diretório existe

A instrumentação sempre esteve no repositório; **a notificação não**. As regras
que efetivamente acordam alguém viviam só em dashboards (Sentry, Better Stack),
o que produzia três problemas:

1. **Não auditável.** Ninguém consegue revisar, em PR, um alerta que mora num
   painel. Não dá para saber se ele existe, se o threshold mudou, ou se alguém o
   silenciou seis meses atrás.
2. **Não reproduzível.** Um ambiente novo (ou uma conta recriada) nasce sem
   alerta nenhum, e nada acusa.
3. **Não versionado.** Não há histórico de por que um threshold é o que é.

Versionar a **definição** resolve os três. O que continua fora do repo é só o
que tem de estar: credencial de conta e o canal pessoal do operador.

## O que é código e o que é clique

| Artefato | Onde vive | Aplicável por código? |
|---|---|---|
| Sentry alert rules | [`sentry-alerts.tf`](./sentry-alerts.tf) | ✅ Terraform |
| Monitores de uptime | [`betterstack-monitors.md`](./betterstack-monitors.md) | ⚠️ spec versionada; criação manual |
| Saved searches de log | [`log-search.md`](../../docs/runbooks/log-search.md) | ⚠️ spec versionada; criação manual |
| **Canal que acorda o operador** | conta pessoal | ❌ **sempre manual** |

> O canal é deliberadamente manual: é o número de telefone/push de uma pessoa.
> Versionar isso seria vazar contato num repositório.

## Como aplicar

Passo a passo (com o teste de disparo, que é a parte que as pessoas pulam):
**[`docs/runbooks/alerting-setup.md`](../../docs/runbooks/alerting-setup.md)**.

> ⚠️ **Um alerta não testado não é um alerta.** O go-live #2 esteve aberto por
> semanas com "a regra está criada" — mas ninguém tinha forçado um disparo até o
> fim. A DoD deste diretório é ter visto a notificação chegar.
