# Fechamento da engenharia da oferta — 30/10/2026

Escopo: app `integration/pricing-plan-sync-20261018` / PR draft #42 e landing `fix/landing-offer-limits-20261024` / PR draft #3. Base recebida: app `8e10a48d`, landing `ca12a68`, ambos limpos e checks conferidos antes de alterar. Não houve merge, deploy, migration de produção, mudança de variável de produção, contrato, crédito ou cobrança. Production foi consultada **somente em transação READ ONLY** para journal/integridade agregada.

## Decisão de prontidão

A lacuna da **0133 sobre backup real está encerrada**. A preparação técnica avançou; **NO-GO de produção** permanece por custódia/cópia independente e operação de recuperação, widget/desafio real Turnstile, correlação do projeto/tier Gemini e aprovações comercial/operacional/janela. Nenhuma pendência foi convertida em PASS por código ou skip.

O [guia humano](../runbooks/acoes-manuais-pendentes-pricing-2026-10.md) foi reescrito em sete ações simples, sem comandos técnicos, login repetido ou compra. A engenharia executa as tarefas que dependem dessas decisões depois que os acessos/destinos forem disponibilizados.

## Matriz de evidência

| Frente | Situação | Evidência | Limite/próxima ação |
| --- | --- | --- | --- |
| Três recursos exclusivos da nova Clínica | **PASS** nos caminhos existentes auditados | Gates de actions/queries/páginas/PDF/banco; E2E real 1/1, quatro planos e sessão antiga | Não atribuir este resultado à produção ainda não migrada/publicada. |
| Legados | **PASS de compatibilidade** | Digest de todos os campos anteriores de `subscriptions`, `plans`, `prices`, `profiles`; quatro contratos reais do backup preservados; matriz Solo/Clínica/Pro | Não é autorização para reprecificar, cancelar ou converter clientes. |
| Restore real + 0119–0133 | **PASS 15/15** | PostgreSQL 17.11 + Vault 0.3.1; GPG e psql estrito; journal 119→134, hashes anteriores inalterados; evidência JSON versionada abaixo | Novo preflight/backup imediatamente antes da janela. |
| Atomicidade/concorrência da 0133 | **PASS** | Falha injetada reverte view, epoch e marcador; leitura concorrente provoca lock_timeout sem alteração parcial; aplicação posterior conclui | Tempo do drill não estima lock/duração sob carga de produção. |
| Auth funcional | **PASS sintético real, PARTIAL recuperação integral** | 14 verificações, 134 migrations, SMTP local, login/claims/refresh/hook/RLS/MFA/recuperação/logout; 62,777 s; cleanup concluído | Cofre externo, serviços gerenciados e RTO conjunto não são comprovados por este ensaio. |
| Storage | **PASS real anterior preservado** | 5 buckets, 42/42 hashes, 38 privadas negadas ao anônimo e 4 públicas; não repetido | Rotina, destino e custódia independente continuam pendentes. |
| Pacote/monitor de recuperação | **PREPARADO** | Criptografia/portabilidade sintética anteriores preservadas; testes de pacote/health repetidos neste patch | Nenhum upload real, scheduler Storage/Auth ou destinatário de alerta ativado. |
| Turnstile | **PASS técnico/Preview; PARTIAL Production** | 11 testes unitários; positivos/negativos reais anteriores preservados; script da janela exige token fresco, hostname, replay e inválido | Widget/domínio humano e gate real, sem confundir com os 2 SKIPs públicos de CI. |
| Gemini | **PASS técnico; PARTIAL operacional** | 402/429 sem retry curto nem payload; timeout/breaker/fallback; novo fechamento seguro na falha/corrupção de `ai_agent.mode`, com métrica sanitizada | Projeto/modelo/tier/saldo/limites e alerta entregue não foram aferidos no painel. |
| Landing/cadastro candidato | **PASS de coerência do código e evidências anteriores** | Preços/cotas/trial/recursos coincidem; testes de catálogo, formulário, cadastro e ciclos | Sem alteração na landing nesta rodada; seus checks `ca12a68` continuam aplicáveis. |
| Somente mensal | **PASS técnico** | Catálogo/seleção/reserva recusam anual desligado; regressão nova de chamada direta mensal→anual sem inserts/updates; anual existente preservado | Não prova renovação temporal anual; novos anuais continuam fechados. |
| Oferta pública | **DIVERGENTE, rollout pendente** | Leitura HTTP 200 de `qoro.dev/precos` em 30/10 ainda encontrou 7 dias, 10 profissionais/equipe ilimitada | Não publicar landing isolada; corrigir na janela conjunta com app/catálogo. |
| PRs e build | **Conferir no SHA final** | Checks completos da base aprovados; patch exige CI própria, TypeScript/lint/build/regressão/segurança | A evidência vinculada ao SHA final fica nos Checks e na descrição do PR, conferidos antes de encerrar a entrega. |

## Restore protegido e compatibilidade

Runner novo: `scripts/security/offer-restored-backup-db.ts`. Ele não aceita URL de banco: só cria contêiner local com nome exclusivo, rede `none`, zero portas, logs `none`, dados e `/tmp` em tmpfs e swap limitado à memória. A senha do backup entra pelo ambiente e pelo stdin do GPG; SQL decifrado vai direto ao psql. Não são gravados SQL, conteúdo de linha, chave ou erro SQL sensível no relatório.

Foi reutilizado o artifact cifrado real do workflow `40691933945`, de 28/10, SHA-256 `488e407815e36d42ea595ed599d7b7f925ad49434d4c6a449f2d4894acc4a992`; o original não foi alterado. Inventário conferido: **135 tabelas public, 27 auth, 8 usuários Auth, 4 clínicas, 8 profiles e 4 assinaturas**. A sequência executada e os hashes de cada arquivo estão em [evidência sanitizada](evidencias/offer-restored-backup-20261030.json). São somente metadados e resultados, não backup nem dados clínicos.

Com senha já carregada pelo cofre **somente no processo**, na raiz do worktree isolado (exemplo Windows, caminhos não secretos do artifact existente):

```powershell
node node_modules/tsx/dist/cli.mjs scripts/security/offer-restored-backup-db.ts --authorize-local-real-data --backup "$env:TEMP/qoro-ci-backup-40691933945/prod-20261028T125616Z.sql.gpg" --sha256 488e407815e36d42ea595ed599d7b7f925ad49434d4c6a449f2d4894acc4a992 --gpg 'C:/Program Files/Git/usr/bin/gpg.exe'
```

O runner confere o hash cifrado antes de usar o arquivo, exige PostgreSQL/Vault compatíveis e espera disponibilidade TCP, evitando confundir o servidor temporário de initdb com o servidor final. Há prazo de restore e timeout de lock/statement. Uma tentativa intermediária falhou no estágio restore, antes da aplicação; sua saída sensível não foi preservada. Após reforçar readiness TCP, a versão com rollback/concorrência passou em duas execuções consecutivas; a versão final com inventário também foi exercitada. Não se atribui a falha intermediária a produção nem se afirma uma causa externa demonstrada.

Matriz SQL em identidades sintéticas dentro da cópia: Solo e Consultório sem overrides; Clínica/Pro legados e Clínica 2/3/4/5 com grant/deny e hook coerentes; downgrade aumenta epoch, ignora o ajuste e preserva histórico; upgrade o reaplica. A prova de atomicidade cria uma clínica sintética anterior à 0133, executa o corpo e injeta uma exceção: a view e o epoch voltam ao estado anterior. Uma leitura concorrente da view faz a tentativa com lock_timeout abortar; após a leitura concluir, a migration normal passa. Zero constraints públicas não validadas, cinco cotas de assentos e cinco planos novos inativos. Contêiner e dados temporários removidos no finally e ausência relida.

## Readback remoto — sem escrita

Em **30/10 04:04 UTC**:

- **Production:** 119 entradas, sequência/timestamps até 0118; exatamente as 15 migrations 0119–0133 ausentes. 135 tabelas public, 27 auth, quatro assinaturas, **zero sem owner** e zero constraints públicas não validadas. 0133 ausente.
- **DEV:** 134 entradas, sem pendências; 138 tabelas public, 27 auth, dez assinaturas, três órfãs históricas e zero constraints públicas não validadas. 0133 presente com o hash previamente verificado.
- Produção mantém as **32 diferenças históricas de hash** já registradas (0000–0021, 0033, 0037, 0044–0050, 0071), sem diferença de ordem. DEV tem seis diferenças históricas, incluindo 0124. Nenhum hash foi regravado e nenhuma migration antiga reaplicada. Contagem sozinha não foi usada para identificar a pendência. Atualizar essa baseline e interromper se mudar antes da janela.
- As três órfãs DEV não foram apagadas/atribuídas nem demonstram uma regressão nova: permanecem saneamento histórico independente, com proteção estrutural e produção sem equivalente no readback. Não é uma conclusão sobre sua origem, que continua não comprovada.

A [comparação estrutural somente de leitura](evidencias/offer-schema-diff-20261030.json) identificou exatamente os três objetos extras no DEV: `plan_seat_limits` (nova migration), `audit_events_2027_05` e `audit_events_2028_05` (partições de auditoria). Não foram apagados. Nas tabelas comuns, há sete colunas novas previstas pela sequência; **nenhuma coluna removida, mudança de tipo ou nullability**. Não se declara equivalência de configurações gerenciadas Auth/Storage, dados, funções manuais ou versões de serviços apenas pela cardinalidade. O [readback de journal/integridade](evidencias/offer-release-readback-20261030.json) também está preservado, sem PII.

## Auditoria final dos caminhos de acesso

| Caminho | Proteção encontrada/provada |
| --- | --- |
| `/equipe`, actions individual e lote | Identidade/tenant/permissão e gate de plano; helpers de lifecycle só são chamados pelas duas actions guardadas. |
| JWT/hook/banco | 0133 aplica a mesma lista de planos; base por função permanece. Alteração de assinatura/overrides invalida claims por epoch. |
| Sessão anterior ao downgrade | E2E `45ec52c2`: POST capturado na Clínica, reenviado com cookies antigos **antes** do refresh, retorna sessão expirada e não grava auditoria. |
| Sessão renovada no Consultório | Mesma action retorna negativa de plano; UI não oferece edição, histórico deixa de ter efeito; grant não vira benefício por manipulação do browser. |
| `/configuracoes/pagamentos` e actions de repasse | Gate no loader/queries e nas mutations antes de validar/gravar. Geração de novo snapshot também verifica plano na transação. |
| `/caixa` | Server page elimina payout dos dados enviados ao cliente sem entitlement; ajuste de estorno histórico interno é preservado para manter consistência. |
| `/relatorios/repasses` | Gate antes das consultas; médico só vê o próprio recorte, gestor exige permissão financeira. |
| `/relatorios/pdf` e consolidado | GET autentica, limita exportação, consulta o plano no servidor; Consultório gera PDF geral sem seção médica, inclusive por URL direta. |
| Cache | RSC/PDF dinâmicos, PDF no-store; React cache da identidade é por request, não autorização persistente entre requests. Cópia já exportada/visualizada não é apagada do dispositivo pelo downgrade. |

Primeiro reteste desta rodada: **1/1 PASS**, quatro estados Clínica 2→Consultório→Clínica 5→Pro, em 2,5 minutos, com Auth/DB DEV comprovados por assinatura, no Preview `09e78f09`. Após o patch de copy, o **E2E final também passou 1/1 no código `01acc8f6`**, run `f3193d6b`, 2,2 minutos, no [novo Preview](https://project-16d0gb6i6-clinic-os-v2-s-projects.vercel.app). Inclui as quatro mudanças para Clínica no Consultório, sem venda de vaga avulsa. Registro Playwright `passed`, sem testes falhos, e cleanup zero de clínicas/usuários/linhas; o wrapper PowerShell emitiu aviso de conflito de cores. Não é um teste novo da saga financeira de upgrade e não criou cobranças. Logs sanitizados ignorados: `dist/quality/feature-entitlements-stale-session.log` e `dist/quality/feature-entitlements-final-preview.log`.

## Correção adicional da IA

Já existia o modo global `ai_agent.mode=fallback_only`, usado antes do contexto/LLM no inbound. Documentos anteriores que não identificavam esse mecanismo ficam corrigidos por esta auditoria. Isso não é autorização para ligá-lo em produção nem para vender indisponibilidade de IA como equivalente ao produto contratado.

**Bug encontrado:** falha ao ler a flag usava `normal` como fallback, podendo reativar Gemini depois do TTL durante indisponibilidade da configuração. `getAiAgentMode` agora usa `fallback_only` na falha/corrupção, emite `ai_agent.mode.read_failed` apenas com motivo seguro e permite recuperação na próxima leitura bem-sucedida. Ausência legítima da flag conserva o default normal; modo explícito e cache de 30 s continuam existentes. Jobs proativos não mudaram. Não há envio de prompt, erro de banco ou valor da configuração no evento.

A proteção contra HTTP 402/429, timeout, retries, breaker, orçamento por clínica, deduplicação de inbound/outbound e handoff foi revisada; não houve nova chamada Gemini nem envio de dado real. Sete regressões novas verificam configuração/cache/recuperação. Monitor/alerta entregue ainda depende de destinatário/configuração operacional; a saved search preparada não foi contada como alerta ativo.

## Clareza da mudança de plano

O painel chamava Consultório→Clínica de “Contratar +1 médico”, confundindo uma mudança de plano com a vaga avulsa de R$ 147. A ação agora diz **“Mudar para Clínica”** e explica que o Consultório não vende vagas médicas avulsas. A contratação de médico adicional continua disponível na Clínica. Os valores e a saga de cobrança não foram alterados. O teste de componente passou **22/22**; o cenário E2E 13 também verifica os quatro destinos Clínica e a ausência do botão de vaga avulsa no Consultório, sem iniciar Checkout.

## Testes executados e falhas de ferramenta

- **54/54**, oito arquivos: modo/cache, Gemini 402/429, breaker, retry, Turnstile, pacote de recuperação e health. A primeira execução usou um matcher inexistente no Vitest 2; os dois testes afetados falharam, foram corrigidos com matchers suportados e a bateria inteira passou.
- **81/81**, três arquivos: draft/catálogo/reserva anual desligada, classificação médico/CRM e cálculos/legado.
- **115/115**, seis arquivos: Checkout/provisionamento/trial/ciclo/preços e seleção de plano. São testes unitários com fronteiras simuladas, não novos pagamentos reais.
- **21/21**, cancelamento/legado e nova recusa de troca direta para anual sem intenção/gravação.
- **22/22**, formulário de assinatura, incluindo distinção entre mudança de plano e médico adicional. Total focado: **293/293 em 19 arquivos**, separado da regressão global da CI.
- **14 verificações Auth reais sintéticas**, com 134 migrations e cleanup. Não é RTO completo da produção.
- **15/15 migrations no restore real**, matriz de oito planos, rollback/lock concorrente e preservação de campos reais. Não se removeram linhas/constraints do dump para passar.
- **1/1 E2E real** incluindo sessão antiga, quatro estados e cleanup.
- Build/typecheck/lint/segurança/regressão global do código **`01acc8f6` aprovados**: [CI 41003665873](https://github.com/joaomarcos-techia/Project_OS/actions/runs/41003665873), **5.732/5.732 testes em 545 arquivos**, público **7 PASS + 2 SKIP** Turnstile no build isolado. Vercel/Snyk/Semgrep também passaram nesse SHA. A CI da base `8e10a48d` não foi usada para aprovar código posterior. A junction local de dependências continua com Zod 3 e não foi alterada; a CI instalou o lockfile Zod 4. Alterações documentais posteriores exigem conferir seus checks próprios no PR; não ampliam o escopo das provas financeiras.
- Landing não foi alterada; a prova desktop/mobile 4/4 e checks de `ca12a68` permanecem aplicáveis. `NEUTRAL/skipping` do Agent Review não é PASS.

## O que ainda depende de fora do código

1. Cofre/destino independente, custódia de chaves e autorização específica da cópia real. Só depois: exportar, conferir leitura/restauração no destino, ativar rotina/retention e teste de alerta/watchdog. Nenhum upload foi feito.
2. Dependências externas do Auth guardadas e reconstruíveis. Os 243 nomes/snapshot e o serviço sintético não provam esses acessos.
3. Widget/domínio e desafio real Turnstile antes da reabertura; 2 SKIPs de CI mantêm seu significado.
4. Projeto/modelo/tier/crédito/limites Gemini corretos. O relato anterior de pré-pago ativo/R$ 23 é histórico humano, não saldo atual aferido.
5. Oferta/termos aprovados e contingência/RTO/riscos residuais tratados. O aceite de perda entre backups não foi ampliado.
6. Autorização explícita da janela e execução posterior do runbook: cadastro fechado por deployment, preflight/backup, migrations, publicação conjunta, reabertura por deployment, smoke e observação real dos primeiros agendamentos/cadastros/cobranças. Isso continua NOT RUN.

**GO técnico:** condicionado aos checks finais e aos gates operacionais acima. **GO de produção:** não autorizado; NO-GO enquanto os critérios críticos permanecerem sem comprovação ou decisão formal aplicável. Nenhum teste de código substitui cofre, desafio real, painel ou aprovação contratual.

## Fechamento operacional subsequente — sem nova implementação de produto

Os PRs foram relidos nos SHAs `01acc8f6`/`ca12a68`: draft, mergeable, sem conflitos ou reviews/comentários de revisão pendentes; os checks aplicáveis estão aprovados, preservando `NEUTRAL` da landing. A consulta de proteções de branch GitHub retornou 403 por limite de plano em repositório privado. Portanto, PASS de execução não foi confundido com imposição automática dos gates pelo GitHub; não houve compra nem alteração de visibilidade/configuração.

O [plano operacional](../runbooks/fechamento-operacional-oferta-2026-10.md) acrescentou a comparação HD/SSD × armazenamento corporativo × combinação, kit SQL/Storage/Auth e custódia, limites do gate Turnstile, conferência Gemini e proposta de ensaio de RTO. Foi preparação documental; nenhuma cópia real externa, ativação de rotina, credencial ou condição comercial foi alterada. A pergunta sobre recursos foi respondida na continuação abaixo; não deve ser repetida. Sem mudança executável naquela etapa, não foram repetidos restore, pagamento ou E2E aprovados.

## Continuação: solução independente sem recursos já existentes

O founder informou não possuir mídia, armazenamento aprovado ou cofre. A [nova comparação e recomendação](../runbooks/backup-independente-sem-custo-2026-10.md) propõe **piloto gratuito B2 + Bitwarden Free + recuperação offline**, não uma contratação ou aprovação automática para dados médicos. B2 publica 10 GB gratuitos sem cartão; o DPA consultado tem escopo EEA/EU/GDPR e sua aplicabilidade à Qoro/LGPD não foi comprovada. Resolver o instrumento/destino antes de dados reais; piloto sintético não exige transferi-los.

Implementado planejador de metadados local com validação de limites do pacote, quota, retenção imutável, overflow e crescimento. Exporta somente contagens/bytes/estimativas sanitizadas. Nenhum conteúdo foi lido/decifrado, nenhum `.env.local` foi aberto e não houve chamada ao banco/provider nesta medição. [Evidência](evidencias/recovery-capacity-20261030.json): SQL 605.324 bytes, Storage 2.565.459 bytes/44 partes, Auth DPAPI 40.694 bytes; pacote portátil real ainda não criado. Estimativa superior por conjunto 4.128.776 bytes e reserva de **178.363.124 bytes para 36 gerações + 20%**. Cenários 10×/100× são testes de capacidade, não previsões; 100× excede pacote e franquia. Limite de formato de 64 MiB mantido, compartilhado pelo exportador e planejador sem mudar a cifra.

**PASS local: 22/22 em três arquivos**, sendo 15 testes novos de capacidade, incluindo roundtrip sintético e senha errada; TypeScript estrito dos módulos/script novos, ESLint e inventário de segurança aprovados. A regressão/CI dos novos arquivos deve ser conferida no SHA final do [PR #42](https://github.com/joaomarcos-techia/Project_OS/pull/42); 5.732/5.732 continua evidência do SHA anterior, não do planejador novo. Não foi necessário repetir pagamentos, restore real ou inspeção visual sem mudança de produto.

**NOT RUN externo:** conta/bucket, upload/download, Object Lock/retention, chave real em cofre recuperável, rotina observada e alerta entregue. **PARTIAL contratual:** instrumento aplicável e transferência internacional. **NO-GO operacional preservado.** A landing não mudou e ambos os PRs permanecem draft; nenhuma produção, migration ou contrato foi alterado. Próxima decisão única: escolher o piloto gratuito descrito; Auth/Turnstile/Gemini/termos/janela continuam em sequência, sem nova coleta de recursos inexistentes.
