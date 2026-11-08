# Cutover de provedor — roteiro futuro

**Status: proposta. Não executar em produção sem autorização específica da capacidade, release, destino e janela.** Não substitui [DR](disaster-recovery.md), [migrations](migrations.md), [incidente](incident-response.md) ou [rollback](provider-rollback.md). Escopo e tarefas em [portabilidade](../decoupling/README.md).

## 1. Preparar a ficha da janela

Registrar: capacidade e cohort, release/SHA de app e landing, DB/schema versões, provider/conta/ambiente origem e destino, origens HTTP/callbacks exatos, owner técnico/segurança/financeiro, aprovador, início/fim/abort, métricas/meta, método de writer único, checkpoint, plano de delta, dados permitidos e cleanup. Não colocar segredos na ficha.

Confirmar gates pertinentes: hosting G7; financeiro G4; Storage G5S; identidade G5I; banco G6; combinado G8. Ausência de prova é PENDENTE/BLOCKED, não PASS. Revisar se houve código/config/schema novo desde o ensaio e repetir apenas a fatia afetada.

## 2. Verificações antes de mutar

1. Conferir identidade dos dois backends por metadados verificáveis e allowlist, não pelo nome "dev" da URL. Nenhum token DEV em produção. Novo destino só com secrets próprios e chaves de leitura histórica explicitamente autorizadas quando necessárias.
2. Registrar inventário e hashes agregados de contratos/price_id/trial/direitos e contagens do snapshot. Confirmar nenhum orphan/constraint nova no cohort; não sanear cliente por suposição.
3. Garantir backup correspondente à janela, chaves recuperáveis, SQL + objetos + configuração Auth + integrações. Preservar original e provar restore isolado de escopo equivalente. Aceite anterior de backup independente não é prova de nova recuperação.
4. Preparar versão N-1 compatível com schema expandido. Nenhuma migration destrutiva/contract na mesma janela de corte inicial. Preflight de locks/transações longas e lock_timeout/statement_timeout devem vir da migration concreta, não de números genéricos deste plano.
5. Testar endpoint público de webhook, TLS/body/headers/auth sem desafiar o provedor com SSO. Conferir Auth/Meta/Turnstile e e-mails de teste. Não criar cobranças reais para smoke.
6. Confirmar alerta realmente entregue, logs sanitizados, métricas e capacidade/pools. Só gerar tráfego sintético que não acione clínica real.

## 3. Corte conforme o eixo

| Eixo       | Procedimento controlado                                                                                                                                                                                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosting    | Preparar release verde; desligar scheduler antigo antes de novo; manter backend autoritativo; mudar tráfego com TLS/origem testados; não alterar banco/gateway na mesma etapa                                                       |
| Banco      | Interromper mutations/writers por controle aprovado, drenar leases, snapshot/delta final, validar integridade e seq; promover um writer; preservar log de escritas novas                                                            |
| Storage    | Cópia/manifesto + delta/tombstones; pausa final de escrita; conferir bytes/ACL/referências; trocar resolução e writer; origem read-only durante janela aprovada                                                                     |
| Auth       | Subjects e estado reconciliados, credenciais/MFA tratados por estratégia aprovada, emissor/sessão explícitos; preservar revogações e recovery em aberto; reautenticar quando necessário                                             |
| Financeiro | Novas originações só no cohort selecionado; contratos antigos permanecem no binding; nenhum novo contrato cobrante antes de confirmação de encerramento/transição autorizada do antigo; manter webhooks/reconcile/refunds de origem |

Flags existentes `SIGNUP_ENABLED` e `OFFER_2026_ANNUAL_NEW_SALES_ENABLED` não são freeze global de escrita. **Ainda não existe um controle universal de manutenção implementado por este plano.** A tarefa de execução precisa provar o bloqueio dos writers pertinentes. Alteração de env na Vercel requer novo deployment para afetar deployments anteriores; no host alvo, seguir o mecanismo testado de restart/config/release. Nunca supor que clicar em salvar env muda o processo em execução.

## 4. Pós-corte e observação

1. Executar smoke sintético de login/MFA, navegação, tenant errado negado, agenda, leitura de PDF e capacidade afetada; conferir estado DB/provedor, não só UI.
2. Confirmar um scheduler, heartbeats 21/21, outbox sem backlog inesperado, nenhuma chamada de Preview à produção e callbacks com destino correto.
3. Reconciliar valores/obrigações/períodos/quotas e pagamentos tardios dos dois lados; jobs devem escolher binding persistido.
4. Comparar métricas à baseline na mesma carga e anotar latência/erro/DB pools. Verificar URLs antigas/assinadas segundo janela.
5. Somente depois da observação aprovada propor desativação. Não apagar banco/Storage, revogar keys ou encerrar conta financeira como cleanup automático.

## 5. Abortar

Acionar [rollback](provider-rollback.md) para isolamento violado, bytes/ACL incorretos, perda de escrita/efeito, duplicidade financeira, origem errada, scheduler duplo ou retorno inviável. Qualquer custo/efeito irreversível adicional exige decisão específica. Guardar evidência mínima segura; não fazer reset de dados para "tentar de novo".

Comandos concretos de deploy/migration/copy serão preenchidos após escolher/homologar o destino; inventar CLI de provedor não selecionado tornaria este runbook perigoso. Comandos já existentes de teste/DR estão nos documentos referenciados e devem manter seus guardas.
