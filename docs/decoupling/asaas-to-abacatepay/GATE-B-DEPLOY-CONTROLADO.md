# Gate B — proposta de deploy técnico com aquisição fechada

## Checkpoint prevalente — C0 de ativação, 16/11/2026

Gate B concluído e preservado. Autorização `a51a97b8-a2f2-4f7b-a049-d02bcf75a9c4` cobre testes/C0 e Production somente leitura, não C1–C4. **Aquisição fechada, runtime/consumidores AbacatePay desarmados, PR53 draft/sem merge.** Sem novo deploy, migration, WAF/flag, webhook ou efeito monetário.

Readback15:18–15:25UTC: mesmo deployment/aplicação/TAR;160 migrations por ordem/hash, zero pendentes,22 relações críticas protegidas; sete fingerprints de catálogo iguais ao pós-Gate B, índices/constraints válidos, zero locks/transações longas. Cinco contratos Asaas/hashes financeiros originais preservados.21 crons com rota/agenda/host corretos; outbox sem pendências/falhas, heartbeat recente e8 execuções naturais200/zero5xx no recorte. Cadastro fechado, PASS manual de Dashboard/Assinatura preservado. Catálogo live5produtos corretos; webhooks0. Health200 é selftest/configuração rasa, não homologação financeira.

**368 testes dirigidos PASS/20 arquivos/zero SKIP**, sem dados reais, banco compartilhado, browser/Docker/build pesado. Sem defeito financeiro novo reproduzido; runtime/SQL/dependências intactos. Provas anteriores de PostgreSQL/Redis/HTTP/E2E/cinco compras Sandbox explicitamente reutilizadas. **Actions BLOCKED no e5c84f3a/reexecução2**, CI43882384504/ADR43882384626 sem runner/steps por pagamento/limite;0ms billable nesses runs. OrçamentoUS$10 informado, escopo/saldo não acessíveis à CLI e navegador indisponível. Sem ampliar orçamento ou usar backup real para testar. Conferir CI do HEAD final no PR, sem transferir GREEN35c6.

Sequência C0–C4, acoplamento receiver/consumidores, divergências documentais do provedor, pontos de parada e formulário no [checkpoint operacional C0](../../runbooks/abacatepay-operacao.md#checkpoint-prevalente--c0-pós-gate-b-16112026). C1 registra apenas; C2 requer GO para configuração+deployment+consumidores; C3 exige clínica/valor/consentimento e GO independente. **Não solicitar execução enquanto faltar CI final.** B1-B permanece adiado/risco aceito/não verificado. Checkpoints seguintes são históricos quando divergirem deste.

## Checkpoint prevalente — B2-B/B3 executados em Production, 16/11/2026

Autorização expressa do fundador no anexo 9cf59f2e-8b7d-4d67-be46-503717c8c5dd. Janela iniciada **12:31:12 UTC / 09:31:12 Brasília**, limite **13:31:12 UTC / 10:31:12 Brasília**. Fundador acompanha operação/incidentes; esta sessão executa banco, deployment e eventual rollback. **Janela encerrada13:28:51UTC/10:28:51Brasília,57min39s; nenhuma nova mutação Production autorizada após o encerramento.** Os checkpoints anteriores permanecem históricos quando divergirem deste.

- **B2-A PASS:** prefixo136 e24 pendentes conferidos por ordem/hash/TLSverify-full; pós-voo independente160/zero pendentes/zero locks ou transações longas.
- **B2-B PASS LIVE:** regra `rule_qoro_gate_b_aquisicao_temporariamente_fechada_5B0OEL`, versão5, primeira posição; dois POST exatos/ambiente Production. Seis requests anteriores e dois posteriores ao deploy correlacionados por requestId, rota, deployment e filtro wafRuleId; controle negativo de outra regra retornou zero. Regras anteriores preservadas.
- **B3 MIGRATIONS PASS:** somente0136–0159, commit reconhecido e pós-voo aprovado. Operador completo 206s, incluindo conferências; duração DDL isolada não medida. Nenhuma0160/0161/0162, edição do journal ou DOWN automático.
- **B3 DEPLOY PASS / Production com aquisição fechada DEPLOYED:** `dpl_8uzoX6ngA66EgYcmMwcJn831UiBp`, READY/PROMOTED, alias app.qoro.dev conferido. Aplicação44323990b3f1fb9282418fec44a3182b02148c66; TAR **6038df0da3a6afaee68528c2f38c08743356ef6bdf6ece7ca808fd41672d0e64**,234700800bytes/2787arquivos/160SQL. Origem operacional35c6ebc84401e8dbc674feeac7a62a9ca5c48db7, CI43831334234 GREEN; build/regressão exatos do TAR43804391473 preservados, mais build Production READY. Não usar o TAR3902 histórico.
- **Aquisição fechada:** SIGNUP_ENABLED=false; SAAS_SIGNUP_PROVIDER=asaas; ABACATEPAY_NEW_CHECKOUTS_ENABLED=false; coorte vazia; ABACATEPAY_ENVIRONMENT ausente também nos nomes de env do deployment. Overrides explícitos de build/runtime e readback de project settings conferidos; página pública mostra cadastro fechado. Novas APIs de aquisição recebem403 com deny WAF. Webhook AbacatePay recebe503 antes de processar inbox; runtime/consumers desarmados.
- **Asaas preservado no escopo observado:** cinco assinaturas continuam Asaas; hashes dos campos originais de subscriptions/plans/prices/invoices iguais antes/depois; nenhum gateway account/binding/operação/inbox novo.21 definições cron iguais no deployment e no projeto. Webhook Asaas não bloqueado por WAF; requisição sem autenticação recebe401. Nenhum cancelamento, pagamento, assinatura ou checkout real de teste. **Smoke autenticado manual PASS:** o fundador confirmou após a publicação que Dashboard e Assinatura abrem normalmente na conta existente. Evidência humana registrada em16/11; não é execução automatizada nem comprovação de cancelamento, mudança de plano ou cobrança. A confirmação não reabre a janela nem autoriza Gates C/D/E.
- **Saúde:** auth-hook e health geral autenticados retornam200; selftest1ms; checks gerais são rasos, não homologação dos provedores. Zero5xx não sintéticos observado no novo deployment até2026-11-16T13:28:29.359Z. O503 esperado do probe do webhook desarmado foi excluído explicitamente dessa contagem.
- **Incidente transitório:** GET /api/health/auth-hook de12:51:37UTC retornou500; log12:53:37 registra falha na SELECT do selftest, sem causa interna do driver. WAFallow, recuperação posterior200 em várias regiões e confirmação do fundador. Espera por lock de DDL é hipótese; não foi capturada cadeia de blockers e não há causa raiz conclusiva. Sem mascarar monitor ou alterar timeout.
- **Backup:** metadata12:32UTC confirma8 físicos COMPLETED, último2283489483/16/11 09:14:14.452UTC; workflow legado ativo e preservado. Sem download/restore/dump. B1-B permanece **DEFERRED / RISK ACCEPTED / NOT VERIFIED**; checksum de conteúdo nulo, retenção contratual/RTO integral não comprovados. Utilizada a exceção explícita validada do operador, sem inventar restoreEvidenceFile.
- **Operação:** duas tentativas de upload compactado não criaram deployment (readbacks confirmados); encerrados somente processos próprios. CLI oficial60.1.3 com upload padrão concluiu; pacote não mudou. Arquivo .env.local gerado automaticamente pelo link foi cifrado com DPAPI/ACL privada fora do release e removido da fonte; .gitignore original do TAR restituído. .env.local original e worktrees UI/TISS intocados.
- **Recuperação:** deployment anterior `dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP` identificado; manter WAF/obrigações ao reverter código/configuração. Schema160 permanece; sem DOWN automático ou reenvio financeiro cego. PR53 draft, sem merge. **Gates C/D/E NÃO AUTORIZADOS; nenhuma abertura comercial automática.**

Evidência sanitizada: bloco `gateBProductionWindow20261116` no registro [recuperacao-financeira-20261111.json](evidencias/recuperacao-financeira-20261111.json). O registro da janela/CI do SHA executor não é substituído por eventual commit posterior apenas documental.

## Checkpoint prevalente — reta final e contenção, 16/11/2026

**B1-B REAL — DEFERRED / RISK ACCEPTED / NOT VERIFIED.** O fundador adiou expressamente a prova real. Não solicitar AWS/Linux/cofre para B1-B, não iniciar Docker, restaurar/copiar dados reais ou repetir ensaios aprovados. Esse aceite substitui a exigência de restore real como pré-condição desta proposta B3, mas não autoriza B3, perda de backups ou ignorar falhas atuais. Os checkpoints anteriores permanecem históricos quando divergirem deste.

Baseline de entrada: `2d72adef2f1420ad433b55e2b790ebfa3380da86`, CI [43806706110](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43806706110) GREEN, 7.315 testes/646 arquivos/27 E2E/zero SKIP. Nesta rodada mudou somente tooling/testes/documentação; **a CI do novo HEAD deve ser lida no PR #53, sem transferir o GREEN anterior**. Aplicação revisada `44323990b3f1fb9282418fec44a3182b02148c66`, TAR **6038df0da3a6afaee68528c2f38c08743356ef6bdf6ece7ca808fd41672d0e64**, 2.787 arquivos/160 SQL, build exato anteriormente PASS e preservado. SQL/ref94f6da4a e pacote0136–0159 intactos;0160/0161/0162 e código funcional TISS fora. Nenhuma nova revisão financeira ou TAR foi criada.

### Evidências novas, sem mutação live

- **B2-A PASS ATUAL** em16/11 07:48:23–07:48:56UTC: projeto `shlcbxawrxuaebazuiue`, endpoint direto, CA oficial e TLS verify-full, READ ONLY;136 entradas por ordem/hash,24 pendentes, zero waits/transações longas, RLS crítico íntegro. Transporte idêntico ao HEAD de entrada validado.
- Complemento07:52:49UTC:0051/0093/0124 compatíveis, nenhum índice inválido/FK não validada. Apenas hashes financeiros de subscriptions/plans/prices/invoices e contagens agregadas; nenhuma linha financeira/clínica exportada. **Zero IDs de checkout de cadastro armazenados, zero sem assinatura e zero creation_unknown**. Isso não comprova invalidação de link externo desconhecido; qualquer novo link/estado ambíguo no preflight da janela exige parada.
- Inventário08:01:21UTC:139 relações,269 funções,83 triggers,146 policies,489 índices,635 constraints e1.844 dependências. Nove seções com hashes, índices/constraints validados, zero waits/transações longas. Inventário não é equivalência completa de schema; hipóteses históricas foram conferidas separadamente. Repetir o preflight imediatamente antes de DDL, pois outro agente pode alterar o estado.
- Backups gerenciados07:48:23UTC: **sete físicos COMPLETED,09–15/11**, último ID2273462739,15/11 09:14:14.727UTC; PITRoff. Plano/retenção contratual não retornados pela API; sete visíveis não estabelecem retenção. Sem download/restore.
- Rotina legada07:48:29UTC: workflow305661908 ativo, secrets por nome presentes, agenda06:00UTC, último sucesso43719455568 em15/11/artifact13:32:24UTC;30 artifacts com retenção30dias. Sete sucessos/uma falha entre oito runs; falha histórica de agendamento por cobrança/limite GitHub, não dump comprovadamente falho. Não disparar, baixar artifacts ou desabilitar. Public/auth cobertos pelo desenho lógico, Storage/binários e configurações gerenciadas excluídos.
- **BACKUP OPERACIONAL ATUAL: NÃO COMPROVADO para recuperação integral do serviço.** Continuidade do banco confirmada por metadados, com risco residual de recuperação aceito; conteúdo restaurável/retencão contratual/RTO integral e cobertura recorrente de Storage/Auth continuam sem prova atual. Substituto cifrado/health/alerta permanece preparado, não instalado; workflow antigo preservado até transição aprovada. Não cobrar infraestrutura para B1-B nesta etapa.
- WAF07:58:31UTC: ativo, versão3, duas regras rate_limit, **zero bypass custom ativo e nenhuma regra de contenção**. Snapshot integral somente de configuração guardado com DPAPI CurrentUser e ACL privada em `%LOCALAPPDATA%\Qoro\Operations\gate-b-waf-2f36dd1accef45f7b68e071fe8255e6b\firewall-config.dpapi`; roundtrip/hash PASS. SHA256 `bf9c577165280de64b9388e877b18f2ea328e1a3676fef35258c607c7f1c0e09`. Não é backup clínico/cofre independente; depende do perfil Windows e deve ser renovado na janela. Pasta vazia da tentativa anterior preservada após remoção bloqueada pela política, sem arquivo de configuração em claro.
- Catálogo live08:02:16UTC, GET somente: R$197/397/544/691/838,MONTHLY,devModefalse,sem trial nativo; loja esperada. Listagem de webhooks HTTP200/zero registros. Nada cadastrado ou ativado. A primeira tentativa não alcançou a API; a leitura passou usando a CA do sistema, sem desativar TLS.

### B2-B preparado e testado — não é PASS LIVE

`scripts/gate-b-containment.ts` gera a proposta PATCH `rules.insert`, conforme SDK oficial Vercel source35df178c629776dfd204660b562c983c6969ccc9. Corpo contém duas conditionGroup OR; cada uma tem três condições AND: **environment eq production**, **method eq POST**, **route eq /api/signup/sessions** ou **route eq /api/signup/checkout**. Action mitigate deny; sem bloqueio persistente por IP. Não usar header x-matched-path/Origin/Host fornecido pelo cliente como substituto de route/environment. Fonte oficial: [API](https://vercel.com/docs/rest-api/security/update-firewall-configuration), [parâmetros](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration), [ordem e ações](https://vercel.com/docs/vercel-firewall/vercel-waf/custom-rules).

**Alvo:** projeto `prj_GYB0Y9e02ka9jurpJvF6m0feH3eZ`, time `team_ml9fFeF262JqUMwFB6Vy61Cj`, Production. Após GO B2-B, inserir regra e colocá-la primeiro na ordem; preservar as duas regras existentes e os demais controles. Registrar ID atribuído e versão. Se não houver permissão/capacidade sem custo adicional ou houver bypass anterior, parar. Nenhuma mutação WAF/flag foi feita nesta rodada.

Flags do **novo deployment fechado**, não de um deployment antigo: SIGNUP_ENABLED=false; SAAS_SIGNUP_PROVIDER=asaas; ABACATEPAY_NEW_CHECKOUTS_ENABLED=false; ABACATEPAY_CHECKOUT_CLINIC_IDS vazio; ABACATEPAY_ENVIRONMENT ausente. Não remover segredos/flags do Asaas/pagamentos/cron/login. Alterar project settings não muda o deployment já construído; a barreira WAF deve conter a transição antes de B3. O verificador exige leitura do deployment exato, regra na primeira posição e condições/flags exatas; retorna CONFIGURATION_MATCHES_CLOSED_GATE_B_REQUIRES_LIVE_PROBES, **nunca PASS LIVE por configuração apenas**.

| Superfície | Prova reutilizada/nova e comportamento fechado | Verificação na janela |
| --- | --- | --- |
| POST signup/sessions | Flag fecha antes do serviço/cookie/escrita, inclusive corpo inválido | Deny com ID/versão/evento WAF, rota resolvida e request ID |
| POST signup/checkout | Flag fecha sessões antigas e ambos os ramos antes de autenticar/provisionar/criar obrigação | Deny WAF e ausência de criação; status pago permanece separado |
| POST billing/checkout | Guard real de runtime/coorte recusa inclusive chamada autenticada/repetida/tenant forjado, sem banco/rede | Runtime desarmado no deployment; não usar sessão pronta para contratar como probe |
| Recontratação/plano/chamada interna | Guards reais recusam antes de gateway/estado persistido | Sem fallback de origem; nenhuma nova obrigação |
| Server Actions/callbacks | Aquisição de cadastro entra nas APIs acima; Actions de Asaas legado mantêm obrigações existentes; callbacks/status conciliam sem iniciar nova contratação | Confirmar build/rotas e não bloquear callbacks/status por WAF genérico |
| Links antigos | Inventário local atual0IDs/0unknown; proteção API não invalida link hospedado externo | Novo ID/unknown: parar e tratar especificamente, sem cancelar obrigação real automaticamente |
| Consumidores AbacatePay | Runtime ausente mantém quatro entradas cron e recuperação inicial inertes, sem banco/rede | Não confundir checkout kill switch com runtime guard |
| Webhook AbacatePay |503 antes de inbox com runtime desarmado; catálogo live sem registro | Não registrar webhook nem ativar consumidor no Gate B |
| Asaas legado/pacientes |33 testes do webhook Asaas passam com SIGNUPfalse/runtime AbacatePay off; cancelamento/paid period/RLS já comprovados | GET/login/status/clínico preservados; sem cancelamento real de teste |

**133 testes dirigidos únicos/7 arquivos PASS**, incluindo11 da nova conferência WAF e a revisão do aceite/backup gerenciado. Fixtures testam o contrato de configuração e os handlers reais com dependências sintéticas; não executam o motor WAF Vercel. Testes de normalização/query/barra final/headers Next-Action/x-matched-path, GET/HEAD e preservação de webhooks/login exigem observação live após o GO. Só HTTP403 não prova contenção: registrar evento com regra/rota/deployment; divergência bloqueia B3.

### Checklist operacional único — B2-B/B3 e pontos de parada

Este é o checklist vigente. As tabelas de execução anteriores são históricas; não executar o TAR3902f200 como candidato corrigido. **B2-B e B3 exigem GO explícitos e separados no mesmo pedido consolidado. Nenhum GO foi dado neste ciclo.**

| Ordem | Ação / evidência exigida | Parada / recuperação |
| --- | --- | --- |
| 1 Alvo | qoro-prod/refshlcbxawrxuaebazuiue; projeto/time Vercel acima | Identidade diferente: não conectar/aplicar |
| 2 Responsáveis | Executor técnico desta sessão; operacional/incidentes/rollback e disponibilidade a confirmar pelo fundador | Não inventar responsáveis ou presença |
| 3 Janela | Proposta até60min após GO, com início/fuso registrados; não há reserva de horário confirmada | Tempo excedido: preservar contenção/obrigações e encerrar sem próximo gate |
| 4 OPS_ROOT | HEAD final verde do PR53, SHA e CI exatos no readback do PR | Commit posterior: checks próprios antes da janela |
| 5 RELEASE_ROOT | Aplicação44323990…, TAR6038df0d…/234700800bytes/2787files; SQLref94f6da4a,160hashes,manifesto;0136–0159 somente | Hash/manifesto diferente: parar, não regerar/mesclar TISS/UI |
| 6 Backup ativo | Nova leitura administrativa, último físico COMPLETED, sem falha atual ocultada; workflow legado ativo/caracterizado | Backup ausente/stale/falha atual: parar; aceite B1-B não dispensa continuidade |
| 7 Recuperação | Registro DEFERRED_RISK_ACCEPTED_NOT_VERIFIED com autor/data/referência; sem simular checksum/restore | Não pedir restore/host B1-B nem registrar PASS |
| 8 Executor B3 | Windows nativo com psql17.5 já usado no B2-A TLS; modo explícito --allow-windows-deferred-recovery, revisão de metadata e ACL privada;6provas Windows PASS | Nenhum Docker/restore/arquivo de backup real; CI/Actions recusados. SQLwriteWindows não executado nesta rodada; requer GO B3 |
| 9 B2-A fresco | Operador validado READ ONLY, prefixo136/24hashes/schema/RLS/locks/timeouts; fingerprints financeiros e inventário | Drift/concorrrência: parar, nunca editar journal |
| 10 Snapshot B2-B | Captura privada integral WAF e flags não secretas, IDs de deployment/versão/hash; renovada imediatamente antes da alteração | Alteração concorrente: comparar/preservar; snapshot histórico não é rollback atual |
| 11 GO B2-B | Aplicar só regra exata/ordem/flags aprovadas; manter status/webhooks/login/Asaas | Sem GO, sem escrita; negar caminhos excessivos exige reversão só da própria mudança |
| 12 B2-B live | Probes sintéticos não monetários; evento WAF com ID, rota e versão; controles de normalização/bypass; serviços legítimos intactos | Sem correlação inequívoca: B3 não inicia |
| 13 GO B3 | Aprovação específica do pacote/SQL/deploy fechado + revisão do backup/risco | Aceite B1-B ou GO B2-B não libera SQL/deploy |
| 14 SQL | Mesmo psql/TLSverify-full; lock4242, transaçãoSERIALIZABLE, prefixo/hashes;24SQL+journal;60sstatement/2slock/15minprocesso | Erro/timeout/commit ambíguo: readback; sem retry cego/DOWN |
| 15 Pós-voo | Journal160/ordem/hash, policies/funções/triggers/índices/FKs; fingerprints legados preservados e schema futuro correto | Inconsistência: preservar evidência; sem apagar histórico/recebíveis |
| 16 Deploy | Publicar/promover somente o artefato aprovado com flags fechadas e novo deployment; sem merge automático | Rollback de código usa deployment anterior identificado, mantendo WAF/obrigações e avaliando schema compatível |
| 17 Smoke | Login/MFA/áreas clínicas/assinatura/cancelamento disponível sem cancelar; cadastro/checkout fechados; runtime/consumers off | Indisponibilidade clínica/financeira: parar e reverter código/configuração autorizada |
| 18 Monitoramento | Sentry/latência5xx/inbox/outbox/leases; Asaas e pagamentos de pacientes continuam operacionais | Nunca desligar cron compartilhado ou obrigações antigas por fechar aquisição |
| 19 Evidências | SHA/TAR/journal/snapshots/IDs/tempos/probes/resultado; sem dados sensíveis | Evidência ausente impede alegar PASS |
| 20 Encerramento | Deployment identificado, aquisição fechada comprovada, nenhum consumidor live novo; relatar C/D ainda não executados | Sem abertura automática, sem piloto/expansão automática |

### Operador B3 e revisão explícita do risco

O modo anterior com cópia cifrada/restauração continua disponível e estrito. O novo modo de **preparação** aceita revisão `APPROVED_FOR_B3_WITH_DEFERRED_RESTORE`: projeto exato; reviewer; referência de aceite/autor/data; arquivo privado de metadados administrativos e seu SHA256. A evidência deve declarar MANAGED_BACKUP_METADATA_VERIFIED/AUTHENTICATED_SUPABASE_ADMIN_METADATA, observedAt, latestBackupStatus COMPLETED, backup.id/type physical/status COMPLETED/createdAt, downloads0 e restoreVerifiedfalse.

Exige consulta de metadados com no máximo30min e último backup diário com no máximo26h (margem operacional26h, não RPO/SLA contratado). Backup futuro, falho, metadata stale, projeto/hash divergente ou um restore falsamente alegado são recusados. Audit registra backupId, checksum real nulo, recuperação DEFERRED, autor/data/referência, além do GO B3 próprio. **Não há flag genérica que simplesmente pule backup; não foi executada aplicação real.** A validação de prefixo/hash/TLS/lock/transação/commit/readback foi preservada e as nove provas PostgreSQL continuam no gate CI. A CI do novo SHA é obrigatória.

### Execução nativa Windows limitada ao novo escopo B3

A limitação Linux-only impediria executar esta proposta sem outro ambiente. Foi preservada para a via de cópia/restore real e acrescentada uma opção explícita **--allow-windows-deferred-recovery**, somente junto da revisão APPROVED_FOR_B3_WITH_DEFERRED_RESTORE e da aprovação própria --authorize-production-migrations/--approval. Esse modo pode aplicar o SQL autorizado; **metadata-only descreve apenas a evidência de backup, não torna migrations read-only**. Ele não abre/decifra dump, não executa pg_dump/GPG/Docker, não lê dados de pacientes para arquivos e não autoriza dados reais em Actions. CI/Actions são recusados em ambas as plataformas.

Arquivos JSON de revisão/metadados têm limite64KiB, lstat/anti-symlink; revisão, metadados e diretório de evidência devem passar por ACL nativa: proprietário atual, apenas proprietário/SYSTEM, herança do diretório protegida, acesso necessário e nenhum reparse point nos ancestrais. PowerShell recebe apenas caminhos via stdin e ambiente OS mínimo, sem PGPASSWORD/credenciais. Subprocesso com timeout/erro é recusado sem expor detalhes. A via Linux/POSIX/restore estrito permanece disponível.

**6 provas nativas Windows PASS em08:18:37UTC**: opt-in de plataforma; rejeição da via de backup real; ACL de pasta; ACL de arquivo herdado privado; rejeição de ACL comum do repositório; rejeição de tipo errado. Cliente real psql17.5 confirmado, mesmo cliente que executou o B2-A verify-full. A identidade de arquivo e hashes/age do review têm regressões dirigidas. O arquivo marcador contém somente synthetic:true/medicalData:false e foi preservado na pasta privada. Não houve DDL Windows, banco sintético local ou processo pesado. As nove provas PostgreSQL remotas verificam a transação SQL portável, não uma migration real desta máquina. A execução futura exige readback/TLS/prefixo/backup frescos e GO exatos.

Exemplo **somente para uma janela B3 autorizada**, com caminhos privados, variáveis de processo já fornecidas de forma segura e sem credenciais em argv:

```powershell
node --conditions=react-server --import tsx scripts/abacatepay-release-apply.ts --authorize-production-migrations --allow-windows-deferred-recovery --approval $GO_ID --project shlcbxawrxuaebazuiue --release $RELEASE_ROOT --backup-review $REVIEW_JSON --evidence $EVIDENCE_JSON
```

Não executar o comando nesta preparação. O GO B3 deve identificar expressamente Windows nativo/psql e o modo de revisão de backup gerenciado com B1-B adiado.

### Gate C / piloto e decisão remanescente

Catálogo live atual PASS por GET; webhook live **não registrado**, runtime/consumers **não ativados**. Gate C exige GO próprio para endpoint, autenticidade/inbox/dedup, consumidores/cron/scanner/leases/alertas e reconciliação. HTTP200 não equivale a invoice/entitlement aplicados. Usar a matriz de12 provas do [runbook operacional](../../runbooks/abacatepay-operacao.md), sem criar outra documentação concorrente.

R1–R4 continuam PARTIAL em evidência, aceite residual limitado ao eventual piloto assistido1clínica; renovação13/12/2026 futura. D exige clínica/plano/preço/consentimento/responsáveis e GO financeiro específicos; expansão1→3→10 exige decisão por etapa. Checkout/cancelamento/entitlements/renovação sintética anteriores preservados; nenhum novo pagamento ou cancelamento externo de teste.

**Quatro estados:** candidato técnico PASS na baseline; novo HEAD aguarda seus checks. Pronto para B3 PARTIAL até CI final e confirmação de responsáveis/janela. Executor Windows nativo preparado com opt-in/ACL; sem exigir outro ambiente B1-B. Production com aquisição fechada NÃO IMPLANTADA. AbacatePay comercialmente ativa NÃO. O formulário consolidado B2-B/B3 só pode ser submetido como executável após esses itens; GO de uma etapa não libera a outra. Nenhuma AWS/VM/cofre B1-B será solicitada neste ciclo.

## Checkpoint prevalente — autorização e execução de 16/11/2026

O novo prompt mestre autoriza desenvolvimento/ensaios sintéticos e **B2-A somente leitura**. R1–R4 continuam PARTIAL em evidência, agora com aceite residual **limitado ao eventual piloto assistido de UMA clínica**. Não autoriza selecionar clínica, cobrar, abrir aquisição ou saltar gates. Renovação natural prevista para13/12/2026. Os checkpoints anteriores são históricos quando divergirem desta autorização.

**B2-A executado: PASS pontual.**16/11 03:54:12–03:54:27UTC, projeto `shlcbxawrxuaebazuiue`, endpoint direto `db.<ref>.supabase.co:5432`, libpq verify-full/CA oficial, transação READ ONLY, statement10s/lock2s.136 entradas por ordem/hash e24 pendentes0136–0159; zero locks esperando/transações longas. Fingerprint de histórico `1f2a641215d3e5328999acaf7028c46ab4782c7d596134d979bc31f9c50f91fc`; catálogo crítico `49e1c98a71abbbfe1e55cb4204a4ef814956e5c3e7f4925daddd727c30a6efe3`. Revisão complementar03:55:34UTC:0051/0093/0124 compatíveis, zero índices inválidos/FKs não validadas. Nenhuma linha de paciente, contrato, invoice ou ledger consultada. **Novo readback obrigatório imediatamente antes de futura DDL; isso não libera B3.**

O pooler foi recusado primeiro pela CA genérica e depois por ausência de SSL no backend observado. Guardas preservados; a sessão direta passou. A extensão do transporte aceita somente endpoint direto exato/usuário postgres/5432 ou pooler identificado do projeto, com verificação posterior da sessão. CA obtida de fonte oficial Supabase, source `8e2fd7c578266ffec80f87d00c5dfe8722b16044`, fingerprint256 `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`; sem alterar trust store. Evidência registra o hash do transporte usado antes de seu commit; não atribuir essa versão à antiga CI.

Metadados Vercel03:39:31UTC confirmaram Production `dpl_2gHasgxKuWkFY8ct1w56VLeHDhQP`, source/main `5620a0987ec53db7d7358728eb7d457d9d373df3`. Nomes/escopos das variáveis conferidos, valores não expostos/modificados.

### Cancelamento obrigatório antes do B3

**Asaas na main:** `/configuracoes/assinatura` → **Cancelar assinatura** → confirmação → `requestSubscriptionCancellationAction` → permissão fresca manage:settings/tenant → `removeSubscriptionCharges`: pausa INACTIVE, remove pendências da recorrência e avulsas conhecidas, relê para comprovar → transação idempotente `requestSubscriptionCancellation`, auditoria e revalidação. INACTIVE sozinho não remove cobranças existentes. Conserva invoices pagas e acesso até o fim pago; não é reembolso nem cancelamento de cobrança de paciente. Falha inconclusiva impede confirmação local definitiva e permite retry seguro. A ação e o helper não diferem entre main e candidato.

**Regressão reproduzida e corrigida:** `getDeferredSubscriptionOverview` validava o runtime AbacatePay antes de descobrir schema/origem da obrigação. Configuração nova desarmada derrubava a página e impedia alcançar o cancelamento Asaas. Agora consulta schema e origem persistida primeiro; Asaas permanece independente, origem desconhecida é recusada e AbacatePay desarmada não cai no gateway Asaas. Duas reproduções falharam antes da correção; quatro regressões passaram depois. Sem mudança de contratos, valores ou períodos.

**AbacatePay:** Cancelar renovação → confirmação → POST `/api/billing/cancellation` → autenticação/permissão/origin/tenant → binding persistido conta/ambiente/geração → intenção/journal duráveis → GET/POST cancel/GET → confirmação/auditoria. Resposta perdida exige releitura, não nova operação financeira cega. A UI confirma apenas `renewal_cancelled`; acesso pago permanece e recontratação ocorre somente após esse período. Eventos duplicados/atrasados não revogam um ciclo novo já pago.

O workflow `billing-cancellation.yml` testa sequencialmente **main/schema136, main/schema160 e candidato/schema160**, com PostgreSQL real e gateway contratual sintético. Cobre pausa, remoção/releitura, perda de resposta, rollback/retry SQL, invoices/direitos, duplicidade, trial sem obrigação e RLS. Reutiliza `signup-free-trial-db.ts --shared-schema` para AbacatePay. Cinco novos E2E verificam apresentação/HTTP sintético, confirmação/falha/pendência/reload/foco/teclado e390/1280px; não substituem a prova de persistência. Resultados e runs finais ficam no dossiê/evidência; preparado não significa PASS. Nenhuma assinatura real cancelada.

**Segundo defeito confirmado pelo ensaio de falha:** o Asaas podia remover uma cobrança e perder a resposta; a releitura comprovava ausência, mas o helper não devolvia esse ID para reconciliar a invoice local. A main normal continua oferecendo cancelamento, porém esse cenário de resposta perdida fica **PARTIAL** até webhook/revisão, não é uma prova de consistência local completa. O candidato agora devolve todos os IDs conhecidos cuja ausência foi confirmada, inclusive retry/404/resposta perdida; não repete DELETE nem modifica invoice paga. A nova regressão e os testes da ação/contrato passaram43/43 localmente. O ensaio PostgreSQL compara honestamente essa lacuna da main com a correção do candidato, usando o resultado real do helper para a persistência, sem status/IDs artificiais. Nenhuma mudança na main ou em assinatura real.

### Revisão explícita do pacote

Original94f6da4a/TAR3902f200… e sua atestação preservados. `gate-b-cancellation-candidate.ts` verifica o original e aplica **somente** `deferred-checkout.ts`, `cancellation-charges.ts`, seus dois testes e `saas-cancellation-revision.json`, com fonte `44323990b3f1fb9282418fec44a3182b02148c66`.160 SQL/journal/manifesto/UTF8 permanecem idênticos, sem0160/0161/0162, UI ou TISS funcional. Não exporta o HEAD operacional como aplicação. O TAR revisado exige hash próprio, Next build real sem harness e paridade dos fontes após build, CI/revisão novas. Não reutilizar a atestação anterior para conteúdo alterado.

### Continuidade, infraestrutura e parada

Falha histórica43597806257 esclarecida pela anotação do check132455944005: **GitHub não iniciou o job por pagamento recente da conta ou limite de gastos**; a anotação não distingue qual. Nenhum step de dump executou. Sem download de logs/artifacts/backups reais. `db-backup.yml` continua ativo/inalterado até continuidade substituta comprovada e aprovada.

Operador `recovery-scheduled-backup.ts` e units `ops/recovery` preparados para Linux protegido fora de Actions: credenciais systemd cifradas, verify-full/CA/read-only, stream pg_dump→GPG AES256, passphrase em FD privado, keyring exclusivo, lock, cancelamento/timeout, cifra0600, publicação somente após autenticação/rodapé/SHA256, retenção7dias/mínimo2 gerações e health horário com atraso26h. Notificação Sentry sanitizada/retries limitados; ingestão não comprova recebimento no canal. O ensaio real sintético não instala nem ativa essa rotina. Não cobre binários Storage/configurações Auth gerenciadas; continuam no plano de recuperação separado.

Não há AWS CLI/perfil local configurado comprovado. Teto condicionalUS$20 exige conta/role, custo total, responsáveis e destruição controlada; nenhuma infraestrutura criada. VM temporária não resolve rotina diária por si só. Plano/retenção Supabase atuais ainda dependem de acesso administrativo verificável; oito backups não determinam o plano. Notebook continua excluído de operação pesada/dados reais.

**B1-B BLOCKED:** falta host/volume/rede/TLS/cofre recuperável/responsáveis e GO específico de tratamento de dados reais. **B2-B não executado:** requer snapshot/IDs exatos de regras e deployment/rollback/responsáveis. **B3 não executado:** exige também restauração real atual, B2-A fresco, contenção comprovada, CI/TAR final e GO operacional. Webhook/consumidores live, piloto e expansão não ativados. R1–R4 não dispensam esses requisitos.

**Intervenção mínima:** acesso legítimo à conta/role AWS aprovada ou host Linux protegido existente; responsáveis técnico/recuperação e operacional/incidentes; destino/região/cofre e escopo/retenção/descarte do B1-B; plano/retenção pelo painel Supabase. Depois será possível fechar custo/controles e solicitar GO dos dados reais. Janela B3 e abertura financeira permanecem decisões separadas. Handoff UI continua em [HANDOFF-UI-BILLING-SaaS.md](HANDOFF-UI-BILLING-SaaS.md); nenhum worktree UI/TISS alterado.

### Resultados efetivamente executados — runner Linux, 16/11

[Workflow43804391473](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43804391473), source operacional23cef35f: **27 verificações PostgreSQL PASS** (main136:8; main160:9; candidato160:10), mais **52 da jornada AbacatePay PASS** com HTTP contratual sintético/zero rede externa. Main permanece PARTIAL no caso específico de resposta perdida/invoice local pendente; a correção no candidato reconcilia essa invoice e preserva período pago. Não significa cancelamento de cliente real ou nova homologação externa.

**Build exato revisado PASS**, Node22.23.4/Next15.5.28,161.267ms, exit0, sem harness e com paridade de fontes. TAR **6038df0da3a6afaee68528c2f38c08743356ef6bdf6ece7ca808fd41672d0e64**,234.700.800bytes,2.787 arquivos,160 hashes SQL iguais; base3902f200… preservada. `patchedFiles` discrimina dois arquivos de runtime e seus dois testes; o HEAD operacional não substituiu a aplicação. Source artifact privado14197807651; relatórios sanitizados14197777770. A CI final/E2E é verificada por readback do SHA exato em [PR53/checks](https://github.com/joaomarcos-techia/Project_OS/pull/53/checks); o fechamento após o commit está no registro do PR/Actions, sem transferir o GREEN doff829f0e.

**Backup recorrente sintético PASS7:** pg_dump/GPG/psql reais, TLS, restauração UTF8 no segundo banco, exclusão concorrente, indisponibilidade, cancelamento real/sem parcial, adulteração e retenção/freshness. Recursos sintéticos descartados; GPG agent exclusivo encerrado. Units verificadas no runner, substituindo apenas o caminho Node pelo binário instalado; não instaladas. Sem dados reais e sem desativar o workflow antigo.

Metadados WAF04:33:40UTC: firewall ativo,versão3; regras ativas `rule_rate_limit_login_CSaHZ7` e `rule_rate_limit_webhook_meta_NIuAge`, ambas rate_limit. **Nenhuma regra de aquisição fechada aplicada ou observada**. Snapshot sanitizado/hash22cc40be… não contém condições/IPs e não substitui snapshot privado integral de rollback. B2-B continua pendente de responsáveis/GO/configuração exata.

## Ciclo final — operadores executáveis e paradas de autorização

Baseline reconfirmada: PR53 OPEN/draft, HEAD6aa4b61764e5122989fb96ee4854afae62cd02de, CI43773892091 GREEN (7.270 testes/642 arquivos/22 E2E/zero SKIP). Alteração atual limitada a operadores/testes/documentação; **novo HEAD exige CI própria, cujo resultado será registrado no PR53**. Financeiro94f6da4a, TAR3902f200… e manifesto160 preservados;0136–0159 somente, sem0160/0161/0162. Restore sintético Linux PASS20 e build composto PASS são evidências anteriores aceitas, não novas execuções. Não houve Docker/build pesado, consulta SQL/backup real ou mutação Production no notebook.

**Defeitos operacionais confirmados e correções preparadas:** o preflight antigo importava o pool compartilhado com SSL require, que não verifica certificado/hostname. scripts/abacatepay-preflight-transport.ts agora usa libpq/psql verify-full, CA explícita, ambiente mínimo, SQL via stdin, uma transação REPEATABLE READ READ ONLY, limites10s/2s e prazo do processo30s. Verifica SSL/timeouts e interrompe por locks esperando ou transações >30s. Nenhum guard do runtime financeiro foi modificado. scripts/abacatepay-preflight-catalog.sql contém somente catálogos/histórico; não acessa linhas clínicas.

O operador genérico db-migrate-prod.ts mantém o advisory lock numa conexão e abre o migrator em outra, usa require e não comprova os timeouts da sessão que aplica SQL. **Não será o aplicador deste Gate B.** O novo scripts/abacatepay-release-apply.ts roda em Linux com psql/verify-full, CA explícita/session pooler5432, mesma conexão/transação SERIALIZABLE para lock4242, conferência do prefixo136,24 migrations, journal e fingerprints legados de subscriptions/plans/prices. Limites efetivos na própria transação: statement60s, lock2s, idle-in-transaction60s; processo15min. Drift/lock/fingerprint alterado aborta. Hashes SQL são relidos/conferidos antes de envio; o TAR não é reconstruído.

B3 exige flag explícita, ID de aprovação, revisão de backup da mesma origem com idade máxima4h, SHA da cifra privada e evidência de restore estrito0/0/prefixo136/24 pendentes/índices e constraints íntegros. O arquivo de evidência novo é reservado com wx/0600; tentativa parcial ou anterior bloqueia replay no mesmo caminho. Resultado sem confirmação de COMMIT ou falha posterior exige readback e decisão, sem alegar rollback automático, retry ou DOWN. Essas condições são guardas operacionais, não substituem a autorização humana B3. O pós-voo de schema/serviço continua obrigatório. Janela de4h/limite de idade não significa RPO garantido.

**Validação nesta rodada:**50 testes unitários dirigidos PASS/3 arquivos, sem banco/rede e sem suíte pesada local. Nove provas adicionais foram inseridas no PostgreSQL descartável do gate security:tenant já existente: TLS positivo, hostname errado, CA errada, RLS/hash divergentes; rollback de DDL/journal por erro na13ª migration; preservação de fingerprints; lock ocupado;24 aplicações únicas com replay recusado. **Execução remota dessas nove provas ainda PENDING CI neste checkpoint**; não são migrações do pacote real nem restauração Production. Tipos/lint/segurança/build/E2E do novo SHA serão confirmados na CI. Não repetir o workflow dedicado de restore/build do TAR, que não mudou.

### B2-C — checklist executável, sem autorização de execução

**Follow-up da CI:** o run43789700633 identificou a exigência de NODE_ENV na tipagem dos subprocessos, corrigida com valor fixo sem herança externa. O run43792354714 aprovou7.304 testes/644 arquivos e as9 novas provas PostgreSQL, mas o build isolado omitiu os imports dos operadores. A allowlist dessa cópia agora inclui explicitamente5 arquivos TypeScript e o SQL de catálogo, sem copiar scripts inteiros ou .env; uma regressão confere também os imports transitivos. O TAR congelado não foi alterado. O resultado completo do novo SHA será registrado no PR53; esses dois runs não são GREEN nem aprovação final.

Preparar OPS_ROOT (checkout dos operadores do HEAD final verde), RELEASE_ROOT (extração do TAR congelado), EVIDENCE_ROOT privado e APPROVED_PROJECT_REF somente no host alternativo aprovado. Operadores e SQL do produto têm proveniências distintas: novos operadores no OPS_ROOT, app/SQL no RELEASE_ROOT. Nenhum .env Production, DB/key ou cifra deve passar pelo notebook/Actions. Segredos de processo e PGSSLROOTCERT vêm do cofre autorizado. Executar comandos abaixo somente após a autorização da respectiva linha, com saída sanitizada para evidência privada; não interpolar URI/senha em argv.

| Etapa / pré-condição             | Comando/procedimento futuro                                                                                                                                                                                   | Resultado e evidência exigidos                                                                                                              | Parada / responsável / recuperação                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| B0 — fontes aprovadas            | git rev-parse HEAD no OPS_ROOT; conferir CI pelo SHA; sha256sum do TAR já aprovado                                                                                                                            | HEAD de operadores verde e SHA3902f200…; manifesto160 e exclusão0160/0161/0162                                                              | Divergência: parar sem regerar TAR; técnico recompõe proposta, não altera source                                                             |
| B1-B — host/dados aprovados      | Roteiro B1-B deste documento; restore pelo operador específico                                                                                                                                                | Cifra atual íntegra, GPG/psql0, journal e integridade, revisão de paridade e cofre; manifesto privado assinado operacionalmente             | Sem prova: nenhuma DDL; responsável de recuperação preserva original e trata o destino isolado                                               |
| B2-A — leitura aprovada          | node --conditions=react-server --import tsx scripts/abacatepay-release-preflight.ts --release "$RELEASE_ROOT" --ref 94f6da4aeb32b1ae7da856dc9afa105120ce6dd9 --project "$APPROVED_PROJECT_REF" --phase before | PASS_READ_ONLY_PREFLIGHT, TLSverify-full, prefixo136 exato/24 pendentes, schema crítico, SSL/timeouts corretos, zero waits/long tx          | Qualquer BLOCKED/drift: parar; técnico investiga em leitura, sem reparar journal                                                             |
| B2-A — catálogos suplementares   | psql -X -w -qAt -v ON_ERROR_STOP=1 -f docs/decoupling/asaas-to-abacatepay/migrations/gate-b-catalog-readonly.sql, com PG\* protegidos e verify-full                                                           | Funções/policies/triggers/índices/FKs/dependências/configurações comparados ao ensaio/manifesto; revisão não automática                     | Mudança inexplicada ou permissão insuficiente: parar; responsável banco revisa o diff, sem GRANT/DDL                                         |
| B2-B — contenção aprovada        | Conferir/aplicar somente flags/coorte e regras WAF exatas da matriz vigente; registrar versão/regra/escopo                                                                                                    | POST /api/signup/sessions e /api/signup/checkout fechados; status/webhooks/login/Asaas legados intactos; proteção backend também comprovada | Bypass/rota alternativa/obrigação AbacatePay incompatível: parar; operador contém novas vendas sem desligar obrigações                       |
| B3 — SQL explicitamente aprovado | Novo aplicador abaixo, após revalidar preflight/backup e ausência de DDL concorrente                                                                                                                          | PASS applied_and_checked ou already_applied verificado;160 entradas e contratos intactos                                                    | Erro/timeout: ler evidência/journal; nenhum retry cego ou DOWN; banco/incidentes decide rollback transacional observado ou correção à frente |
| B3 — pós-voo                     | Mesmo preflight com --phase after e catálogo suplementar; comparação de fingerprints legados                                                                                                                  | 160 entradas exatas,22 relações críticas seguras, origem/período/índices íntegros e schema suplementar revisado                             | Falha: não publicar runtime sobre schema parcial; técnico mantém contenção e investiga                                                       |
| B3 — deploy fechado autorizado   | vercel deploy --prod a partir do RELEASE_ROOT, apenas após GO; build novo com flags Production aprovadas                                                                                                      | Domínio/SHA/pacote/flags efetivos, entrada fechada, consumers AbacatePay no-op e cron/Asaas/obrigações antigas saudáveis                    | Código divergente/abertura/5xx: parar; rollback de código/config aprovado e compatível com schema, sem desfazer fatos financeiros            |
| Encerramento B3                  | Registrar UTC, resultados, responsáveis e estado das regras/filas                                                                                                                                             | Acquisition fechada comprovada; Gate C permanece NOT AUTHORIZED                                                                             | Não retirar barreira/abrir allowlist automaticamente; responsável operacional encerra a janela                                               |

Executar os comandos Node a partir do OPS_ROOT, sem arquivo .env Production; a importação tsx deve resolver no checkout verificado. Para o aplicador B3:

```bash
# FUTURO; somente após B1-B, B2 e autorização expressa B3.
node --import tsx scripts/abacatepay-release-apply.ts \
  --authorize-production-migrations --approval "$APPROVAL_ID" \
  --project "$APPROVED_PROJECT_REF" --release "$RELEASE_ROOT" \
  --backup-review "$PRIVATE_BACKUP_REVIEW" --evidence "$PRIVATE_NEW_B3_REPORT"
```

PRIVATE_BACKUP_REVIEW é preparado pela engenharia **após** a prova real e revisão de paridade, não por suposição do titular: JSON privado com decision=APPROVED_FOR_B3, project, backupCreatedAt UTC (ponto do snapshot, não data do restore), backupFile, backupSha256, restoreEvidenceFile e reviewedBy. O restoreEvidenceFile é a saída original do gate-b-isolated-restore.ts. Sua presença/flag não é autorização de Production; registrar a aprovação do titular separadamente. Nenhum desses arquivos reais foi criado/lido nesta rodada.

### Ambiente exato proposto para B1-B, ainda não contratado

Proposta B: **AWS EC2 m7i.xlarge, Linux x86_64,4vCPU/16GiB, sa-east-1 (São Paulo),4h de operação e no máximo24h de existência**, disco raiz/dados EBS cifrado100GiB inicial (confirmar tamanho), IAM/MFA/acesso administrativo privado restrito, sem IP/porta pública de banco, egress fechado antes da decifragem, Docker local/rede none/cron off, cofre/chaves fora da VM, sem swap/hibernação/core dumps ou snapshots automáticos. Bootstrap/imagem e acesso ao cofre precedem os dados; qualquer exceção de saída para o dump é removida antes do restore. Acesso por canal privado/SSM e eventuais endpoints/NAT precisam de orçamento e regras específicos; não assumir infraestrutura existente.

Consulta **pública**, sem conta/contratação, em16/11 01:39UTC (15/11 Brasília): [tabela AWS São Paulo/Linux](<https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/South%20America%20(Sao%20Paulo)/Linux/index.json>), rateCode66JHFKUSK6NVZM7E.JRTCKXETXF.6YS6EN2CT7: **US$0,3213/h somente compute**;4h=US$1,2852 e24h=US$7,7112. EBS/rede/endpoints/NAT/KMS/egress/impostos/câmbio não estão incluídos. **Teto proposto US$20/janela, sujeito a cotação total na conta e aprovação; não é teto automático do provedor nem custo autorizado.** Não iniciar se o total projetado exceder o teto ou exigir recurso desconhecido. Nenhuma conta/VM/regra/volume/chave foi criada. Alternativa A só se houver outra máquina Linux aprovada; C continua sem garantia de conter jobs antes do restore físico. Uma VM24h não é solução de agendamento diário permanente.

**Windows:** GPG7/7 e ACL9/9 históricos permanecem válidos no seu alcance. Ctrl+C da cadeia Docker/psql no Windows continua NOT RUN, sem ser inferido do Linux. Não é requisito do operador B3 Linux-only proposto; tratar NOT APPLICABLE para esse destino, não como PASS Windows. Uso futuro em Windows exige seu próprio runner/escopo e validação; não adicionar compra/runner pago nem repetir notebook para isso.

**Estados atuais:** preparação e testes unitários PASS no alcance indicado; provas PG novas dependem da CI. B1-B BLOCKED por ambiente/segurança/responsáveis/custo/retencão e NOT AUTHORIZED para dados; B2-A/B2-B/B3/C/D/E NOT AUTHORIZED. GO-READY deploy controlado BLOCKED até recuperação real/preflight atual/controles/responsáveis comprovados. GO-READY comercial BLOCKED adicionalmente por Gate C, piloto e R1–R4 sem decisão. **Production NO-GO.**

## Notebook excluído e B1-B em ambiente alternativo — 15/11/2026

**DECISÃO DO RESPONSÁVEL: NOTEBOOK ATUAL DESCARTADO PARA RESTAURAÇÃO E BUILD PESADO.** Esta diretriz substitui as propostas anteriores de liberar RAM, pausar UI/TISS, iniciar Docker ou proteger este Windows para receber dados reais. Não houve nova medição de recursos, encerramento de processos, build/restore pesado, consulta SQL Production ou transferência de backup neste ciclo. O notebook fica restrito a documentação, análise leve e Git. Os checkpoints abaixo são históricos; instruções antigas de recuperação neste notebook ficam revogadas, não são uma autorização de execução.

**Baseline aceita:** HEAD documental `d3f27452b62ad631cfac8c4052c5785886768f16`, PR53 draft, [CI43769394816 GREEN](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43769394816), 7.270 testes/642 arquivos/22 E2E/zero SKIP. O [ensaio43768247372](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43768247372) encerrou restore sintético Linux **PASS20** e build composto **PASS**; não foram repetidos. Alterações desta rodada são apenas documentais e exigem checks próprios no novo HEAD, com resultado no PR, sem transferir a CI anterior.

Financeiro `94f6da4aeb32b1ae7da856dc9afa105120ce6dd9`, operadores de composição `787276a1843eae25bb03252512f849d7013abe18`, SQL `4d0ed1d5c8a81ab9f66e026f4f36c6e4520a7269` e TAR `3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6` preservados: 2.785 arquivos, 160 hashes SQL, pacote0136–0159, sem0160/0161. Nenhum novo TAR, código financeiro, migration ou configuração de CI foi produzido.

### Comparação dos ambientes para dados reais

| Critério            | A — outra máquina física aprovada                                                                                                             | B — VM privada temporária                                                                                                                                         | C — restore gerenciado Supabase                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disponibilidade     | Nenhuma máquina alternativa foi informada; não presumir que existe                                                                            | Nenhuma conta, região, VM ou orçamento aprovado                                                                                                                   | Requer plano pago/backup físico; plano atual ainda não conferido                                                                                                                      |
| Segurança           | Disco integral cifrado, SO atualizado, acesso individual/MFA, custódia física, temporários e swap protegidos                                  | Discos raiz/dados cifrados, acesso mínimo/MFA, chaves separadas, região e tratamento de dados aprovados; risco de novo operador de nuvem                          | Cópia contém dados Auth e chave-raiz de criptografia; novo domínio de acesso a proteger. Serviço gerenciado não comprova contenção de saída                                           |
| Isolamento          | Host dedicado durante a operação; Docker local, rede none, sem app/worker/portas, cron off                                                    | Quarentena do host antes dos dados, sem ingresso público ao banco; Docker local/rede none, sem app/worker/cron                                                    | Clone físico pode iniciar jobs externos antes de desativá-los. Restringir conexões de entrada não bloqueia egress; não assumir isolamento suficiente                                  |
| Capacidade proposta | 16GiB/4vCPU preferidos; 8GiB/2CPU apenas com margem comprovada e pelo menos4GiB físicos livres antes do Engine                                | Mesmo dimensionamento inicial; disco cifrado50–100GiB como reserva, sujeito ao tamanho real aprovado                                                              | Replica compute/disco da origem, cujo dimensionamento atual não foi lido. Não assumir Micro ou capacidade adequada                                                                    |
| Custo               | Infraestrutura incremental possivelmente zero **se já existir**, mais energia/tempo/transferência; não é compra autorizada                    | Estimativa de planejamento **US$5–20 por janela de até24h**, não cotação nem teto aprovado; depende de região, VM, disco, chaves, rede, egress, impostos e câmbio | Compute adicional por hora, disco e eventuais extras. Exemplo somente compute: Small US$0,0206/h; Large US$0,1517/h. Clone usa tamanho da origem, não preço escolhido arbitrariamente |
| Complexidade        | Média: comprovar capacidade, proteção e custódia em equipamento ainda desconhecido                                                            | Maior preparação de rede/IAM/chaves; contenção pode ser instalada antes da cópia                                                                                  | Menor trabalho de criação, mas contenção pré-inicialização não demonstrada e serviço completo não é clonado                                                                           |
| Riscos principais   | Perda física, acesso de outros usuários, swap/hibernação, limpeza incompleta                                                                  | Exposição por rede padrão, credenciais, snapshots, retenção e custos residuais; criptografia de disco não prova proteção da RAM                                   | Execução acidental de cron/pg_net/wrappers contra Production, credenciais copiadas; Storage/configuração gerenciada não recuperados automaticamente                                   |
| Evidências exigidas | Identidade/custódia, criptografia, política de memória/swap, capacidade, inspeções de rede/contêiner, códigos e manifesto de restore/descarte | IDs conta/região/VM/volumes, acesso/auditoria, cifragem, regras IPv4/IPv6/egress, teste sintético de contenção e inspeções; restauração e descarte separados      | Garantia verificável de contenção **antes do primeiro job**, recursos/custos/escopo, restauração/integridade; botão Restore não é prova                                               |
| Autorização         | Aprovar equipamento/operador e depois operações/dados B1-B; sem depender do notebook                                                          | Aprovar provedor/região/custo/provisionamento primeiro; aprovar dados e B1-B separadamente                                                                        | Aprovação específica de custo/novo projeto/dados/isolamento; atualmente não autorizado e sem contenção prévia comprovada                                                              |

**Recomendação condicionada: B**, uma VM Linux privada temporária sob administração aprovada pela Qoro, porque permite preparar a quarentena antes de receber dados. **A** pode substituí-la com menor custo se uma máquina existente satisfizer os mesmos controles; sua existência não foi confirmada. **C não é a opção padrão segura neste escopo**: o Supabase informa que jobs da cópia podem começar antes de serem desativados. Não propomos clonar e depois desligar cron, rotacionar segredos Production ou editar a origem para tornar o clone seguro. [Comportamento dos jobs restaurados](https://supabase.com/kb/troubleshooting/how-to-stop-pg_cron-jobs-from-running-on-a-restored-project-or-branch).

Referência de custo, não seleção de provedor: a [tabela pública Lightsail](https://aws.amazon.com/lightsail/pricing/) anuncia Linux8GB/2vCPU a US$44/mês e16GB/4vCPU a US$84/mês; esses bundles não comprovam a arquitetura privada proposta. A reserva US$5–20 é uma estimativa de engenharia para uma janela curta e deve ser substituída por orçamento regional discriminado antes de criar recursos. Não extrapolar preço mensal dividindo por horas, presumir créditos gratuitos ou converter para reais sem câmbio. Parar uma VM pode deixar cobranças de disco/IP; é necessário conferir descarte e cobrança residual. Para C, [compute Supabase](https://supabase.com/docs/guides/platform/manage-your-usage/compute) cobra horas inteiras e não é coberto pelo Spend Cap; créditos podem já estar consumidos. Nada foi contratado/cotado em conta autenticada.

O [clone oficial](https://supabase.com/docs/guides/platform/clone-project) aceita backup físico sem contratar PITR, permanece na região da origem e replica compute/disco. Copia banco e raiz criptográfica, mas exige reconstrução de Storage, Auth gerenciado e outros serviços. Essa alternativa não comprova B1-B lógico nem recuperação integral. As [restrições de rede Supabase](https://supabase.com/docs/guides/platform/network-restrictions) regulam entrada ao Postgres/pooler; não são uma garantia de saída bloqueada.

### Controles obrigatórios do ambiente alternativo

1. **Identidade, localização e acesso:** registrar conta/provedor, região física de processamento, ID do host, responsáveis e horário aprovado; validar requisitos de proteção de dados/contrato com o responsável. SO suportado/atualizado, acesso individual de curta duração, MFA e trilha administrativa sem payloads. Sem banco público, credenciais em user-data, shell history, CI, tickets ou notebook. A conexão administrativa deve ser definida e testada com dados sintéticos antes da cópia.
2. **Capacidade e memória temporária:** medir somente no novo ambiente aprovado; reserva de RAM física, CPU e disco conforme inventário autorizado. Não usar o notebook como salto para copiar/decifrar dados. Sem swap/hibernação/core dumps durante o processamento real, ou proteção equivalente formalmente comprovada. Tmpfs pode paginar se o host permitir: `memory-swap=memory` do contêiner não comprova proteção do host. Disco cifrado não equivale a RAM cifrada; necessidade de VM confidencial é decisão adicional de política/custo, não capacidade já comprovada.
3. **Cifragem e chaves:** cifrar raiz e dados, temporários persistentes e eventual swap; chave GPG recuperável em cofre separado, com acesso mínimo e responsável. Não usar keyring pessoal. Uma referência de implementação é [EBS/KMS](https://docs.aws.amazon.com/ebs/latest/userguide/how-ebs-encryption-works.html); não presumir que uma conta ainda não selecionada tem isso habilitado. Não depender do DPAPI deste notebook nem abrir/exportar os snapshots históricos aqui. Recuperação portátil do cofre deverá ser comprovada no ambiente aprovado antes dos dados.
4. **Preparação sem dados:** instalar ferramentas/pull da imagem fixada e verificar hashes antes de introduzir credenciais. Configurar e testar deny de saída IPv4/IPv6 e acesso administrativo restrito; regras padrão podem permitir toda saída. [Security Groups AWS](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) são uma referência, não firewall já aplicado; DNS exige controle adicional. Não alterar firewall Production. Exceção temporária apenas para origem PostgreSQL/TLS durante o dump autorizado; fechar essa exceção e confirmar ausência de sessões antes da decifragem/restore. Se houver regra Production incompatível, parar e solicitar mudança de escopo.
5. **Destino inerte:** operador executado **no host alternativo**, Docker no socket local legítimo `unix:///var/run/docker.sock`; nunca apontar Docker do notebook para SSH/TCP nem flexibilizar o guard. Contêiner `qoro-gate-b1-<12hex>` com ID completo/label, imagem oficial17.11 fixada/digest já ensaiado, rede none, sem portas/logs/volumes persistentes, PGDATA/tmp tmpfs,2GiB RAM/swap igual, cron off. Sem app Qoro, workers, SMTP, gateways ou credenciais Production no contêiner. Limites são os do operador aprovado: se insuficientes, parar e revisar o dimensionamento, não aumentá-los para forçar PASS.
6. **Auditoria e contingência:** guardar UTC, IDs, versões, regras, estágios, códigos de saída e hashes em destino privado; sem stderr bruto, SQL, dados médicos, tokens ou comandos de jobs. Falha de isolamento/TLS/hash/GPG/psql/capacidade/integridade encerra a tentativa; cópia parcial não recebe PASS. Preservar o backup original, conter somente recursos próprios e encaminhar o incidente aos responsáveis; sem migration/replay financeiro/restore sobre ativo.
7. **Retenção e descarte propostos, ainda não aprovados:** janela operacional4h, VM no máximo24h antes de revisão; dados decifrados somente em memória temporária e descarte ao encerrar. Cifra até7dias após o drill **somente em destino aprovado com chave separada**, nunca Actions; prazo não é sete dias depois de um B3 indefinido. Sem snapshots automáticos ou agentes de backup/telemetria que capturem dados. Confirmar saída de todos os processos, remover apenas contêineres/volumes/VM/chaves temporárias identificados e verificar recursos/snapshots/custos remanescentes. Preservar a cópia original conforme sua política; nenhum descarte de dados reais está aprovado neste ciclo. Extensão de prazo, transferência ou destruição exige escopo explícito; não prometer apagamento físico verificável da nuvem.

### TLS futuro, sem conexão neste ciclo

Preservar `backupConnectionEnv()` em `scripts/prod-encrypted-backup.ts`: `PGSSLMODE=verify-full`, timeout10s e transação somente leitura. No host aprovado e **após autorização B1-B**, conferir REF de qoro-prod, host/porta/usuário no painel, clientes pg_dump/psql compatíveis e CA confiável (`PGSSLROOTCERT` quando necessário), validade/SAN/cadeia do certificado e relógio. Host compartilhado do pooler exige também conferir REF/usuário; certificado válido sozinho não identifica o projeto. Não substituir host por IP incompatível com SAN, usar `require`/`no-verify` ou aceitar CA não validada para destravar. Registrar somente resultado da validação e identidade não secreta; nenhuma URI/chave em relatório. Uma falha TLS impede dump. Não houve handshake real ou importação de `.env` nesta rodada.

### Plano e retenção — única conferência humana ainda necessária do B1-A

B1-A encerrado no alcance aprovado: oito backups físicos COMPLETED e PITR desligado; não relistar nem repetir consulta. Para completar somente o que falta, no [Dashboard Supabase](https://supabase.com/dashboard/projects), abra qoro-prod e confirme a organização; nas configurações de **Billing/Subscription/Plan** dessa organização leia o plano vigente. Em **Database → Backups**, confira a retenção oferecida/documentada para esse plano, sem Restore/Upgrade. Informe apenas `plano atual / retenção documentada em dias / organização conferida / data da leitura`; sem fatura, chave ou lista dos backups. A [regra pública atual](https://supabase.com/docs/guides/platform/backups) é Pro7dias, Team14 e Enterprise até30; uma condição contratual diferente precisa de evidência do plano. O Pro observado em outubro é histórico, não confirmação de novembro. Recuperação física atual, ponto transacional e RTO continuam não comprovados. Não contratar PITR.

### Limite do GitHub e rotina antiga de backup

GitHub Actions permanece autorizado **somente para fontes e dados sintéticos**, sem segredos/backup/restore de Production, clones, migrations, deploy ou operações financeiras reais. O workflow sintético não será reutilizado para B1-B, nem repetido por esta mudança documental. A leitura estática encontrou `.github/workflows/db-backup.yml` com agenda diária, secrets Production, dump real e artifact cifrado30dias: **esse desenho é incompatível com a nova diretriz**. Não foi disparado, alterado, desabilitado ou consultado quanto a execuções neste ciclo; existência no código não comprova que esteja ativo no default branch. O responsável operacional deve decidir, em escopo separado, como retirar a dependência de Actions para dados reais e preservar a cobertura de backup. Não desligar uma rotina existente ou mover suas credenciais unilateralmente; não declarar essa lacuna resolvida.

**Resultado atual:** restore sintético PASS; build composto PASS, ambos já aceitos. **B1-B REAL NÃO APTO / NÃO AUTORIZADO:** não há host alternativo identificado, controles comprovados, custo/responsáveis/retenção aprovados ou TLS real validado. O [formulário B1-B abaixo](#pedido-1--b1-b-em-ambiente-alternativo-ainda-não-autorizado) separa autorização de infraestrutura da autorização dos dados. B2-A/B2-B/B3/C/D/E não autorizados, R1–R4 PARTIAL sem aceite, renovação natural13/12/2026 ainda futura. **Production NO-GO.** PR53 billing, PR55 TISS e PR56 UI permanecem separados; nenhum worktree alheio foi alterado.

## Ensaio remoto concluído — 15/11/2026

**Checkpoint prevalente: RESTORE SINTÉTICO PASS (Linux); BUILD COMPOSTO PASS.** [Execução dedicada `43768247372`](https://github.com/joaomarcos-techia/Project_OS/actions/runs/43768247372), operadores `59695b9b2e1c7cd7487d76ca02cc56796eb96f3f`, ambos jobs SUCCESS. Resolvido o impedimento de RAM para estes testes pelo runner padrão, sem usar a máquina Windows para Docker/build pesado e sem interromper Claude/TISS. Isto não demonstra capacidade/proteção do host local para dados reais.

| Verificação | Evidência observada |
|---|---|
| Capacidade remota | Antes do restore: 6.774 MiB físicos disponíveis / 10,76 GiB disco. Antes do build: 6.661 MiB / 9,51 GiB. Mínimo de 4 GiB preservado |
| Ferramentas reais | Docker Client/Server 28.0.4; PostgreSQL/pg_dump/psql da imagem 17.11; GPG 2.4.4; AES256 em stream. Dump, GPG e psql retornaram zero no caso positivo |
| Conteúdo recuperado | 3 tabelas, 2 pais, 3 filhos, 2 entradas de journal, 5 índices, 7 constraints, FK efetivamente rejeitando órfão e função retornando 3. Igualdade com snapshot da origem, UTF8, hash de conteúdo; zero órfãos/índices inválidos |
| Falhas reais | Senha errada GPG2/psql0; adulteração GPG2/psql3; truncamento GPG2/psql0; SQL inválido GPG0/psql3. Nenhum resultado aceito por psql0 isoladamente; hash, journal e conteúdo divergentes também recusados |
| Confinamento | Imagem oficial versionada, digest `c141fd17ac6a76c4323e90b3aee8ff1a23d2e89e547c2b963cfadc309c079cc2`; IDs completos, label, rede none, sem portas, logs none, PGDATA/tmp tmpfs, 2 GiB RAM/swap igual, cron off. Inspeções adulteradas de nome/label/rede/porta recusadas por contrato, sem criar contêineres inseguros |
| Interrupções reais Linux | Abort, deadline curto com AbortSignal, PostgreSQL encerrado e GPG encerrado sob backpressure. Cadeia rejeitada; filhos Docker/GPG fechados e destino parcial descartado. Não prova Ctrl+C Windows nem substitui a evidência unitária do timer interno de 120 s |
| Descarte antes do build | Todos os contêineres próprios removidos por ID/label conferidos; diretório sintético, cifras e keyring/agent exclusivos descartados. `cleanupComplete=true`, sem falha de limpeza; o build confirmou zero contêineres do ensaio |
| TAR exato | SHA256 `3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6`; 234.562.048 bytes; 2.785 arquivos/nome UTF8; 160 hashes SQL/journal ordenado; manifesto bf2775be…; 0160/0161 e código funcional TISS ausentes |
| Build real | Node22.23.4 / pnpm11.17.0 / Next15.5.28; instalação frozen zero; `node --max-old-space-size=4096 <extração>/node_modules/next/dist/bin/next build` zero em **245.025 ms**, após o restore. Lint/types do Next incluídos; 2.785 arquivos de entrada permanecem idênticos, sem harness injetado/alteração de lockfile |
| Avisos preservados | Depreciação `withSentryConfig` para futura versão11 e cache webpack de strings grandes, sem erro de build. Actions v4 usam runtime Node24 forçado pelo GitHub; o projeto foi compilado em Node22.23.4. Nenhuma atualização oportunista do pacote congelado |

Total **20 verificações integradas PASS**. Evidências permanentes: bloco `remoteSyntheticAndComposedBuild20261115` no [registro existente](evidencias/recuperacao-financeira-20261111.json), incluindo hashes dos quatro relatórios/logs; cópias locais em `dist/gate-b-ci-59695b9b`. Relatórios no Actions têm retenção de um dia. Os dois artefatos privados temporários de transporte foram removidos e a ausência foi conferida; cerca de469 MB liberados no Actions, com 19.051.128 bytes remanescentes no inventário do repositório naquele instante. TAR original e rascunho privado preservados. Nenhum dado real, passphrase, SQL decifrado ou saída `.next` foi enviado como relatório.

As tentativas iniciais FAIL ficam registradas: rascunho exigia token com acesso de push (403), dois objetos de teste sem NODE_ENV, argumentos de cron embutidos no bootstrap recusados pelo guard e CRON_SECRET sintético curto. Correções somente no ensaio/transporte; guard, código financeiro e SQL congelados preservados. O job de transporte tem `contents:write` e não executa checkout/código do projeto; a VM de execução tem apenas `contents:read`. Não copiar PAT/segredos para contornar esse limite.

**CI geral é gate independente:** conferir o HEAD final e seus checks no PR53; não usar apenas o workflow sintético ou a CI antiga como prova do novo SHA. O teste dedicado comprova o pacote TAR identificado, sem publicar/deployar o build. Foram usados runners padrão, timeouts de5/35 minutos e retenção curta; nenhum plano/orçamento foi aumentado. A API de billing não concede leitura do saldo atual da franquia, portanto não declarar custo financeiro zero medido.

**Devolução da máquina:** leitura22:24:22UTC /19:24:22 Brasília: RAM física livre1.032MiB/7.877MiB e C:17,05GiB. Variações de disco/RAM locais não são atribuídas a limpeza desta execução; nenhuma carga pesada local foi iniciada, nenhum processo alheio foi parado e nenhuma configuração Windows foi alterada. Claude/TISS podem continuar; a capacidade global da máquina não é reservada pelo operador.

**B1-B REAL: NÃO APTO / NÃO AUTORIZADO. PRODUCTION: NO-GO.** Faltam ambiente alternativo aprovado para dados reais (não este notebook; controles do host escolhido e TLS real), plano/retenção efetivos, procedimento/backup real identificado e responsáveis/autorização. O ensaio sintético remoto não valida backup físico gerenciado nem recuperação do serviço completo. B2-A/B2-B/B3, webhook/consumidores live, contratação real e aceite de R1–R4 permanecem fora da autorização. Não há novo desenvolvimento financeiro necessário para reconhecer os dois PASS acima.

## Alternativa remota autorizada — 15/11/2026

**Checkpoint prevalente:** o titular informou que não consegue liberar mais RAM e autorizou executar o ensaio no GitHub enquanto Claude retoma TISS. Não será iniciado Docker/build pesado local. O diagnóstico anterior e a CI GREEN do HEAD documental `5b80efa6` (run `43755905739`, 7.266 testes / 22 E2E / zero SKIP) permanecem como evidências históricas.

Workflow dedicado: `.github/workflows/gate-b-synthetic.yml`, somente branch AbacatePay, runner padrão `ubuntu-24.04`, limite de 35 minutos, sem secrets de Production e sem ampliação de orçamento. Dois passos sequenciais: `gate-b-synthetic-ci.ts` cria somente fixture sintética, executa ferramentas reais e descarta seus recursos; `gate-b-composed-build.ts` exige o descarte antes de extrair e compilar o TAR exato, sem injetar o harness de `security:build`. O mínimo de 4 GiB de memória física disponível continua obrigatório no runner. Nenhum resultado de execução remota é presumido nesta preparação.

O TAR original foi transportado para um **rascunho privado**, não publicado: `qoro-gate-b-synthetic-94f6da4a`, asset `752472125`, 234.562.048 bytes. O digest retornado pelo GitHub coincide com `3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6`. Apenas fontes já versionadas e a composição SQL congelada, sem dump/credenciais locais. A tentativa inicial de download com `contents:read` foi recusada pelo GitHub com HTTP 403: rascunhos exigem acesso de push. O transporte passa a um job separado de até cinco minutos, com token efêmero `contents:write`, sem checkout, instalação ou execução de código do projeto; somente download do asset fixo e SHA256. A próxima VM recebe esse mesmo TAR por artefato privado com retenção de um dia e tem apenas `contents:read`, checkout sem persistir credenciais e build com HOME novo/allowlist sintética. Nenhum PAT ou segredo de Production é copiado. Relatórios sanitizados têm retenção de um dia; nenhum banco, cifra de fixture ou saída `.next` será publicado. Não utilizar `db-backup.yml`, que acessa Production.

O teste de interrupção realizado nesse runner prova Linux. **Não comprova Ctrl+C/processos no Windows**, proteção do host local, backup gerenciado Supabase ou restauração real. Permanecem **B1-B real NÃO APTO/NÃO AUTORIZADO; B2/B3 não autorizados; Production NO-GO; R1–R4 PARTIAL sem aceite**. Código financeiro, manifesto, migrations e TAR não serão modificados. A CI do novo código de ensaio deverá validar seu próprio SHA.

## Diagnóstico nativo de RAM e decisões seguras — 15/11/2026

**Checkpoint prevalente:** UI/TISS continuam pausados por informação do titular. Autorizados diagnóstico somente de leitura e parada graciosa apenas de processos próprios comprovadamente descartáveis. **Nenhum processo atendeu a esse critério**, portanto zero encerramentos. Não houve nova solicitação de pausa dos agentes, acesso a Production, reset, limpeza de cache, alteração de serviço, pagefile/hibernação ou redução do mínimo de4GiB. Os três documentos locais do ciclo anterior foram preservados; este diagnóstico completa a atualização documental para um único commit/push no PR53 solicitado pelo titular, sem alteração de código financeiro/SQL/CI.

### Memória observada, sem atribuir variação à automação

Dados obtidos por CIM/contadores nativos, processos pais/executáveis e `code --status`, **sem emitir linhas de comando completas ou títulos completos de janelas**. Os metadados locais estão em `dist/memory-diagnostic-native.json`, `dist/memory-editor-origin.json` e `dist/memory-diagnostic-final-resources.json`. O resumo versionado omite caminhos de executáveis/perfil e conteúdo de janelas.

| Momento | RAM física disponível | Commit / limite | Disco C: livre |
|---|---|---|---|
| Início do diagnóstico,19:52UTC /16:52 Brasília | **1.378MiB /7.877MiB**; contador separado1.316MiB |12.223 /25.285MiB |10,84GiB |
| Após inspeção,19:58:57UTC /16:58:57 Brasília | **1.644MiB**; contador separado1.618MiB |12.207 /25.285MiB |10,86GiB |

Contadores coletados em instantes próximos, não snapshot atômico. A diferença de266MiB entre leituras é variação observada; **RAM comprovadamente recuperada por encerramentos nossos:0MiB**, pois não encerramos nenhum processo. Windows dispõe de memória virtual, mas isso não substitui4.096MiB físicos livres; na leitura final faltavam2.452MiB. Somar working sets pode contar páginas compartilhadas mais de uma vez; não prometer que fechar um grupo libera exatamente a soma mostrada.

### Processos e classificação

Valores aproximados do snapshot inicial. PIDs são históricos e devem ser revalidados antes de qualquer ação futura.

| Processo/aplicativo | PID(s) | RAM residente aproximada | Origem identificada? | Classificação / ação |
|---|---|---:|---|---|
| VS Code,23 processos | Principal27708; maiores3128,25416,20240 |**1.190,6MiB** somados;908,6MiB de working set privado | Sim, árvore do VS Code; worktrees por janela não totalmente comprovados | **PEDIR AUTORIZAÇÃO** para fechar janelas extras; preservar sessão atual. Não encerrar o processo principal |
| Janela/subprocesso Code3128 |3128 |476,7MiB | Filho do principal27708; sem atribuição confiável a TISS/UI | **PEDIR AUTORIZAÇÃO**; identificar a janela visualmente e salvar antes |
| Janela Code25416 |25416 |230,5MiB | `code --status` reconheceu workspace local; não prova que pertence ao TISS/UI | **PEDIR AUTORIZAÇÃO**; fechar normalmente somente se o titular reconhecer e salvar |
| Memory Compression |3208 |**1.071MiB** | Windows, filho de System4 | **PRESERVAR**; memória comprimida não é processo descartável |
| Serviços Windows,93 svchost | Vários |631,7MiB somados | Sistema | **PRESERVAR**; não desligar serviços para forçar o teste |
| WebView2,6 processos |25520 e filhos; pai SearchHost4936 |324,6MiB somados | Busca do Windows, não Chrome/Edge de teste | **PRESERVAR**; não encerrar por nome genérico |
| Claude |27220 |106,7MiB | Extensão Claude/VS Code, pai20240; papel TISS/UI não comprovado | **PEDIR AUTORIZAÇÃO**; pode manter sessão de trabalho pausada |
| Codex |28660,6352 |130MiB somados | Sessão ativa e infraestrutura do agente | **PRESERVAR**; encerrar interromperia o trabalho/ferramentas |
| Node das ferramentas Codex/CUA |20468,22584,16032 |8,1MiB somados | Executável CUA e ancestrais Codex/node_repl | **PRESERVAR**; não são builds descartáveis comprovados |
| Node Playwright test server |24200 |22,4MiB | Filho do extension host20240; listener somente local57890 | **PEDIR AUTORIZAÇÃO**; possível servidor de testes da IDE, sem atribuição comprovada ao TISS/UI |
| Serviço de suporte WSL |5420 |4,3MiB | `wslservice.exe`, filho de services.exe; não é VM vmmem nem Engine Docker | **PRESERVAR**, não parar serviço global |
| Chrome/Edge, Next/Vitest, PostgreSQL, Engine Docker/VM vmmem ativos | Nenhum identificado |— | Nenhum navegador headless, runtime Next/Vitest ou banco no snapshot | Nada desses grupos para encerrar |

Os quatro Node somam **30,5MiB residentes**, não vários GiB. A memória privada comprometida desses Node é324,4MiB, parte possivelmente paginada/comprimida; não confundir com RAM física residente. O agente Codex soma130MiB nos dois executáveis, mais as ferramentas Node8,1MiB; o extension host compartilhado do VS Code não pode ser atribuído integralmente a esta conversa. Pools Windows observados: não paginado1.107MiB e paginado882MiB; são métricas do kernel, sem diagnóstico de vazamento, e não uma lista de processos que se deva matar.

**Resíduos de UI/TISS:** não foi encontrado servidor Next, teste Vitest ou Chromium headless atribuível a esses agentes. O Playwright24200 é o único servidor Node local observado; não há prova de que seja lixo ou pertença a um dos dois. Sua parada isolada teria potencial de liberar apenas dezenas de MiB e pode interromper a infraestrutura de testes da IDE. Não propomos matá-lo automaticamente nem apagar arquivos. Nenhum processo recebeu classificação SEGURO PARA ENCERRAR; origens de sessão/worktree não comprovadas permanecem explicitamente desconhecidas.

### Instruções práticas para o titular, por ordem

1. **VS Code — salvar e fechar somente janelas extras que reconhecer.** Em cada janela, use **Arquivo → Salvar Tudo**; verifique terminais/testes em andamento. Feche pelo **X da própria janela**. Mantenha a janela desta conversa: o Codex ativo é filho do VS Code, portanto fechar tudo encerra também nossa sessão. A recuperação esperada é de centenas de MiB por janela/serviços associados, sem promessa de alcançar4GiB. Não usar “Finalizar tarefa” no Code27708 ou no extension host20240.
2. **Claude27220 — preservar até decisão específica.** Se o titular reconhecer a sessão como descartável e salvar seu estado, pode encerrá-la pela própria extensão. Não há justificativa para perder trabalho só para tentar liberar cerca de107MiB; a pausa anterior não autorizava essa parada.
3. **Playwright24200 — preservar por padrão.** Encerrar normalmente a sessão de testes/IDE correspondente é preferível a matar Node. Não indicar um botão/comando específico da extensão sem confirmação da interface. Se o titular pedir a parada pelo PID, conferir novamente identidade, porta, trabalho e autorização antes; o ganho de cerca de22MiB não resolve o déficit atual.
4. **Windows/antivírus/WebView da busca — não mexer.** Não usar utilitários de “limpeza de RAM”, descarte forçado de working set, desativação de compressão, cache ou serviços. Isso pode trocar RAM por paginação ou interromper componentes, sem comprovar capacidade segura.

### Alternativas se não houver4GiB livres

| Alternativa | Avaliação concreta | Próxima autorização/condição |
|---|---|---|
| A — Local após fechar aplicativos | Menor mudança; fechar somente janelas extras salvas. Code inteiro soma1,19GiB aproximado e inclui nossa sessão; Node/Claude oferecem pouco. Não há recuperação segura automática comprovada que garanta os2,45GiB faltantes | Titular fecha apenas aplicações reconhecidas; medir novamente antes de Docker/build |
| B — Reinicialização controlada | Pode liberar estados transitórios/kernel/compressão; não há garantia de atingir4GiB nem diagnóstico de vazamento. Encerra sessões, terminais e agentes | Proposta apenas: salvar todo trabalho, preservar relatórios/checkpoints e obter decisão expressa. Não reiniciado |
| C — Outra máquina existente | Host com ao menos4GiB físicos disponíveis antes do Engine, espaço verificado para imagem/fixture/build e Docker local compatível. Mais RAM total oferece margem; nenhuma compra presumida. Começar somente com dados sintéticos e mesmos limites/isolamento | Identificar equipamento existente e aprová-lo; proteção para dados reais continua exigência separada |
| D — CI existente para o build composto | Runner anterior comprovou build convencional; falta job para **TAR exato**. Um job isolado precisaria obter o arquivo por origem privada aprovada, conferir SHA256/manifesto, extrair e compilar sem harness extra/.env/segredos, usando apenas fixtures. Não substitui restore sintético nem B1-B real | Aprovação específica de diff de workflow, origem/conteúdo do TAR e orçamento. Não alterado/disparado job adicional |

Inventário dos workflows conferido: `ci.yml`, `adr-check.yml`, `db-backup.yml`. A CI usa `security:build`, que modifica a cópia de fontes com harness; não prova o pacote composto. O único `workflow_dispatch` encontrado é o **backup de Production**: **não reutilizá-lo para este ensaio e não executá-lo**. A proposta de CI deve impedir deploy/financeiro, não receber secrets Production e não publicar conteúdo sensível em logs/artefatos. Nenhuma mudança de workflow ou upload do TAR foi realizado.

**Resultado:** orçamento físico não atendido; **RESTORE SINTÉTICO BLOCKED / BUILD COMPOSTO BLOCKED / B1-B REAL NÃO APTO / Production NO-GO**. A inspeção não revelou processo próprio descartável que autorizasse liberar RAM automaticamente. Não iniciamos Docker, banco, GPG integrado ou build. Proteção do host/TLS/chave/plano/retenção/responsáveis continuam pendentes para dados reais, sem reabrir B1-A ou atribuir o bloqueio sintético a essas pendências. R1–R4 continuam PARTIAL e não aceitos. O titular decide a retomada dos outros agentes; não há carga pesada própria desta rodada para parar.

## Retomada autorizada — capacidade insuficiente em 15/11/2026

**Checkpoint prevalente:** o titular autorizou a janela **local e exclusivamente sintética** e informou que UI e TISS estão pausados. A autorização substitui o adiamento anterior; não foi solicitada nova pausa nem confirmação de leitura dos agentes. B1-B real, B2-A/B, B3, merge, deploy, migrations e financeiro live continuam não autorizados. PR53 OPEN/DRAFT, HEAD **`da1bd983cc01aac68c0adb032d5660c17ad6120d`**, CI43748000369 GREEN conferidos nesta rodada. Código financeiro e SQL não sofreram alteração; os checkpoints de validação anteriores continuam no seu alcance.

### Recursos medidos depois da pausa informada

| Medição em 15/11 | RAM física livre / total | Commit / limite | Disco C: livre | Processos observados |
|---|---|---|---|---|
| 19:20:57 UTC / 16:20:57 Brasília, início | **558 / 7.877 MiB** | 17.890 / 25.285 MiB | 10,61 GiB | 4 Node, 16 Chrome, zero PostgreSQL; sem Engine |
| 19:22:37 UTC / 16:22:37 Brasília, reavaliação independente do build | **798 / 7.877 MiB** | 17.813 / 25.285 MiB | 10,61 GiB | 4 Node, 13 Chrome, zero PostgreSQL |
| 19:27:02 UTC / 16:27:02 Brasília, após verificações leves | **810 / 7.877 MiB** | 17.273 / 25.285 MiB | 10,60 GiB | 4 Node, 13 Chrome, zero PostgreSQL/Docker Desktop |

A pausa dos agentes é informação do responsável, não prova de memória liberada. Não existe medição imediatamente anterior à pausa; os 885MiB do ciclo anterior são históricos, não uma comparação controlada. A inspeção dos processos Node não identificou script pesado próprio descartável: havia processos associados a Codex, node_repl e VS Code/Playwright sem atribuição segura a este ensaio. Nenhum foi encerrado. Uma leitura pontual encontrou Memory Compression em1.454MiB, Chrome e VS Code entre os maiores working sets; isso indica pressão de memória, não atribui propriedade nem autoriza encerrar aplicações/serviços.

**Docker — BLOCKED antes da inicialização:** o mínimo proposto continua **4.096MiB físicos livres**. Todas as leituras ficaram abaixo de1GiB. Client29.9.2, contexto desktop-linux e endpoint local `npipe:////./pipe/dockerDesktopLinuxEngine`, SkipTLSVerifyfalse, sem overrides Docker. `docker version` mostrou Client e Servernull, seguido de pipe ausente. Nenhuma tentativa de iniciar Engine/contêiner, instalar imagem ou inventariar caches/volumes do daemon parado. O tamanho disponível da imagem não pôde ser confirmado; não presumir que10,6GiB comportem qualquer download/cache. Junction `node_modules` compartilhada preservada.

**Build — avaliado separadamente, BLOCKED antes da inicialização:** o Engine não consumia recursos e mesmo assim havia apenas798MiB livres na reavaliação. O build frio já documentado ultrapassa heap de2GiB; a CI existente reserva heap de até4GiB somente para o processo Next, além de workers/Windows. Essa configuração não mede consumo mínimo exato, mas não sustenta iniciar com menos de1GiB físico e pressão já observada. Não reduzir heap, usar swap ou trocar versões para forçar sucesso. Node22.23.4 e pnpm11.17.0 conferidos. Sem instalação de dependências, extração nova, `.next` ou build.

### Preflight leve do artefato — PASS, sem alegar build

Executado em **19:26:05 UTC / 16:26:05 Brasília**, duração1,582s, com processo Node de heap limitado a128MiB e hash por stream de64KiB. Evidência sanitizada: `dist/resumed-window-artifact-preflight.json`.

- TAR original:234.562.048bytes, SHA256 **`3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6`**, idêntico à atestação anterior; não reconstruído/alterado.
- Os **2.785 nomes** listados coincidem com o inventário atestado, inclusive acentos. O leitor local inicial comparou incorretamente o prefixo `./` e a saída ANSI do tar Windows como UTF8. Ajustado **somente o helper ignorado em dist** para normalizar o prefixo e decodificar o listing conforme a página Windows1252 deste host; a comparação exata então passou. Não era corrupção do TAR, defeito de recuperação ou correção no código financeiro. Os bytes de arquivos obtidos com `tar -xOf` continuam decodificados como UTF8.
-160 membros SQL,160 entradas de prova embutida;0160/0161 ausentes. Fontes financeira94f6da4a, empacotador787276a1 e compartilhada4d0ed1d5 preservadas. Manifesto congelado SHA256 **`bf2775be25ae3bdb2d58d52b99708a3d1ee32620425f1d98ac214a849185af5f`** confere com Git e HEAD.
-A prova de bytes é o hash integral igual ao TAR anterior. Os160 corpos SQL não foram reextraídos/re-hasheados individualmente, nem houve extração em diretório novo. **Não equivale a build composto, execução SQL, restore PostgreSQL ou recuperação Supabase.**

### Encerramento e classificação desta janela

| Frente | Resultado observado |
|---|---|
| RESTORE SINTÉTICO | **BLOCKED — capacidade insuficiente antes de iniciar Docker.** pg_dump/GPG/PostgreSQL/psql da cadeia não executados; negativas e cancelamento integrados NOT TESTED |
| BUILD COMPOSTO | **BLOCKED — capacidade insuficiente, avaliada independentemente.** Preflight de identidade PASS; Next não executado, sem exit code de build |
| Limpeza | Zero contêineres, bancos, keyrings, diretórios de build ou processos pesados criados. Nada a descartar; apenas helpers/relatórios leves próprios em dist preservados. Nenhum processo alheio ou recurso histórico removido |
| CI / alterações | Nenhuma correção de código versionado, nova dependência, configuração ou migration. CI verde do mesmo HEAD preservada; sem suíte repetida ou commit artificial para disparar outra CI. Novas evidências e checkpoints registrados localmente, revisados e ainda sem commit |
| Host para dados reais | **NÃO APROVADO.** BitLocker/WSL/VHD/sync não verificados; EncryptPagingFile0 e hibernação disponíveis no diagnóstico anterior, não reconsultados agora. Não impedem dados sintéticos, mas não aprovar B1-B real por GPG/tmpfs/ACL |
| B1-B REAL | **NÃO APTO PARA SOLICITAR AUTORIZAÇÃO**: faltam cadeia sintética integral, capacidade, proteção do host/destino, identidade TLS real, chave recuperável, responsáveis, retenção/descarte e GO específico |
| B2-A / B2-B / B3 | Não autorizados e não executados; sem leitura de ledger/schema Production. Pacote0136–0159 preservado |
| Production / R1–R4 | **NO-GO**; R1–R4 PARTIAL e não aceitos; renovação natural13/12 não antecipada |

Não há carga pesada própria desta janela impedindo a retomada de UI/TISS; **o titular decide quando retomá-los**, sem reinício automático dessas sessões. A máquina continua sem capacidade demonstrada para este ensaio. Próxima ação concreta: disponibilizar ao menos4GiB físicos livres nesta máquina, sem encerrar processos desconhecidos, ou indicar outra máquina existente aprovada; então repetir apenas o preflight de recursos e executar a cadeia sintética autorizada, com build separado. Não pedir que os agentes sejam pausados novamente como se essa informação não tivesse sido fornecida. Plano/retenção efetivos e recuperação física Supabase continuam pendentes de conferência específica, sem repetir o B1-A ou acessar conteúdo real.

## Janela sintética preparada e adiada pelo titular — 15/11/2026

**Decisão prevalente:** “Deixe a janela preparada para depois”. Não iniciar Docker, restore ou build pesado nesta rodada, nem pedir novamente a mesma pausa. A janela abaixo é somente local e sintética, sem data reservada; não autoriza B1-B real, B2, B3 ou qualquer alteração Production. Baseline anterior conferida: `c06608e3`, CI43744127028 GREEN, 7.266 testes/641 arquivos/22 E2E/zero SKIP. Nenhum GPG foi reensaiado localmente só para repetir esse resultado. O novo commit documental/ferramenta deve ter sua própria CI; consultar HEAD/checks do PR53.

### Resultado novo: ACL Windows, somente fixture sintética

`scripts/recovery/probe-private-directory.ps1` executado às **18:34:00 UTC**: **9 verificações PASS**, parser PowerShell PASS. Criou exclusivamente `acl-probe-<GUID>` sob `%LOCALAPPDATA%\Qoro\Recovery`, recusando ancestrais reparse, nomes/parent inválidos e reutilização de destino. ACL nova sem herança, com FullControl somente para a identidade executora; arquivo sintético herdou apenas essa regra e foi escrito/lido. Controles negativos recusaram ACL com herança não protegida e permissão adicional para Everyone. A ACL da pasta Recovery pai foi comparada antes/depois e permaneceu idêntica. Arquivo e pastas vazias próprios foram descartados por caminhos exatos, sem exclusão recursiva. **Nenhum backup ou diretório histórico foi aberto, alterado ou excluído.**

Evidência local sanitizada: `dist/b1b-private-directory-probe.json`; resumo preservado no JSON de evidências existente. Repetição leve, quando necessária:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
.\scripts\recovery\probe-private-directory.ps1
```

**Alcance:** DACL/proprietário/herança e leitura/escrita pela identidade atual foram verificados. Não foi realizado login com outra identidade para provar negação efetiva; privilégios administrativos de tomada de posse/backup não são eliminados pela DACL. ACL não comprova criptografia de disco/pagefile/hibernação/WSL, exclusão de sincronizadores, retenção de terceiros ou segurança de um futuro destino real. Nenhuma pasta de dados reais foi criada. Retenção da fixture: somente a duração do probe; descarte conferido.

### Medição para planejar a retomada

Leitura de **18:25:41 UTC**, não reserva de capacidade: **7.877 MiB físicos / 885 MiB livres**, comprometimento **18.217/25.285 MiB**, disco C: **8,71 GiB**. Oito processos Node, treze Chrome, zero PostgreSQL; contagem não atribui propriedade aos outros agentes. Client Docker29.9.2, contexto local desktop-linux, sem overrides; pipe do Engine ausente. Não iniciado, caches/volumes/tamanho real da imagem ainda não inventariados. Junction de dependências compartilhada preservada.

`EncryptPagingFile=0` novamente observado; consulta BitLocker negada por falta de privilégio e hibernação disponível. WSL/VHD/swap e política de sync continuam não verificados. Não elevar privilégio, ativar BitLocker, modificar pagefile/hibernação ou alegar host aprovado para dados reais.

### Roteiro da futura janela local — sintético primeiro, build depois

**Coordenação preparada:** enviar aos responsáveis UI/TISS, quando o titular decidir retomar: “Preciso de um intervalo local para um único ensaio sintético de recuperação e, em seguida, um build isolado. Salvem o trabalho e pausem voluntariamente os builds/testes pesados e navegadores que vocês iniciaram. Avisem quando terminarem; ninguém encerrará processos ou alterará seus worktrees/junctions.” Nenhum desses agentes está acessível nesta árvore; não presumir recebimento. Data, participantes e duração ficam a combinar. Reservar inicialmente até 60 minutos como orçamento de planejamento, não como RTO medido; interromper/reagendar em vez de prolongar automaticamente.

| Ordem | Ação futura e verificação | Ponto de parada |
|---|---|---|
| 1 | Confirmar retomada com titular/UI/TISS; medir RAM/commit/disco/processos, identificar somente os próprios recursos | Sem pausa acordada ou orçamento suficiente: não iniciar |
| 2 | Proposta conservadora: pelo menos 4 GiB de RAM física livre antes do Engine; conferir margem de disco para imagem já existente, extração/build/logs sem limpeza alheia | Não tratar memória virtual como RAM nem aumentar limites para forçar execução |
| 3 | Iniciar apenas Docker local; conferir Client+Server, contexto/endpoint e tamanho da imagem oficial fixada, volumes/cache por leitura; medir overhead e RAM novamente | Endpoint remoto, ausência da imagem com espaço insuficiente, RAM livre <1 GiB, OOM ou disco sem margem: parar |
| 4 | Rodar probe ACL sintético, criar home GPG exclusivo, ambiente de processo com allowlist do SO; nenhum `.env`, URL, chave, app ou worker live | ACL/isolation divergentes ou segredo herdado: não criar fixture |
| 5 | Criar fixture pequena apenas local, com schema, tabela pai/filha, FK, índice e journal **sintéticos**; usar contêiner(es) `--network none`, zero portas/mounts persistentes, logs none, tmpfs/limites e cron off do operador | Não usar DEV compartilhado nem executar migrations do release; fixture não representa o catálogo Production |
| 6 | `pg_dump` real → GPG real em stream, sem SQL aberto; conferir exits, SHA256/bytes do cifrado e inventário antes; restaurar por stream em outro banco descartável isolado, com ID inspecionado | Saída não zero, hash/bytes divergentes, isolamento desconhecido ou qualquer vazamento impede PASS |
| 7 | Comparar schema, dados sintéticos, journal, FKs e índices; executar senha/hash/arquivo incorretos, SQL inválido, interrupção real e timeout, registrando efeitos e exits | Processo sobrevivente ou destino parcialmente restaurado nunca recebe PASS; preservar o cifrado até diagnóstico |
| 8 | Descartar somente contêineres/arquivos sintéticos identificados e verificar ausência; fechar seu agent GPG; medir duração/recursos | Não remover volumes/processos/diretórios por suposição; falha de descarte exige registrar recurso remanescente |
| 9 | Depois do descarte e nova medição, iniciar **separadamente** o build do pacote composto conforme abaixo | Não executar build concorrente com o restore; se sem capacidade, manter NOT RUN |

Os passos 5–8 descrevem o procedimento ainda a executar; **não constituem um harness integral validado**. O operador de B1-B real exige autorização e prefixo de journal136: não passar `--authorize-local-real-data` para contornar essa proteção com uma fixture pequena. Reusar seus helpers testados no ensaio sintético sem afirmar equivalência com recuperação Production. GPG7/7 e doubles37/37 anteriores continuam válidos no seu alcance, sem substituírem o teste integral futuro.

### Build do pacote composto — roteiro e alternativa de CI

1. Preservar o TAR existente e atestação `migrations/release-artifact-94f6da4a.json`: fonte financeira94f6da4a, empacotador787276a1, SQL compartilhado4d0ed1d5; TAR SHA256 `3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6`. A prova de 2.785 arquivos/160 SQL é anterior, não uma nova execução nesta rodada.
2. Na retomada, conferir hash do original e extrair em diretório **novo de build**, fora de Recovery, conferindo UTF8 e manifesto antes de compilar. Não reutilizar uma `.next` parcial, reconstruir o TAR sem motivo ou incluir0160/0161.
3. Conferir Node22/pnpm11.17.0 e dependências do lock. Instalação/cache só no destino isolado; não reinstalar nem mudar `node_modules`/junction compartilhados. Dimensionar espaço antes. Cache incompleto ou incompatível é parada, não motivo para trocar versões/lock.
4. Lançar `node <node_modules do destino>/next/dist/bin/next build` com cwd na extração íntegra e ambiente allowlist do SO + fixtures locais exigidas pelo schema de ambiente, conforme `scripts/security/local-build.ts`. Não executar esse helper diretamente como prova do pacote: ele copia uma seleção de fontes e injeta uma página harness, alterando o source compilado. Não herdar `.env`, segredos, Vercel/CI tokens, DSN ou endpoints externos reais. Conferir que as únicas variáveis de serviço são sintéticas; nenhum processo de aplicação/worker precisa iniciar.
5. Preservar logs/exit code, duração, versões e vínculo aos hashes da entrada; comparar novamente os arquivos de entrada permitidos, separando saídas `.next` e dependências. Publicar apenas resumo sem valores de ambiente. `COMPOSED RELEASE BUILD — PASS` exige essa execução real; zero isolado com erro de ESLint também não basta. Nenhum build será publicado.

**Alternativa examinada, não executada:** `.github/workflows/ci.yml` executa no checkout do PR, sem `workflow_dispatch`; seu passo Build usa `pnpm security:build`, que gera a cópia/harness acima. Portanto, mesmo verde, **não valida a extração composta**. Não há nesta configuração um job pronto para receber o TAR exato e executar esse build. Adaptar um job futuro exigiria diff específico/revisão de autorização de CI e limite de custos; nenhuma automação foi alterada nem execução adicional foi disparada para fingir essa prova. A CI obrigatória do PR continua independente.

### Próxima decisão — somente quando retomar

**Janela: PREPARADA / ADIADA PELO TITULAR. Restore sintético integral e build composto: NOT RUN, sem novos recursos iniciados. B1-B real: NÃO APTO e NÃO AUTORIZADO.** Antes de propor dados reais, faltam PASS integral sintético, capacidade e destino identificados, proteção verificável do host/temporários/WSL, procedimento recuperável de chave/TLS, responsáveis, retenção/descarte e aprovação específica. Consulta administrativa futura apenas por leitura: PowerShell elevado pelo titular → `manage-bde -status C:`; não ativar criptografia nem reenviar chave de recuperação. Plano/retenção efetivos do Supabase continuam pendentes, sem repetir a lista de oito backups. B2/B3 e R1–R4 não são liberados por esta preparação.

## Ensaio sintético e segurança — 15/11/2026, após B1-A

**Checkpoint prevalente.** O titular reconheceu o B1-A administrativo e confirmou no painel os mesmos oito backups físicos abaixo, com a opção Restore. Nenhuma nova listagem ou leitura de dados era necessária para repetir essa evidência. Este ciclo autoriza correções das ferramentas, testes exclusivamente sintéticos, documentação e push no PR53. **B1-B real, B2-A/B, B3 e C/D/E continuam não autorizados; Production NO-GO.** R1–R4 permanecem PARTIAL, sem aceite.

### GPG real — PASS no Windows

Histórico da validação deste ciclo: CI43741996377 do6838435f interrompeu no TypeScript (`exactOptionalPropertyTypes`, campo gpgHome explicitamente undefined); corrigido para omitir a propriedade ausente, sem cast ou relaxamento do tipo. Os47 testes dirigidos passaram novamente. O SHA posterior exige sua própria CI completa; não reutilizar a execução interrompida como aprovação.

Na CI43742311466 do30e358f1, TypeScript/lint/arquitetura e **7.266 testes/641 arquivos** passaram, incluindo os7 testes GPG reais no Linux. A execução interrompeu no inventário gerado desatualizado: uma nova leitura dinâmica dos overrides Docker e referências de linhas. `inventory.ts --write` regenerou `docs/security/acoes.md` com200 actions,66 métodos,19 props,545 acessos de ambiente e zero guard/registro/teste de rota pendente; diff revisado, sem alterar o scanner nem o snapshot histórico. A primeira tentativa local com heap512MiB terminou em OOM; a execução somente de AST, com ambiente allowlist e heap limitado a1GiB, saiu0. Isso não é autorização/orçamento de restore ou build. O commit documental seguinte exige CI própria até o fim.

Causa confirmada do bloqueio anterior: o GPG `2.4.9` incluído no Git é MSYS. Um `--homedir C:/Users/...` foi interpretado como caminho relativo ao worktree (`/c/dev/.../C:/Users/...`); o diretório inexistente impedia criar o keyring e conectar o agent. O primeiro erro de descritor também pertencia ao harness Windows. Não eram evidências de falha financeira. Não houve necessidade de instalar ferramenta, alterar o keyring do usuário ou enfraquecer criptografia.

`gpgFileArgument` converte arquivos/home para `/c/...` somente quando o executável Windows explicitamente selecionado pertence ao runtime MSYS; GPG nativo e Linux mantêm seus caminhos. A ferramenta aceita `--gpg-home`, desabilita cache simétrico e configuração GPG implícita. Neste host, indicar **o executável absoluto**, fora do PATH observado: `C:\Program Files\Git\usr\bin\gpg.exe`. O diretório GPG deve ser novo, privado e exclusivo do ensaio, nunca o keyring pessoal.

**Sete testes reais PASS** em `src/lib/security/gate-b-gpg-real.test.ts`, às **17:25 UTC**: AES256 em stream; descriptografia/bytes UTF8/hash; senha incorreta; adulteração; truncamento; encerramento real do processo; timeout; e asserção de ausência de SQL aberto persistente. A verificação de ausência de SQL faz parte dos sete casos. Senha aleatória sintética enviada pelo fd0, nunca argv/log; texto aberto apenas em memória. Fixture/keyring e agent exclusivos foram descartados sem exclusão recursiva. As duas pastas novas do diagnóstico também foram descartadas; scratches antigos e processos de outros agentes permaneceram intactos. Evidência local: `dist/gate-b-gpg-real.json`; resumo sanitizado no JSON de evidências do release.

**Não confundir:** GPG real aprovado não é restauração PostgreSQL. A suite de confinamento tem **37 testes com doubles**, incluindo contexto remoto/override, contêiner inadequado, ID, portas/rede, cron, falha de processo, cancelamento e timeout. O restore completo continua **BLOCKED — INSUFFICIENT RESOURCES**. Interrupção com GPG real passou; Ctrl+C real sobre a cadeia GPG/Docker/psql no Windows ainda não foi executado.

### Ferramenta e isolamento

- O operador agora recusa `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_TLS_VERIFY` e `DOCKER_CERT_PATH` não vazios; consulta o contexto, exige endpoint local conhecido e TLS não ignorado. Cada operação de dados usa `--host` fixo e o **ID completo** retornado pela inspeção, não apenas o nome. Windows: pipes locais aprovados; Linux: socket `/var/run/docker.sock`. Endpoints SSH/TCP, inclusive TCP de loopback, são recusados. Não basta nomear um daemon remoto como `desktop-linux`.
- A inspeção continua exigindo imagem oficial fixada, label, rede `none`, nenhuma porta, logs `none`, nenhuma montagem persistente, PGDATA em tmpfs, swap do contêiner igual ao limite de RAM e cron desligado. O controle não demonstra proteção do swap do WSL/pagefile do host.
- `AbortSignal`, SIGINT/SIGTERM no CLI e timeout encerram os dois filhos e impedem PASS, mesmo se ambos reportarem zero após o cancelamento. Erros SQL/GPG permanecem suprimidos; não há endpoint financeiro, aplicação Qoro, worker ou migrator nesse operador.
- Correção localizada no operador de backup: `backupConnectionEnv` exige agora **`PGSSLMODE=verify-full`**, inclusive se uma URL sugerir modo mais fraco. A CA/cadeia e hostname da conexão real ainda precisam ser conferidos no futuro B1-B; a configuração não comprova handshake executado. CA ausente/inválida deve interromper, nunca voltar a `require`. [Contrato libpq oficial](https://www.postgresql.org/docs/17/libpq-ssl.html).
- Os novos operadores devem ser executados da versão operacional aprovada, fora da pasta limpa de deployment. Não usar a cópia antiga do helper de backup dentro do export financeiro congelado, que ainda contém o comportamento histórico. Runtime financeiro, preços, cotas, SQL, CI/CD e configuração live não foram alterados.

### Capacidade e segurança do host — medição deste ciclo

| Verificação | Resultado observado | Consequência |
|---|---|---|
| RAM física | 7.877 MiB totais; 1.098 MiB livres inicialmente, 598 MiB em leitura posterior | Insuficiente para contêiner de 2 GiB mais Docker/Windows e agentes. Não iniciado |
| Memória comprometida | 18.714 MiB de limite 25.285 MiB | Memória virtual disponível não substitui RAM protegida |
| Disco C: | 8,8 GiB livres | Não reservar imagem/cache/build sem novo orçamento |
| Disco/concorrência | Contador de ocupação 125%, leitura pontual; não é benchmark. 6 Node inicialmente, 18 em outra leitura; 15 Chrome; nenhum PostgreSQL | Não inferir SLA/identidade dos agentes; nenhum processo encerrado |
| Docker | Client29.9.2; Engine sem pipe, contexto desktop-linux local, sem overrides | Não iniciar sob esse orçamento; volumes/caches do daemon não puderam ser inventariados |
| Dependências | node_modules é junction já existente para Qoro_signup_email_fix_20261109/node_modules | Não remover, reinstalar ou alterar a junction compartilhada |
| Pasta Recovery existente | Diretório sem junction; ACL herdada inclui leitura de CodexSandboxUsers | Não serve como prova de ACL privada de uma futura subpasta. Não inferir permissões de arquivos históricos nem alterá-los |
| BitLocker | Consulta de status negada por falta de acesso administrativo | Proteção do volume NÃO VERIFICADA; nenhuma elevação/alteração executada |
| Pagefile | `fsutil behavior query EncryptPagingFile`: **0, desabilitado**; pagefile17.408MiB | tmpfs não garante confidencialidade do texto paginado pelo host |
| Hibernação | Disponível, com Inicialização Rápida | Exigir proteção verificável do volume/arquivo de hibernação antes de dados reais |
| Compartilhamento/sync | Apenas shares administrativos padrão vistos; Recovery fora de OneDrive, sem reparse | Isso não comprova ausência de agentes de sync/backup de terceiros. Verificar destino final e política do responsável |
| WSL swap | Não confirmado por configuração explícita consultável | Não presumir que `--memory-swap` do contêiner protege o VHD/swap do WSL |

**Orçamento mínimo proposto, não capacidade demonstrada:** janela coordenada com pelo menos 4 GiB físicos livres antes do Engine (2 GiB contêiner + reserva inicial de 2 GiB para VM/overhead), mais margem confirmada após iniciar o Docker. Não aumentar limites automaticamente. Dimensionar disco a partir da imagem já presente, tamanho cifrado autorizado e orçamento de build; tmpfs inclui PGDATA, WAL e índices dentro dos 2 GiB. O tamanho real do banco não foi consultado neste escopo. Iniciar a fixture pequena somente se houver margem; parar se RAM livre cair abaixo de 1 GiB, houver swap/pressão inesperada, OOM, erro de disco ou isolamento divergente. Esses são limites operacionais conservadores propostos, não um teste de carga aprovado.

**Alternativa recomendada:** janela na própria máquina, após os outros agentes voluntariamente liberarem recursos, com proteção do host comprovada. Se isso não for possível, outra máquina existente, identificada e aprovada pelo titular, com os mesmos controles, começando por dados sintéticos. Não há outra máquina autorizada identificada. Ambiente temporário externo fica apenas como proposta sujeita a localização/custo/segurança e autorização; nada foi contratado. Clone gerenciado não é alternativa automática: gera custo e pode iniciar jobs externos imediatamente. [Restrições oficiais do clone](https://supabase.com/docs/guides/platform/clone-project).

### Checklist antes de qualquer cópia real — tudo obrigatório

1. B1-B aprovado expressamente, com responsável técnico/operacional, janela e acesso à chave de recuperação designados; nenhuma inferência de autorização por este teste.
2. Destino novo `%LOCALAPPDATA%\Qoro\Recovery\gate-b1b-<ID_APROVADO>` fora do Git/deployment, sem junction/sync/share não aprovado, ACL **protegida contra herança**, restrita ao titular/operador e contas de sistema autorizadas. Conferir ACL efetiva; não basta `mode:0600` no Windows. Cofre e passphrase recuperáveis pelo responsável; nenhuma cópia em argv/CI/relatório.
3. Proteção verificável de disco, pagefile, hibernação, temporários e WSL/VHD/swap. `tmpfs`/log-driver none isoladamente não atendem este requisito. Não restaurar dados reais enquanto a proteção continuar desconhecida.
4. Host/REF/porta/usuário exclusivamente do projeto aprovado; pg_dump compatível, CA oficial confiável e `verify-full` efetivo na mesma conexão do dump. Não imprimir URL. Não desabilitar TLS nem aceitar certificado incorreto. Conexão real NÃO testada neste ciclo.
5. Recursos suficientes; Docker local fixado; imagem/ID/labels/rede/portas/mounts/log/swap/cron conferidos; nenhum gateway, app, worker ou migrator. Não iniciar serviços Supabase completos por conveniência.
6. **Ensaio sintético completo real PASS primeiro**: fixture/journal/constraints/índices → pg_dump → GPG → SHA256 → stream → Docker/psql → comparação → erro/interrupção/descarte. Hash errado, truncamento/senha errada, conexão/processo/permissão, timeout, rede/porta/contexto inadequado e journal divergente devem falhar. Os casos GPG e doubles já executados não substituem essa cadeia.
7. Preservar o original cifrado, registrar apenas metadados/hashes/exit codes; não criar SQL aberto. Aprovar retenção/descarte da nova cópia e contingência para chave indisponível. Interrupção preserva original e exige revisar/destruir somente o destino descartável autorizado.

### Cobertura de recuperação: três evidências distintas

O quadro diferencia cobertura documentada de prova executada. Os ensaios de outubro são **históricos**, não foram refeitos nem certificados como estado atual. Os backups físicos atuais foram somente listados; nenhum foi restaurado neste ciclo.

| Componente | Backup físico gerenciado | Dump lógico proposto | Prova de recuperação existente | Lacuna |
|---|---|---|---|---|
| Schema PostgreSQL | Cobertura de banco documentada; oito COMPLETED | DDL dos schemas não excluídos | Restore public/auth histórico de outubro; não desta cópia | Restore físico atual e novo lógico não testados |
| Dados de aplicação | Banco gerenciado, sem prova de conteúdo atual | Linhas dentro do snapshot do dump | Histórico de outubro | Estado atual/inventário/paridade pendentes de B1-B |
| Journal | Tabela no banco, não inspecionada neste ciclo | Incluído se existente no schema não excluído | Prefixo e sequência sintéticos anteriores; fonte congelada160 | Prefixo Production136 é snapshot histórico; B2-A não autorizado |
| Auth | Dados auth, não configuração integral do serviço | auth no mesmo snapshot de public | Restore SQL histórico; snapshot gerenciado Auth anterior documentado | Sessões/provedores/SMTP/redirects/chaves e serviço completo não comprovados por SQL |
| Storage | Apenas metadados; **não binários** | storage excluído; nenhum binário | Ensaio de29/10:42/42 hashes, histórico documentado | Cobertura/rotina atual independente dos arquivos e vínculo com banco |
| Roles e grants | Clone físico documenta roles/permissões; senhas customizadas não cobertas por backup diário | --no-owner/--no-acl: não recompõe todos os direitos/roles | Nenhuma prova integral atual | Inventário e reaplicação segura, sem supor grants equivalentes |
| Vault | Clone físico transfere root key conforme documentação; restore atual não observado | vault/pgsodium excluídos; não transfere root key automaticamente | Nenhuma prova atual neste ciclo | Material criptográfico e acesso recuperável sob controle autorizado |
| Realtime | Configuração externa/replicação exige tratamento próprio | realtime/_realtime excluídos | Nenhuma prova integral atual | Serviço, publicação/slots/configuração e teste separado |
| Configuração externa | Não é backup de Vercel/Meta/Asaas/AbacatePay/SMTP | Fora do SQL | Runbooks/inventários históricos | Cofre, permissões e reconstrução operacional atual |
| Segredos | Não presumir todos; API keys/Auth settings fora do clone; senhas customizadas excluídas | Não é cofre; colunas cifradas ainda dependem de suas chaves | Nenhuma recuperação integral atual | Chaves externas, responsáveis e contingência aprovados |

[Cobertura/retenção oficiais de backups](https://supabase.com/docs/guides/platform/backups) e [limites do clone](https://supabase.com/docs/guides/platform/clone-project). Plano e retenção efetivos seguem **NÃO VERIFICADOS**. Conferência humana futura: Supabase Dashboard → organização `joaomarcos-techia's Org` (`srbucltkichbsehsirun`) → **Billing/Subscription**; confrontar com Database → Backups do `qoro-prod`, sem clicar Restore. Não solicitar novamente os oito registros. Nenhum PITR/recurso pago será ativado.

### Build, proveniência, composição e pedido B1-B

Preservada a evidência de15:34UTC do artefato: financeiro94f6da4a, empacotadores787276a1, SQL compartilhado4d0ed1d5, manifesto e160 hashes, 2.785 arquivos; TAR SHA256 `3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6`. Não foi reconstruído/reverificado desnecessariamente. A versão dos operadores de recuperação passa a ser o **novo HEAD deste ciclo, com CI própria**; não atribuir à versão787 as novas correções. O TAR/deployment financeiro não foi modificado. Fonte financeira, operadores e build composto são evidências distintas.

**Build específico do pacote composto: BLOCKED — INSUFFICIENT RESOURCES / NOT RUN.** Nenhuma variável live foi carregada para compilar, nenhuma dependência compartilhada foi reinstalada, nenhum deploy/CI/CD alterado. Executar em janela local com orçamento separado ou ambiente existente aprovado, com dependências do lock e configuração sintética/isolada; conferir SHA/manifesto/hash antes, preservar logs de build e identificar o artefato gerado. CI verde da fonte ou destes operadores não substitui o build do diretório composto.

Pacote SaaS permanece **0136–0159**, 24 entradas sobre prefixo136 histórico;0160/0161 fora. Nenhuma leitura do ledger Production ou mudança de migration foi feita. Hashes0051/0093/0124 continuam exigindo catálogo em B2-A; não reescrever histórico. UI e TISS permanecem em seus worktrees, sem merge ou alteração. Handoff UI: [contratos financeiros](HANDOFF-UI-BILLING-SaaS.md); leitura pelo outro agente não confirmada. Risco de Asaas live com DEV continua tarefa separada de Payments/UI; nenhuma credencial foi lida/copiada ou chamada monetária executada aqui.

**B1-B: NÃO APTO para solicitar execução com dados reais hoje.** Falta ensaio completo, capacidade, comprovação de proteção do host/destino e TLS efetivo; plano/retenção e responsáveis também pendentes. O pedido anterior abaixo permanece **rascunho condicional**, não autorização. Próxima ação concreta: janela de recursos para ensaio **sintético** e conferência administrativa do host, ou identificação de outra máquina existente aprovada. Depois do PASS, preencher B1-B com SHA operacional/CI final, máquina, destino/ACL/chave, escopo do novo dump lógico, responsáveis, janela, retenção e pontos de parada. Não apresentar isso como restauração do backup físico. B2/B3 permanecem preparados e não executados.

## B1-A — consulta administrativa de 15/11/2026

**Escopo vigente:** somente B1-A autorizado e testes exclusivamente sintéticos. B0 reconhecido pelo titular. B1-B, B2-A/B, B3 e C/D/E continuam não autorizados. Os checkpoints abaixo são históricos quando conflitarem com esta seção. Não há janela reservada, restore real, dump, download, SQL Production, configuração ou deploy autorizado por esta consulta.

**Resultado:** PASS para identificação e metadados acessíveis; PARTIAL para plano/retenção efetiva e capacidade de recuperação. O registro administrativo não certifica integridade ou restauração.

| Item | Evidência administrativa atual |
|---|---|
| Projeto | `qoro-prod`, REF `shlcbxawrxuaebazuiue`, organização `srbucltkichbsehsirun` |
| Região / serviço | `us-east-1`, `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.127`; CLI autenticada |
| Acesso | CLI oficial `2.122.0`, credencial já existente; sem ler/copiar token ou arquivo `.env` |
| Backup físico | `walg_enabled=true`; oito registros físicos, todos `COMPLETED` |
| Mais recente | ID `2273462739`, `inserted_at=2026-11-15T09:14:14.727Z` (06:14:14 de São Paulo) |
| Mais antigo listado | ID `2203783547`, `2026-11-08T09:10:06.816Z`; cópias diárias até 15/11 |
| PITR | `pitr_enabled=false`, confirmado; não será ativado |
| Plano / retenção contratual | **NÃO VERIFICADOS:** `orgs list` retorna identidade, sem plano; listagem de backups não informa retenção |
| Janela física exata / conclusão | `physical_backup_data={}`; não foram retornados LSN, checksum ou horário exato de conclusão. `inserted_at` é o registro administrativo, não prova de ponto transacional exato |
| Integridade / restore atual | **NÃO VERIFICADOS:** nenhum conteúdo foi acessado, baixado ou restaurado |

Fontes autenticadas: `supabase projects list --output json`, `supabase backups list --project-ref shlcbxawrxuaebazuiue --output json`, `supabase orgs list --output json`, filtradas para o projeto/organização correspondentes. Consulta de backups iniciada em **15:21:00 UTC**. A CLI foi executada fora dos worktrees, sem carregar `.env`, usando a cadeia de certificados do Windows (`NODE_USE_SYSTEM_CA=1`) no processo. O primeiro acesso falhou na validação da cadeia padrão; TLS permaneceu habilitado. Browser da automação indisponível. Permissão documentada para listar: `backups_read`, com `project_admin_read` opcional; nenhum privilégio foi ampliado.

A [política oficial](https://supabase.com/docs/guides/platform/backups) prevê sete dias de backups diários no Pro, 14 no Team e até 30 no Enterprise. **Oito registros visíveis não comprovam contrato de oito dias.** Falta conferir no painel o plano vigente e a retenção aplicável, sem criar token ou recurso pago. A cobertura observada é diária; o risco entre cópias e falhas de execução permanece. Não declarar RPO zero, RTO medido ou B1 integral aprovado.

### Ferramenta, recursos e testes sintéticos

- Revisada `scripts/gate-b-isolated-restore.ts`: sem URL de banco de destino, usa `docker exec` no contêiner nomeado/rotulado; exige imagem oficial, rede `none`, nenhuma porta, logs `none`, tmpfs, cron desligado, hash da entrada, autorização explícita, histórico exato e saídas GPG/psql. Não executa migrator, serviços financeiros, aplicação Qoro ou telemetria.
- O contexto atual `desktop-linux` aponta para o pipe **local** `dockerDesktopLinuxEngine`, com `SkipTLSVerify=false`; nenhum override `DOCKER_HOST`/`DOCKER_CONTEXT` foi encontrado. O helper não fixa sozinho o endpoint do Docker: **revalidar contexto/overrides em cada execução e parar se houver daemon remoto ou ambíguo**. Nunca usar contêiner com nome semelhante sem validar todos os atributos.
- Docker Client `29.9.2` instalado; Engine sem pipe operacional. Memória livre observada entre **250 e 702 MB**, disco C: **9,2 GB**. Não iniciar Docker/contêiner de 2 GiB sob esse orçamento. Nenhum processo de UI/TISS foi encerrado, nenhum serviço global alterado.
- **27 testes da ferramenta + 1 regressão UTF8 PASS**, com processos sintéticos/doubles. Cinco novos casos cobrem destino indevido, erro de inicialização de processo, fechamento antecipado de psql e timeout. Não são restore PostgreSQL real nem teste de SIGINT do Windows.
- Tentativa complementar de GPG real, com SQL exclusivamente sintético: **BLOCKED na inicialização do ambiente GPG/agent isolado**. O primeiro harness usou um descritor incompatível; o teste adaptado ao fd0 ainda não iniciou o agent nesse diretório novo. Isso não demonstra defeito financeiro nem foi registrado como sucesso. Exigir ensaio criptográfico positivo antes de qualquer dado real.
- Restauração sintética completa Docker/GPG/psql e descarte do contêiner: **NOT RUN**. Recuperação real: **NOT AUTHORIZED / NOT RUN**. As quatro fixtures novas do ensaio GPG foram descartadas após verificar nomes/caminhos e conteúdo sintético, removendo apenas arquivos e pastas vazias, sem exclusão recursiva. Scratches antigos bloqueados por política não foram tocados.

### Proveniência do pacote — conferência B1-A

**Código financeiro `94f6da4a` / CI43666101807 → operadores `787276a1` / CI43712300581 → manifesto congelado + SQL compartilhado `4d0ed1d5` → 160 hashes SQL → arquivo TAR SHA256 `3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6`.**

O [atestado atualizado](migrations/release-artifact-94f6da4a.json) registra os blobs Git dos operadores, hash do manifesto e a separação dos papéis. Foram reconferidos nomes e SHA256 dos **2.785 arquivos** no export e na extração já existente, mais os 160 corpos SQL contra seus Git refs. Prova anterior de 2.593 arquivos fora das migrations contra os blobs aprovados preservada. O teste nativo UTF8 passou no Windows e na CI Linux do HEAD operacional.

Não é montagem manual nem alegação de que um único `git archive` contém a composição SQL transformada. O exporter automatizado usa refs fixos e recusa drift. Os operadores de backup/preflight/exportação rodam do worktree operacional aprovado **fora da pasta limpa de deploy**; suas correções não são ignoradas por usar fonte financeira congelada. Nenhum módulo de runtime depende dos operadores novos. Código funcional TISS ausente; `0160` e `0161` fora do pacote.

**Limite mantido:** o build específico do export transformado não foi executado nesta rodada. A CI da fonte e a dos operadores são provas distintas; não atribuir uma delas ao build desse diretório. B3 exige build desse pacote, SHA financeiro, SHA operacional, ref SQL, hashes do manifesto/TAR e ID do deployment registrados juntos.

### B1-B preparado — pedido específico, sem execução

**Recomendação: cópia lógica cifrada em destino local protegido, condicionada ao ensaio sintético completo.**

| Alternativa | Avaliação |
|---|---|
| A — restaurar o backup físico gerenciado em novo projeto | Documentado para planos pagos com backup físico; cria cobrança de recursos espelhados, valor apresentado pelo painel. Não contratado. O clone copia extensões e pode iniciar jobs externos imediatamente, sem opção de pausá-los antes. Não satisfaz por si só o isolamento financeiro exigido |
| B — novo dump lógico cifrado e restore local isolado | Evita novo projeto e integrações live no destino. Exige recursos locais, GPG operacional, fonte TLS validada e autorização para tratar dados reais. Não foi executado |

Fontes: [clone gerenciado](https://supabase.com/docs/guides/platform/clone-project) e [restore lógico](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). A alternativa B testa uma **nova cópia lógica**, não a restauração do backup físico ID2273462739. O backup gerenciado permanece preservado como mecanismo distinto.

**Operação a autorizar:** depois de confirmar projeto/host, permissões, recursos, egress e proteção do destino, gerar uma cópia lógica atual de `qoro-prod`, em stream cifrado AES256, com UTC, tamanho e SHA256 registrados; restaurar somente em contêiner local descartável sem rede. O backup ainda não existe e seu identificador será gerado na janela autorizada. Não haverá dump/restore sobre DEV, banco original, Preview, gateway ou CI externo.

**Dados e chaves:** arquivo `.sql.gpg` sob `%LOCALAPPDATA%\Qoro\Recovery\gate-b1b-<ID_APROVADO>`, fora de Git/sincronizadores e com ACL privada. Chave recuperável sob controle do titular/cofre existente, apenas em memória do processo; nunca em argv, chat ou relatório. SQL decifrado somente em pipe/RAM e tmpfs. Antes da cópia, conferir criptografia do host/pagefile/WSL e impedir swap persistente do contêiner. Acesso restrito ao titular e ao operador expressamente designado; papéis ainda não nomeados.

**Pré-condições técnicas:** liberar capacidade sem encerrar processos de outros agentes; iniciar Engine apenas quando houver orçamento para 2 GiB do contêiner mais overhead medido do Docker; executar primeiro fixture exclusivamente sintética com GPG/psql reais, erro controlado, interrupção e descarte verificados. Confirmar versões/extensões exigidas. O helper de backup existente usa `PGSSLMODE=require`, que não prova `verify-full`; a identidade/cadeia TLS da fonte deve ser validada antes da operação real, sem desativar verificação de certificados. Nenhuma configuração dessa fonte foi alterada neste ciclo.

**Escopo de recuperação:** o helper inclui Auth e dados da aplicação no mesmo snapshot, mas exclui schemas gerenciados como Storage, Vault e Realtime; usa `--no-owner --no-acl`. O dump não comprova binários Storage, configurações Auth, passwords de roles, raiz de criptografia Vault nem todos os grants. Essas dependências exigem inventário/cofre e reconstrução separada; não declarar recuperação integral do serviço ou RTO com base em tabelas restauradas.

**Custo:** sem PITR, novo projeto ou snapshot pago. Verificar franquia de egress/espaço antes da transferência; se exigir cobrança adicional, parar sem contratar. Alternativa para recursos locais insuficientes: janela tranquila na estação existente ou outra máquina já disponível e aprovada com os mesmos controles; não enviar cópia real a GitHub/CI/cloud/terceiros automaticamente.

**Sucesso:** GPG e psql exit0, prefixo136 exato e inventário/relacionamentos/schema consistentes com a origem aprovada, índices/constraints íntegros, ausência de egress e evidência sanitizada. A ferramenta termina em `LOCAL_RESTORE_COMPLETE_REQUIRES_MANIFEST_REVIEW`; revisão do inventário/grants continua obrigatória. O ensaio não aplica migrations e não aprova B2/B3.

**Retenção/descarte:** ao terminar, parar e remover somente o contêiner/volumes descartáveis identificados na autorização, após validar confinamento; nunca o backup gerenciado/original. Reter a cópia cifrada no cofre por proposta de sete dias após a janela B3, sob responsabilidade definida, com exclusão específica revisada; não há agendamento automático. Dados decifrados não devem permanecer em disco/volume ou log. Se o descarte estiver bloqueado, preservar e registrar, sem contornar política.

**Interromper antes de dados reais** se recursos, criptografia, chave, TLS, contexto Docker, ensaio sintético, projeto, versão/extensão, custo ou responsável não estiverem comprovados. Durante o restore, qualquer saída não zero, hash divergente, egress, histórico/schema inesperado ou dado sensível em log impede PASS. B1-B só é executável após essas condições e aprovação expressa. B2/B3 e R1–R4 não recebem autorização/aceite por consequência.

### Integrações e próximos gates

PR55 TISS continua draft, HEAD observado `5ed630af2db0e0ba2076f011cf79e9241ba09a56`; journal de desenvolvimento contém a `0161_hi_guide_consulta_overrides`. **Aplicação da0161 no DEV NÃO VERIFICADA**: nenhum banco foi consultado nesta rodada. Não misturar seu journal ao SaaS160. Handoff UI/Payments permanece disponível, sem confirmação de leitura; risco relatado de credencial Asaas live com DEV continua separado, sem inspeção de `.env`, teste monetário ou alteração de contratos/worktrees.

B2-A e B2-B seguem preparados e não executados; as duas rotas WAF não cobrem API autenticada, Server Actions, chamadas internas e links externos. Revalidar guard/flags/coorte/runtime no deployment efetivo e preservar Asaas/pacientes/cron/retorno pago. B3 exige B1-B demonstrado, B2 aprovado, build do pacote e janela/responsáveis. **R1–R4 PARTIAL, nenhum aceite; renovação13/12 futura.** Datas16/17 de novembro permanecem propostas, sem agendamento.

> **Checkpoint prevalente — 15/11/2026:** a execução foi separada em **B0, B1, B2 e B3**, sem autorização implícita entre eles. Somente B0 está autorizado. Os pedidos conjuntos e a janela de 15/11 abaixo são histórico, não uma autorização. O candidato financeiro continua exatamente `94f6da4aeb32b1ae7da856dc9afa105120ce6dd9`, CI `43666101807` aprovada (7.209 testes/637 arquivos/22 E2E, zero teste ignorado). Alterações posteriores são ferramentas de operação, testes e documentação, com checks próprios no PR. **Production NO-GO; B1/B2/B3, Gate C e Gate D não executados.**

## B0 — resultado e limites da preparação de 15/11

- HEAD e PR draft confirmados pela API do GitHub antes das alterações; nenhuma mudança posterior no código da aplicação, nas migrations, no manifesto congelado, nas regras financeiras, nos preços ou nas cotas.
- **220 testes dirigidos/13 arquivos PASS**, incluindo 11 testes novos que usam os guards reais da composição Gate B em chamadas internas e HTTP. Banco, autorização e rede são doubles; isso não é um teste de Production ou do WAF real. A regressão adicional de extração UTF8 passou separadamente (1 teste).
- **22 testes de ferramenta B1** já estão incluídos nos 220: confinamento, preservação dos bytes UTF8, senha fora de argv e rejeição de falha GPG/psql. São doubles de processo; não comprovam restauração Docker real.
- O Docker está instalado, mas a consulta local retornou ausência do pipe do Engine. Não foi reinstalado ou iniciado sob pressão de memória. B1 exige Engine saudável e capacidade para o contêiner isolado; nenhuma restauração real foi executada.
- A primeira CI do HEAD operacional `4d98d232` passou em testes/segurança/isolamento, mas o build isolado não encontrou uma dependência de operador fora da sua cópia. A ferramenta B1 foi colocada na raiz `scripts/`, junto dos operadores dos quais depende; não foi ampliada a cópia do build nem alterado CI/configuração. O novo HEAD precisa de CI própria; a falha anterior não foi marcada como sucesso.
- Encontrado defeito de empacotamento, sem alterar billing: o bsdtar do Windows extraía nomes UTF8 do Git usando a página de código local. Corrigida a extração com `hdrcharset=UTF-8` no Windows, com regressão nativa. O novo export usa sufixo próprio e preserva o anterior.
- [Atestado do pacote](migrations/release-artifact-94f6da4a.json): arquivo local `dist/qoro-saas-94f6da4a-gate-b0.tar`, SHA256 `3902f2007742df4016450eeaece806a8f2bc0b535631d33da9a5e691b59ce3f6`. Foram conferidos 2.593 arquivos fora das migrations contra seus blobs Git e 160 hashes SQL. A referência é imutável por conteúdo verificável, não armazenamento WORM. Não foi feito upload, assinatura privada ou novo build desse export.

### Backup habilitado não equivale a B1 aprovado

| Condição | Evidência atual |
|---|---|
| Serviço gerenciado habilitado | **Informado pelo titular em 15/11**; não tratar como desabilitado |
| Última cópia, tipo, status e UTC | Não consultados nesta rodada; o inventário de 21–28/10 é histórico |
| Plano e retenção | Última leitura organizacional: Pro. Se ainda for Pro, a documentação prevê sete dias de cópias diárias; reconfirmar o plano e a janela efetiva |
| PITR | Não presumido e não será contratado/ativado |
| Integridade/restore da cópia gerenciada atual | Não comprovados pelo botão Restore |
| Restore lógico anterior | PASS histórico, preservado; não prova o ponto de recuperação atual |
| Cópia adicional pré-implantação | Não criada. Proposta: dump lógico cifrado atual, com restauração isolada, sem snapshot gerenciado pago |

Fontes verificadas em 15/11: [backups](https://supabase.com/docs/guides/platform/backups), [backup/restore lógico](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [clone gerenciado](https://supabase.com/docs/guides/platform/clone-project). A cópia lógica não equivale a restaurar a cópia física gerenciada. Storage binário e configurações gerenciadas Auth não são comprovados pelo dump; seguem o runbook de recuperação separado. O changelog informa CLI v3 com mudança de comportamento; manter o CLI v2 já validado, sem upgrade automático.

### Preflight: composição e diferenças históricas

O pacote é a composição congelada de **160 entradas, índices 0000–0159**, não o journal da branch TISS nem uma seleção de arquivos por contagem. Production deve ter exatamente o prefixo de 136 entradas até 0135 antes da aplicação; pendentes 0136–0159. O campo `expectedInitialHistoryEntries=144` do manifesto original descreve a preparação DEV anterior, não uma autorização para usar 144 em Production. `readFrozenRelease` recompõe os inputs Git e o preflight de Production exige 136/160 nas fases before/after. A 0160 continua excluída.

Reutilizadas, sem repetir o banco sintético completo, as 16 verificações do ensaio 136→160 e as 52 de compatibilidade. Nesta rodada passaram novamente os testes unitários de journal, composição e preflight, incluindo ausência, conteúdo/hash, ordem, timestamp, duplicação, prefixo parcial, entrada fora do journal e schema/RLS incompatível. O inventário de catálogo complementa esse preflight; não aprova automaticamente todo drift.

As seis exceções históricas registradas no DEV foram conferidas contra os bytes Git de 94f6da4a:

| Tags | Resultado e condição para B2 |
|---|---|
| 0033, 0037, 0071 | Hashes aplicados equivalem exatamente ao mesmo SQL com CRLF; não indicam mudança de DDL |
| 0051, 0093, 0124 | Não equivalem ao LF/CRLF atual; não foi localizado corpo com o mesmo hash no histórico Git local consultado. A origem semântica não está comprovada apenas pelo checksum |

O preflight reconhece pares históricos específicos de tag/timestamp/hash; isso não autoriza dispensar a comparação do schema. Em B2, se esses três hashes aparecerem em Production, exigir comparação do catálogo/restauração atual com o estado esperado e análise dos objetos afetados antes de B3. Não transformar exceção DEV em aceite genérico de drift, não editar o journal e não reaplicar migrations antigas para zerar alertas. **Se o schema ou o journal de Production divergirem do manifesto aprovado, interromper antes da primeira alteração.**

### Inventário adversarial dos caminhos de aquisição

| Caminho | Proteção no candidato | Limite da prova e teste B2 |
|---|---|---|
| `POST /api/signup/sessions` | `SIGNUP_ENABLED=false`, antes da criação | Incluir na regra temporária; confirmar evento WAF, não só HTTP |
| `POST /api/signup/checkout` | Mesmo kill switch, inclusive sessão antiga; sem fornecedor antes do guard | Regressão existente preservada; negar antes da troca do deployment |
| `POST /api/billing/checkout` | Autorização fresca/tenant do servidor; `createDeferredSubscriptionCheckout` exige runtime e allowlist | Não é coberto pela regra de dois paths. No candidato, runtime desarmado bloqueia antes de DB/provedor; verificar se existe no código publicado antes da troca |
| Recontratação e reuso | `createAbacatePayRecontractCheckout` exige aquisição permitida; criação normal verifica runtime/coorte antes de recuperar link | Uma flag local não revoga um link externo já entregue. Inventariar links e obrigações em B2; ambiguidade interrompe B3 |
| `POST /api/billing/plan-change` e chamadas internas | Guard de runtime; tenant/permissão e contrato validados | A flag de checkout sozinha não desliga gestão de contratos. A composição Gate B desarma o runtime somente se não houver obrigação live AbacatePay |
| Server Actions em `/configuracoes/assinatura` | Gestão Asaas exige identidade/permissão fresca, tenant e origem persistida; contratos AbacatePay são rejeitados no ramo legado | Não estão cobertas pelo firewall de cadastro. Preservar gestão legítima Asaas, inclusive alterações financeiras já disponíveis; não equivale a zero atividade financeira global |
| Webhook/cron/recuperação AbacatePay | Runtime desarmado antes de trabalho; quatro ticks permanecem no-op | Não desligar cron global, workers ou webhooks Asaas para conter nova venda |
| `/api/signup/checkout/status`, callbacks, login e áreas clínicas | Recuperação de obrigação existente continua disponível | Nunca bloquear prefixo `/api/signup` nem todos os POSTs financeiros |

No código auditado não há rewrite/alias de aquisição em `next.config.ts`, `vercel.json` ou middleware; o rewrite de documentação e o túnel Sentry não são aquisição. Os helpers internos não atravessam necessariamente o firewall; os guards permanecem obrigatórios. O adapter de baixo nível não é uma rota pública nem deve ser invocado fora das entradas privilegiadas inventariadas. Mudança de código no ramo publicado ou novo chamador exige nova revisão, não extrapolação da prova.

**Regra WAF proposta, não criada:** Environment Production AND Method POST AND Route exata em `/api/signup/sessions`, `/api/signup/checkout` → Deny. Usar o campo de plataforma, não um teste de igualdade sobre cabeçalho HTTP enviado pelo cliente. A Vercel documenta Route após middleware e também seleção de Server Action; não presumir que uma regra de API protege todas as Actions. [Parâmetros oficiais](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration).

**B2 testa sem risco de pagamento:** apenas requisições sem credencial válida de contratação, corpo vazio/inválido e cookie sintético sem identidade. Variar path canônico, barra final, query string, codificação/normalização, método, headers `Origin`, `Next-Action` e `x-matched-path`; observar qual rota foi resolvida e o ID da regra aplicada nos logs WAF. Redirecionamento/rejeição pelo framework é distinto de bloqueio pela regra. Confirmar que GET/HEAD e as rotas de status/callback/webhooks legados não são atingidos. Não usar conta de lead, sessão real pronta para pagar ou token válido para experimentar uma barreira ainda não comprovada. Nenhuma conta será criada só para essa prova.

Sem correspondência inequívoca, com bypass/regra anterior conflitante ou rota alternativa publicada capaz de criar obrigação, B2 fica pendente e B3 não avança. Falha de WAF não pode abrir o backend candidato; falha de configuração do runtime fecha a operação. Não prometer disponibilidade do WAF nem seu comportamento fail-open/fail-closed sem observar o projeto real.

### Matriz de preservação dos serviços

| Serviço | Evidência disponível | Verificação futura sem fabricar pagamento |
|---|---|---|
| Asaas legado / pacientes | Código da aplicação idêntico ao RC; regressões e CI aprovadas preservadas | Origem/credenciais preservadas, leitura de estado e logs; sem cobrança nova de teste |
| Outbox/cron/workers | Testes de cron dirigido PASS; quatro ticks AbacatePay no-op com guards reais | Heartbeats, filas e ausência de novo consumidor live; não disparar cron financeiro global manualmente |
| Redis/inbox | Guard desarmado impede trabalho novo AbacatePay; testes de contrato anteriores preservados | Conectividade e idade de filas em leitura; não drenar/processar para provar saúde |
| Auth/permissões/RLS | Regressões/isolamento da CI 94f6da4a preservados; HTTP usa tenant do servidor | Smoke legítimo após B3; doubles locais não comprovam MFA Production |
| Entitlements/trial | Sem mudança de código/SQL, flags não removem períodos pagos nem reiniciam trial | Fingerprints anteriores/posteriores e leitura dos direitos; assinatura SaaS não libera TISS automaticamente |
| Dashboard/recuperação paga | Build/CI do RC e teste de status de checkout preservados | Smoke após deployment, com obrigações anteriores intactas; sem novo lead/checkout |

## Autorizações independentes — formulários prevalentes

### Pedido 1 — B1-B em ambiente alternativo, ainda não autorizado

B1-A já concluído para o inventário físico. Plano/retenção atuais exigem somente a conferência mínima descrita acima. Não refazer o inventário dos oito backups. O formulário antigo dependente deste Windows foi substituído; não executar os comandos históricos do notebook.

| Campo                  | Proposta preenchida / decisão pendente                                                                                                                                                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Finalidade             | Uma cópia lógica cifrada nova e um restore estrito isolado, sem migrations, gateways ou alteração do serviço ativo                                                                                                                                                                                                                     |
| Fonte                  | Projeto de nome qoro-prod; REF/host/usuário exatos a conferir na futura janela autorizada; nunca DEV pqhkirrszzpwezdaqrai                                                                                                                                                                                                              |
| Pacote de referência   | Financeiro94f6da4a, TAR3902f200… e manifesto congelados; comparar journal esperado136 e schema sem aplicar0136–0159                                                                                                                                                                                                                    |
| Ambiente proposto      | B: VM Linux privada temporária, Docker local Unix; A pode substituir se comprovadamente disponível e aprovada. Nenhum host criado/identificado                                                                                                                                                                                         |
| Identidade/localização | Provedor, conta, região, ID da VM ou máquina física e responsável de custódia: **a escolher/aprovar**                                                                                                                                                                                                                                  |
| Capacidade             | Preferência16GiB/4vCPU; reserva cifrada50–100GiB a confirmar com inventário autorizado. Limites do contêiner não ampliados; insuficiência interrompe                                                                                                                                                                                   |
| Janela                 | Até4h de operação e24h de existência proposta, data/horário/fuso a combinar após aprovação do host; não é agendamento                                                                                                                                                                                                                  |
| Custo                  | B: reserva estimativa US$5–20/janela, sem cotação contratual. Orçamento regional, teto, taxas, egress e custos residuais a aprovar; não autorizado agora                                                                                                                                                                               |
| Operações/dados        | Após aprovação B1-B: dump somente leitura no host aprovado pelo helper existente, public+auth+journal e demais schemas não excluídos pelo helper; GPG em stream, conferência de hash, restore em contêiner inerte e integridade. Exclusões de storage/vault/serviços gerenciados documentadas; não chamar esse dump de backup integral |
| Chaves/TLS             | Cofre separado recuperável no host aprovado, sem Production no notebook/Actions; verify-full/CA/identidade conferidos durante B1-B, nunca fallback inseguro                                                                                                                                                                            |
| Retenção/descarte      | Proposta: memória temporária descartada ao encerrar; cifra até7dias após drill em destino independente aprovado; sem snapshots. Descarte somente dos recursos próprios identificados, explicitamente abrangido na autorização; original preservado                                                                                     |
| Responsáveis           | Técnico/operacional/incidentes/custódia de chaves/descarte: **funções e pessoas a designar pelo titular**, sem disponibilidade presumida                                                                                                                                                                                               |
| Evidência de aprovação | Identificador do host, escopo exato de dados/operações, janela, responsáveis, limites de custo/retenção e autorização expressa registrados antes de qualquer conexão                                                                                                                                                                   |

**Duas liberações diferentes:** aprovar provisionamento e teste sintético de contenção **não** libera cópia real. Só solicitar autorização B1-B de dados após identificar o ambiente e comprovar os controles. Uma resposta futura pode aprovar ambos os escopos explicitamente, mas não presumir que isso ocorreu. Neste ciclo nenhum dos dois está aprovado.

Procedimento futuro, exclusivamente no ambiente aprovado:

1. Comprovar identidade, capacidade, cifragem, acesso/cofre, política de memória/temporários, ferramentas fixadas e bloqueio de rede **antes** dos dados; provar contenção com fixture sintética sem repetir desnecessariamente o ensaio integral já aceito. Não iniciar app Qoro, cron ou serviços externos.
2. Após autorização B1-B de dados, validar origem e TLS verify-full. Carregar segredos somente no processo protegido, sem .env Production copiado, argv/histórico ou keyring pessoal. Liberar temporariamente apenas a conexão de leitura necessária. Usar scripts/db-backup-prod.ts e scripts/prod-encrypted-backup.ts com cwd privado fora do pacote, dependências verificadas no novo host e diretório/chave aprovados. Não importar os helpers no notebook para testar configuração.
3. Registrar snapshot/UTC/escopo/versões/bytes/SHA256 e saídas pg_dump/GPG; marker final não substitui restore. Fechar conexão e exceção de saída da origem, remover credenciais de origem dos processos e provar quarentena antes da decifragem. Falha parcial não gera backup aprovado.
4. Criar destino com os controles do item5 acima e inspecionar ID completo/label/rede/logs/tmpfs/cron/limites. Executar scripts/gate-b-isolated-restore.ts no próprio host, com paths/cofre aprovados; a opção --authorize-local-real-data somente significa autorização explícita para dados reais nesse host, nunca uma forma de testar fixture ou contornar a proibição do notebook. Sem migrator, aplicação ou credenciais de gateways.
5. Exigir GPG=0 e psql=0/ON_ERROR_STOP, inventário do mesmo snapshot, schema/dados/journal/hash/ordem, índices/constraints/FKs, funções/RLS e revisão das diferenças de roles/grants. Prefixo136 é a expectativa histórica, não presunção do estado atual. Drift interrompe, não reescreve journal. O resultado LOCAL_RESTORE_COMPLETE_REQUIRES_MANIFEST_REVIEW exige revisão humana/técnica, não aprovação automática do B1-B.
6. Avaliar serviços separadamente: dump exclui storage/vault e outros schemas do helper, --no-owner/--no-acl não recupera todas as permissões, e bytes Storage/chaves externas/Auth gerenciado precisam de seus próprios procedimentos. Não remover essas dependências do critério de recuperação por conveniência; não copiar arquivos adicionais sem escopo explícito.
7. Guardar evidência sanitizada fora do Actions: origem não secreta, hash/tamanho/tipo/UTC, IDs do destino, versões, início/fim/duração, saídas, inventário/integridade e resultado. Sem linhas clínicas, endereços, comandos de jobs ou stderr bruto. Falha TLS/isolamento/capacidade/hash/paridade implica parada e investigação sem mutação Production.
8. Descartar somente recursos próprios autorizados, verificar processos/volumes/snapshots/custos e preservar a cifra conforme retenção aprovada/chave separada. Sem sucesso parcial aceito, limpezas globais ou destruição do original. Registrar tempo do drill; não extrapolar RTO de serviço completo.

**B1-B NÃO APTO / NÃO AUTORIZADO.** Não há autorização de conexão, dump, download, clone, restore real ou descarte real neste ciclo. Aprovar B1-B não aprova B2-A/B2-B/B3/C/D/E nem R1–R4.

### Pedido 2 — B2: preflight em leitura e contenção, separados

**B2-A, consultas read-only:** conexão do projeto Production exato, permissão atual de leitura de histórico/catálogos/contratos e observabilidade. Sem concessão de privilégios, PAT novo, DDL, processamento de filas ou configuração. Executar em janela exclusiva de mudanças de schema, com segredos somente de processo:

```powershell
node --conditions=react-server --import tsx scripts/abacatepay-release-preflight.ts --release 'dist/abacatepay-saas-94f6da4a-b0-utf8' --ref '94f6da4aeb32b1ae7da856dc9afa105120ce6dd9' --project '<REF_PRODUCTION_APROVADA>' --phase before
psql -X --set=ON_ERROR_STOP=1 --no-align --tuples-only --file docs/decoupling/asaas-to-abacatepay/migrations/gate-b-catalog-readonly.sql
```

O primeiro exige `SUPABASE_PROJECT_ENV=prod`/`DATABASE_URL_PROD` conferidos. O segundo exige PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE e PGOPTIONS read-only para **o mesmo alvo**. Não colar senha/URI em argv. Conferir roles, grants, funções, policies, triggers, índices, dependências, fingerprints de contratos/preços e os três hashes históricos acima; inventariar obrigações AbacatePay e links externos. Reconfirmar DEV161 separadamente apenas como contexto, não como prova de Production. Observar locks, transações longas e saúde de filas sem executá-las. Critério de sucesso: prefixo136 exato,24 pendentes,sem0160 e nenhuma divergência não explicada. Resultado passa a expirar diante de qualquer mudança de schema/manifesto; repetir imediatamente antes de B3.

**B2-B, alteração live — aprovação distinta:** snapshot protegido das flags e regras, instalar/conferir a regra proposta e aplicar flags apenas ao deployment explicitamente autorizado. Alterar variável não modifica deployments existentes; **B2 não autoriza redeploy**. A guarda corrigida só existe no candidato; o fechamento do código antigo depende da contenção WAF comprovada e dos links anteriores tratados. Confirmar quota/permissão, ID/prioridade/bypass/rotas resolvidas e preservação dos caminhos legados. Não aceitar a presença de chave ou uma resposta403 como prova suficiente. Testes seguros estão no inventário acima.

Antes de B2-B/B3, combinar com os responsáveis UI/TISS uma janela sem outro merge/deploy/configuração Production. Isso é uma condição operacional a confirmar, não um mecanismo de freeze já instalado. Outro deployment ou alteração observada invalida o preflight e exige nova conferência; não editar a CI ou worktree alheio para impor esse controle.

Em B2, identificar também o deployment/código que estiver realmente publicado. Se houver mudanças Production posteriores à base do candidato, comparar seu impacto e não sobrescrevê-las silenciosamente com o RC antigo. Uma composição adicional necessária exige baseline, testes e aprovação próprios; o estado atual da branch main não prova qual versão está servindo.

**Reversão B2-B:** guardar ID/versão da única regra temporária e snapshot anterior. Remover/restaurar somente essa regra se aprovado e sem abrir aquisição; não mexer nas outras regras. Flags exigem novo deployment para surtir efeito, o que continua sob B3 ou autorização independente de recuperação. Se consumidores/obrigações AbacatePay live existirem, não desarmá-los: parar e repropor a composição. Falha de contenção mantém B3 NO-GO.

### Pedido 3 — B3: migrations e deployment fechado

- **Candidato financeiro:** SHA94f6da4a completo acima; archive/SHA256 do atestado. O HEAD posterior de ferramentas/documentos não substitui esse candidato e precisa de CI própria. Não usar o HEAD móvel de UI/TISS/main. Na extração Windows usar `hdrcharset=UTF-8`; conferir arquivo e manifesto antes de instalar dependências/build, sem copiar `.env`/sessão DEV.
- **Pré-condições:** B1 aprovado com manifesto/recuperação; B2-A atual aprovado e B2-B comprovado, autorizações expressas de SQL/deployment, nomes dos responsáveis e rollback. Sem nova compra ou aceite R1–R4.
- **Janela proposta, não reservada:** B1 em **16/11/2026 10h–11h**, America/Sao_Paulo, se houver autorização e recursos. B2 em janela própria após B1; B3 proposto para **17/11/2026 10h–11h**, condicionado aos gates anteriores, sem execução automática. Os60min de cada proposta são orçamento de planejamento, não RTO. A proposta15/11 não foi aprovada nem será executada por passagem de horário.
- **Responsáveis técnico, operacional, financeiro quando aplicável, incidentes e rollback:** a definir pelo titular; o agente não representa automaticamente esses papéis.
- **Ordem futura:** verificar hash e extrair duas cópias novas, fora dos worktrees Git: uma cópia SQL em diretório protegido de recuperação e outra cópia limpa só para deployment → revalidar B1/B2 → migrator a partir da cópia SQL160 → pós-voo160/contratos/RLS/índices → build/deploy da cópia limpa com flags fechadas → smoke não monetário/monitoramento → encerrar ainda fechado. Não publicar a pasta usada pelo migrator: ele cria backup cifrado em `backups/`, e essa cópia sensível não deve integrar o upload Vercel. Conferir o digest do conteúdo limpo antes do build/link; não confiar só em regras de ignore.
- **Comando SQL futuro:** `node --import tsx scripts/db-migrate-prod.ts`, **com cwd na cópia SQL protegida**, dependências do lockfile disponíveis, ambiente Production carregado por processo e `.env` DEV ausente. O preflight não é hook automático desse comando. Revalidar imediatamente antes a partir do worktree de ferramentas, apontando `--release` para essa cópia; não usar o journal143 do worktree financeiro nem161 do DEV. Confirmar timeout no próprio processo migrator: o advisory lock da conexão auxiliar não garante limite da outra sessão. Sem timeout/observação de espera verificados, não iniciar.
- **Pós-voo:** repetir preflight `--phase after` na composição aprovada;160 entradas exatas,sem0160, fingerprints/entitlements/roles/constraints sem perda. Qualquer diferença financeira, contrato alterado, índice inválido ou schema parcial interrompe antes do deployment.
- **Concorrência legítima:** Asaas/cron continuam operando. Uma diferença entre fingerprints pode ser pagamento/renovação legítimos ocorridos entre leituras; correlacionar auditoria/eventos e registrar a explicação antes de avançar. Nunca reverter período pago ou apagar invoice para voltar ao hash anterior.
- **Deployment futuro:** somente na cópia limpa, `vercel link --yes --project project-os --scope clinic-os-v2-s-projects` e `vercel deploy --prod --scope clinic-os-v2-s-projects`. Conferir identificação e variáveis antes de build, domínio/artefato e logs depois; não promover Preview com ambiente DEV, não fazer merge. Fora do Git, o deploy pode não apresentar SHA inferido: registrar o SHA financeiro, hash do pacote e ID do deployment na evidência operacional, sem atribuir o HEAD móvel do worktree como prova do código publicado. Estado financeiro novo continua desarmado.
- **Sucesso:** serviço saudável, aquisição bloqueada, cron/Asaas/pacientes e acesso clínico preservados, zero efeito financeiro inesperado, evidências UTC e alertas operacionais. Não testar cobrança real.
- **Interrupção:** backup inválido, drift, perda de saúde, barreira insuficiente, chamada financeira nova/ambígua ou ausência de responsável. Parar antes do próximo estágio e usar rollback por camada abaixo; sem DOWN, refund, exclusão de invoices ou remoção de períodos pagos.

**B3 não inclui Gate C, Gate D ou expansão. R1–R4 continuam PARTIAL e sem aceite.** O próximo pedido útil é B1, não uma autorização conjunta para SQL, firewall e deploy.

Preparado em 14/11/2026. **Preparação autorizada; execução NÃO autorizada. PR #53 draft. Production NO-GO.** Este procedimento complementa o [runbook](../../runbooks/abacatepay-operacao.md) e o [dossiê](ABACATEPAY-SaaS-GO-NO-GO-FINAL.md); não abre janela, aplica SQL ou aceita R1–R4.

## Candidato e correção indispensável

- Repositório `joaomarcos-techia/Project_OS`, PR #53, branch `feat/billing-abacatepay-20261107`.
- Baseline aprovada: `10e5d43b131cfd6852c5471f93151b8596690514`, CI43648783989, 7.206 testes/637 arquivos e22 E2E sem SKIP. Provas preservadas, não reexecutadas por inferência.
- Novo defeito de fechamento reproduzido: a entrada do cadastro verificava `SIGNUP_ENABLED`, mas `POST /api/signup/checkout` não. Uma sessão anterior alcançava Checkout Asaas ou provisionamento de trial com aquisição fechada. Os dois testes novos falharam com HTTP200 em vez de503.
- Correção localizada na mesma rota: respeitar o kill switch antes de consultar sessão/limitador/provedor. `POST /api/signup/checkout/status` continua disponível para reconciliar obrigação existente; não se desligaram flags de identidade/Auth, cron, webhooks ou contratos Asaas. Os contratos HTTP e o erro503 existente foram preservados.
- Depois da correção: **123 testes dirigidos/6 arquivos PASS**. TypeScript e lint dirigidos PASS. O novo SHA e seus checks oficiais precisam constar do checkpoint final do PR; não usar a CI do10e5d43b para aprovar esta alteração.
- O runtime restante, SQL das migrations, catálogo, preços, cotas e dependências permanecem congelados. Não existe flag funcional `SIGNUP_CHECKOUT_ENABLED` no parser atual; não usá-la como proteção.

## Composição proposta — somente após GO explícito

| Configuração existente | Valor proposto no deployment Gate B | Justificativa |
|---|---|---|
| `SIGNUP_ENABLED` | `false` | Fecha entrada e criação/provisionamento na rota de checkout, inclusive sessões anteriores |
| `SIGNUP_AUTH_ENABLED`, `SIGNUP_IDENTITY_ENABLED` | Preservar valores atuais habilitados | Mantém leitura/retorno e recuperação de pagamentos existentes; não usar como kill switch |
| `SAAS_SIGNUP_PROVIDER` | `asaas` ou ausência que resolve para `asaas` | Não seleciona aquisição AbacatePay. O kill switch acima impede nova contratação pelo fallback |
| `ABACATEPAY_NEW_CHECKOUTS_ENABLED` | `false` explícito | Segunda barreira para nova obrigação AbacatePay |
| `ABACATEPAY_CHECKOUT_CLINIC_IDS` | String vazia explícita | Coorte vazia é rejeitada; não preencher UUID fictício nem abrir piloto |
| `ABACATEPAY_ENVIRONMENT` | Ausente, não `production` nem string inventada | Em `VERCEL_ENV=production`, o guard nega tanto live quanto Sandbox; chave/loja presentes não ativam o runtime |
| `OFFER_2026_ANNUAL_NEW_SALES_ENABLED` | Preservar `false` | Sem nova venda anual ou alteração de contratos anteriores |
| Vercel `VERCEL_ENV`, `NODE_ENV` | Valores de sistema do deployment Production | Não falsificar essas variáveis para contornar o guard |
| API keys, loja, catálogo, segredo, Redis, Auth, Asaas | Preservar os segredos específicos de Production | Não copiar DEV; presença não comprova valor ou saúde. Não imprimir os valores |

Qualquer mudança de variável só passa a valer em **novo deployment**. O deployment Production anterior não conhece a correção da rota: fechar somente a configuração nele não prova fechamento de sessões já iniciadas. A janela deve conter criação de novos checkouts durante a transição por controle de tráfego aprovado, ou manter a operação em NO-GO até o novo deployment estar servindo. Não inventar uma regra WAF/flag que não esteja implementada/configurada; qualquer contenção adicional requer escopo explícito no GO.

### Barreira de transição proposta — mudança Production ainda não autorizada

A Vercel documenta regras customizadas com filtros **Environment, Route, Method** e ação **Deny**. Proposta concreta no projeto `project-os`: regra identificada `qoro-gate-b-signup-closed`, **Environment=Production AND Method=POST AND Route em [`/api/signup/sessions`, `/api/signup/checkout`]**, ação Deny. Comparação de rota exata; não usar prefixo `/api/signup`, que bloquearia status/retorno. A condição Route executa após middleware; conferir comportamento com path canônico, barra final e normalização antes de qualquer DDL. Não adicionar `@vercel/firewall`, rate limiting pago, managed ruleset ou configuração de build. [Parâmetros e ações oficiais](https://vercel.com/docs/vercel-firewall/vercel-waf/rule-configuration).

A [documentação atual de cobrança](https://vercel.com/docs/vercel-firewall/vercel-waf/usage-and-pricing), conferida14/11, informa que custom rules são gratuitas e tráfego negado não gera CDN Requests/FDT. Isso não promete fatura global zero ou capacidade disponível de regras na conta. Conferir limite/permissões e ordem/bypass existentes;se exigir upgrade,parar sem contratar. **Nenhuma regra foi criada nesta rodada.** Esta barreira é mudança de escopo que precisa constar expressamente da autorização GateB. Se não for aprovada ou verificável,o procedimento permanece NO-GO para uma transição garantidamente fechada. Não substituir por desligamento global de Auth/cron.

Na janela autorizada, guardar ID/versão anterior e evidência de bloqueio sem credenciais. Antes de mutação de banco: confirmar que POSTs de criação são negados e status/login/Asaas/webhooks existentes permanecem acessíveis com testes sintéticos não monetários. Após promoção,verificar também o guard503 da aplicação por caminho de teste aprovado,não criar bypass público para isso. Manter a barreira/kill switch até autorização expressa de reabertura;retirar somente a regra temporária aprovada,nunca apagar outras regras do projeto.

**Parada obrigatória:** não desarmar runtime se houver obrigação AbacatePay live existente. Reconfirmar código publicado, origem das assinaturas e existência de vínculos/eventos/receipts na janela. Nesse caso, esta composição não é aplicável: parar, preservar consumidores e propor janela que os mantenha. Não inferir ausência apenas de zero webhooks ou do histórico anterior.

## Matriz de impacto

“Antes” abaixo é o último snapshot documentado de14/11, não nova leitura de Production nesta rodada. Valores efetivos, drift e obrigações devem ser reconfirmados na janela.

| Componente | Estado antes | Estado previsto após Gate B | Risco | Como verificar |
|---|---|---|---|---|
| Aquisição SaaS AbacatePay | Não publicada/ativada no último snapshot; seleção ausente | Fechada, sem trial/contratação novos | Flags antigas ou sessão prévia | SHA efetivo + flags propostas + HTTP503 na entrada/rota de criação com fixture sintética autorizada; zero tentativa/provedor novo |
| Checkout live | Catálogo existe; habilitação não autorizada | Nenhum checkout AbacatePay criado; ramo Asaas de aquisição bloqueado | Links hospedados antigos não são revogados por flag local | Inventariar tentativas/links pendentes por metadados. Se algum link externo ainda aceitar nova venda, parar e tratar seu escopo; não cancelar automaticamente |
| Webhook live | Zero configurações no último GET conhecido | Não cadastrado/ativado; rota503 pelo runtime desarmado | Confundir503 com teste de HMAC | Readback autorizado do provedor e teste HTTP não monetário.503 esperado não equivale a autenticidade validada |
| Consumidores financeiros | Asaas atende obrigações existentes | AbacatePay no-op antes de banco/provedor; Asaas preservado | Desligar cron inteiro prejudica outras clínicas | Guards em `acquisition.ts` e jobs; tests de processing/outbox; heartbeats e ausência de chamada AbacatePay no alvo |
| Scanner | Implementado na candidata, sem operação live comprovada | AbacatePay recovery/integrity/watch/closure no-op | Kill de checkout sozinho não o desliga | Guard de runtime + zero trabalho/HTTP AbacatePay; não invocar scan global para fabricar prova |
| Cron | Outbox por minuto; billing-reconcile/dunning diários; jobs de pacientes | Agenda e cron compartilhados continuam | Efeitos financeiros Asaas existentes continuam por desenho | `vercel.json`, `withCron`, heartbeats, ledger e saúde de filas; não acionar manualmente um cron financeiro global |
| Entitlements | Contratos legados e permissões vigentes | Preservados, sem novo direito pago ou nova cota | Alteração de schema/claims/RLS | Fingerprints de contratos/catálogo, postflight, login/MFA e regressão dirigida com dados sintéticos |
| Assinaturas legadas Asaas | Permanecem no Asaas | Reconciliação/webhooks/cancelamentos existentes preservados | Trocar key, provider global ou bloquear retorno pago | Credenciais/origem preservadas; rota de status e jobs Asaas não desarmados; hashes/condições antes/depois |
| Cobranças de pacientes | Asaas por conta/credencial da clínica | Continuam operacionais | Confundir assinatura Qoro com cobrança do paciente | Não alterar client/conta/chaves/rotas Asaas de pacientes; smoke de leitura, sem nova cobrança de teste |
| Convênios TISS | Desenvolvimento separado;0160 só no DEV conhecido | Código/menu/rota funcional fora do pacote; não habilitar módulo | SQL compartilhado necessário ao journal | Manifesto congelado160,24 pendentes,0160 ausente; entitlements não ativam `hi_clinic_settings.enabled` |

**Limite da exclusão “sem cobrança real”:** o operador não criará obrigação/teste monetário novo. Não significa impedir cobranças legítimas que o Asaas já executa nem desligar fluxos financeiros existentes dos clientes. Nenhum kill switch isolado desliga com segurança cada componente compartilhado.

## Preflight e ensaio: provas separadas

Já comprovado e reutilizado por identidade dos160 hashes: ensaio descartável136→160,24 migrations reais,16 verificações,cinco contratos legados sintéticos preservados;52 verificações de compatibilidade161. Duração de aplicação local cerca de4,9s, **não estimativa de locks/duração em Production**. Não houve repetição desse ensaio nem nova consulta de Production nesta rodada.

O preflight existente confere projeto/ambiente/journal/hash/ordem/pacote contra Git e objetos financeiros críticos em REPEATABLE READ READ ONLY. Bloqueia entrada ausente,hash/sequência divergentes,pacote incompleto e schema crítico incompatível. Não é comparação completa de todo o Supabase nem hook do migrator: a ordem de operações abaixo é obrigatória e exige janela exclusiva.

Complemento preparado: [inventário SQL somente leitura](migrations/gate-b-catalog-readonly.sql), com relações/colunas/grants,funções,triggers,policies,índices,constraints,dependências e locks. Definições saem como hashes,sem corpos de função ou dados clínicos. **É inventário, não aprovação automática de drift.** Comparar com o schema136 autorizado/restore do mesmo backup e com o delta SQL revisado0136–0159. Adições gerenciadas do Supabase ou diferenças legítimas exigem revisão explícita; nunca aceitar qualquer diferença apenas porque o journal confere. Se não houver baseline confiável suficiente para uma categoria, marcar pendente e parar antes do DDL.

Nova execução isolada do complemento: **4 checks PASS**,nove seções;detectou função adicionada e RLS desabilitado,com sete seções estruturais iguais ao estado inicial após reverter as alterações sintéticas. Cerca de0,7s apenas para essas consultas;scaffold e136 arquivos SQL reais,sem clone de Production. Zero conexão de Production/provedor e zero leitura de registro clínico. A primeira execução do harness recusou BEGIN em pool não reservado (`UNSAFE_TRANSACTION`);o harness foi corrigido para reservar conexão,sem alterar a SQL ou contornar o driver. Não confundir este teste com o ensaio anterior das24 migrations ou validação de todo schema Production.

Na janela autorizada, em console dedicado, na pasta do pacote exportado do SHA aprovado, com segredos Production carregados pelo mecanismo aprovado e nunca em argumentos/logs:

```powershell
node --conditions=react-server --import tsx scripts/abacatepay-release-preflight.ts --release '<PACOTE_APROVADO>' --ref '<SHA_COMPLETO_APROVADO>' --project '<REF_PRODUCTION_APROVADA>' --phase before
```

Somente com código de saída0,136 entradas exatas e24 pendentes. Não preencher `<REF_PRODUCTION_APROVADA>` por suposição. Não executar a0160; se ela ou qualquer entrada inesperada aparecer, parar e revisar nova composição.

Para o suplemento, `psql -X --set=ON_ERROR_STOP=1 --no-align --tuples-only --file docs/decoupling/asaas-to-abacatepay/migrations/gate-b-catalog-readonly.sql`, **somente** com `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE` carregados de forma protegida para o mesmo alvo já conferido e `PGOPTIONS=-c default_transaction_read_only=on`. Não colocar URL/senha no comando. Guardar somente JSON técnico em destino restrito. Não executar essas instruções em Production nesta preparação.

Antes/depois, comparar em transação somente leitura contagem e fingerprint de `subscriptions` (campos anteriores, excluindo a coluna nova `billing_provider`), `plans` e `prices`, usando o procedimento já ensaiado em `scripts/abacatepay-release-rehearsal-db.ts`. Conferir último titular, hook/claims, RLS/grants, FKs/constraints validadas e índices válidos. Nada de alterar linhas para fazer uma comparação passar.

## Backup, recuperação e ferramentas

| Evidência | Estado e alcance |
|---|---|
| Restore real30/10 | PASS histórico: backup cifrado SHA256 `488e407815e36d42ea595ed599d7b7f925ad49434d4c6a449f2d4894acc4a992`, Supabase/Postgres17.11 e Vault0.3.1, public+auth e15 migrations anteriores; execução04:20:30–04:20:57UTC, cerca de26,5s. Não é o pacote136→160 nem um RTO de Production |
| Restore Storage/Auth | Provas históricas no [runbook de recuperação](../../runbooks/disaster-recovery.md); não repetir ou tratar como snapshot atual |
| Backup físico gerenciado | B1-A identificou oito físicos COMPLETED/PITRoff; não relistar. Plano/retenção atuais e restauração física/integridade/RTO seguem sem prova; não clicar Restore |
| Backup pré-Gate B | AINDA NÃO CRIADO. Necessário dump lógico cifrado public+auth/journal, hash, tamanho, versões e restauração estrita isolada antes de qualquer DDL |
| Arquivo histórico28/10 | Não encontrado no caminho documentado nesta máquina. Isso não invalida o restore histórico,mas esse caminho não pode ser usado como prova de cópia disponível agora |
| Ferramentas | Versões Windows são evidência histórica, não pré-requisito para retomar neste notebook. Novo host deve conferir PostgreSQL/GPG/Docker compatíveis; imagem17.11 ensaiada preservada |

O script `db-backup-prod.ts` transmite SQL ao GPG sem gravar plaintext; `prod-encrypted-backup.ts` confere saída e marcador final por stream. **Marcador final não substitui restore estrito.** O dump não inclui bytes Storage,segredos/configurações externas Auth nem prova recuperação do backup físico gerenciado. Neste GateB não se alteram Storage/Auth gerenciado;recuperação completa continua procedimento separado,não RTO prometido.

**Execução futura fora do notebook:** ferramentas/cofre/TLS serão preparados somente no host alternativo identificado e aprovado, seguindo o formulário B1-B prevalente. Os comandos Windows anteriormente listados aqui foram retirados do procedimento ativo; permanecem no histórico Git, não são instruções para este equipamento. Nenhum helper de Production foi executado nesta rodada.

Manifesto obrigatório: ID/UTC/tipo/escopo/origem conferida/versões/bytes/SHA256 cifrado/destino aprovado/chave recuperável/responsáveis/início e fim/saídas/inventário e integridade. Sem valores de segredos ou conteúdo clínico. Não existe autorização corrente para um destino real alternativo; a pasta histórica autorizada neste Windows não satisfaz a nova decisão. A cópia lógica não prova restauração física gerenciada ou serviço completo.

**Parada antes de DDL:** backup atual indisponível,senha/cofre inacessível,restore não concluído,versão incompatível,drift,transação longa/lock esperando ou falta de responsável. Informar o manifesto para avaliação; não converter o aceite anterior de RPO em dispensa desta prova. Caso a aprovação recebida não cubra a coleta/restore ou exija revisão do manifesto antes do SQL,solicitar apenas essa liberação específica e não ultrapassar a parada.

## Sequência proposta e pontos de parada

1. **Autorização e preparação no ambiente alternativo aprovado:** conferir SHA exato/CI/manifests, destino, responsáveis, segredos específicos e regras de aquisição/consumidores acima. Não promover pacote do outro agente ou substituir journal pelo HEAD TISS.
2. **Pré-voo read-only autorizado:** comparar projeto/history/schema, obrigações live,links externos pendentes e locks. Parar se a hipótese de runtime AbacatePay desarmado for incompatível com qualquer obrigação existente.
3. **Backup e restore isolado:** criar/verificar cópia cifrada e manifesto acima; comparar schema/contratos do mesmo snapshot. **Parada P0 antes de qualquer migration.** A existência do botão Restore não basta.
4. **Contenção da transição:** aprovar/conferir proteção efetiva durante a troca do deployment. A versão antiga não fecha a criação para sessões anteriores só com `SIGNUP_ENABLED=false`. Se não houver contenção aprovada suficiente,não iniciar DDL/deploy sob promessa de aquisição totalmente fechada. Não desligar Auth/cron/Asaas como atalho.
5. **SQL somente com GO de execução:** usar o novo scripts/abacatepay-release-apply.ts do OPS_ROOT validado, apontando para o RELEASE_ROOT congelado160/0136–0159, com revisão/restore/hash do backup recente, CA explícita e ID de aprovação. Não usar o migrator genérico do TAR nesta janela. O novo operador mantém lock/transação/limites na mesma conexão e confere fingerprints legados. Resultado parcial/timeout exige readback, sem retry cego, DOWN ou edição do histórico. Provas sintéticas e CI do operador não autorizam execução Production.
6. **Pós-voo antes de tráfego:** preflight `--phase after`,160 entradas exatas,22 relações críticas protegidas,funções/triggers/policies/grants/FKs/índices e fingerprints legados/catálogo conferidos. Se falhar,conter e investigar; não publicar consumidor sobre schema parcial.
7. **Deployment controlado:** promover exatamente o artefato aprovado sem merge automático; aplicar composição GateB por novo deployment; verificar domínio/SHA,cadastro/criação503,AbacatePay503,cron compartilhado saudável,login/MFA e leitura clínica/financeira. Testes sintéticos autorizados,sem enviar mensagens ou criar pagamentos reais.
8. **Encerrar:** registrar evidência UTC e resultados,retirar controles temporários somente se autorizado e compatível com aquisição ainda fechada,confirmar obrigações antigas preservadas. **Parar antes do Gate C**. Sem webhook live,consumidor novo,piloto,abertura de coorte ou cobrança.

Comandos futuros de deployment,**somente após GO e pós-voo de SQL**,na pasta exportada do SHA aprovado,sem misturar arquivo de outro worktree:

```powershell
vercel link --yes --project project-os --scope clinic-os-v2-s-projects
vercel deploy --prod --scope clinic-os-v2-s-projects
```

Usar CLI já autorizada/autenticada;conferir projeto antes de confirmar o comando. `--prod` publica em Production e **não está autorizado agora**;não usar `git merge` como substituto,nem promover build Preview feito com variáveis DEV. As flags GateB devem estar no ambiente Production antes do novo build. [CLI deploy](https://vercel.com/docs/cli/deploy),[CLI link](https://vercel.com/docs/cli/link). Falha de permissão/projeto ou divergência de origem exige parar,sem contratar plano ou substituir credencial.

## Rollback por camada

| Camada | Recuperação segura proposta |
|---|---|
| Código | Voltar apenas a artefato comprovadamente compatível com schema160 e obrigações. Se a versão anterior reabrir o checkout para sessão prévia,ela não é rollback fechado seguro sem contenção adicional |
| Configuração/flags | Guardar snapshot protegido antes da janela;aplicar restauração aprovada por novo deployment. Não imprimir segredos,não copiar DEV,não confiar em efeito retroativo |
| Webhook | GateB não cria nem ativa. Se surgir webhook/consumidor inesperado,interromper;desativação é mudança de escopo que exige avaliação das obrigações |
| Workers/cron | Preservar jobs compartilhados/Asaas;AbacatePay apenas no-op se não há obrigações dele. Nunca desligar tudo para conter novas vendas |
| Estado financeiro | Preservar IDs,inbox,ledger,invoices,receipts e fim pago. Código anterior não desfaz dinheiro;nenhum refund,cancelamento ou replay automático |
| Migrations | Falha antes do commit: respeitar transação/sentinel e verificar rollback real. Após commit: correção à frente aprovada ou recuperação protegida;sem DOWN automático ou restore sobre ativo |
| Recuperação do serviço | Comparar com snapshot preservado,reconciliar eventos externos posteriores,avaliar dados criados no intervalo e pedir GO específico antes de restaurar/trocar destino. RTO completo ainda não medido |

## Gate C, riscos e integração

O [checklist vigente do webhook](../../runbooks/abacatepay-operacao.md#checklist-futuro-do-webhook-live--não-executar-nesta-rodada) prepara POST HTTPS `app.qoro.dev/api/webhooks/abacatepay`,segredo exclusivo,HMAC de corpo bruto,inbox/dedup,retries/leases,recuperação,cron/scanner/watch/closure e alertas. Registro no provedor,entrega autenticada e processamento financeiro são três provas diferentes. Nada disso é ativado pelo GateB; não adicionar webhook agora nem chamar um503 de teste de autenticidade aprovado.

- **R1:** reserva/idempotência controladas;fechamento automático live não observado. No GateD,uma clínica consentida,uma obrigação;parar por múltiplas assinaturas/invoices/direitos,link ambíguo,estado desconhecido ou closure persistente. Sem POST/refund cego.
- **R2:** observação natural13/12/2026 preservada;ACTIVE não cria novo período. Só receipt/ciclo com prova válida;ambiguidade em revisão. Nenhuma cobrança antecipada para fabricar homologação.
- **R3:** manter N01–N17 do dossiê,com provas locais/externas distintas;políticas já aprovadas,cancelamento e fim pago preservados. Sem nova carência,reembolso ou reativação inventada.
- **R4:** piloto proposto1→3→10,sem SLA. Observar inbox/idade/leases,erros401/403/429/5xx,latência,pagamento não conciliado,duplicidade e alertas. Limiares propostos:qualquer divergência financeira/tenant,idade>2min,lease>60s sem resolução,401/403,coordenação indisponível ou429 persistente exigem contenção/revisão,não aceitação automática.

R1–R4 continuamPARTIAL e sem aceite. GateB fechado não executa suas provas financeiras nem exige aceitar venda;se não for possível permanecer desarmado,reavaliar o gate,sem aceite implícito. GateC exige segurança/entrega/monitoramento próprios;GateD exige decisão expressa sobreR1–R4;GateE reavalia o piloto e cada aumento.

[Handoff UI](HANDOFF-UI-BILLING-SaaS.md) publicado,leitura não confirmada;nenhum agente UI/TISS acessível nesta árvore. Incidente7590707702 não reaberto. Repaginação integral e TISS117/117 não são dependências;mudança crítica compartilhada exige regressão billing.

**Asaas live com DEV relatado pela UI:** o client do RC aceita a credencial/baseURL fornecidas e não deriva o ambiente do banco. Não usar flags AbacatePay para resolver isso,nem copiar/alterar credenciais. UI/Payments devem manter DEV/Preview em Sandbox e implementar/revisar a barreira central contra base/chave live fora de Production,antes de testes com egress habilitado. Usar mocks ou bloqueio de saída aprovado até esse guard ser comprovado. Não é autorização para alterar contratos de pacientes ou worktree alheio.

## Solicitação Gate B histórica — não executar; recompor após B1-B

- **Identificação:** `joaomarcos-techia/Project_OS`,PR53 draft,Production `app.qoro.dev`. SHA exato do novo candidato corrigido e CI final:checkpoint do PR53,obrigatórios no formulário antes da aprovação;10e5d43b é a baseline anterior preservada.
- **Janela histórica, sem validade operacional atual:**15/11/2026,10h–11h,America/Sao_Paulo. Uma nova janela só será proposta após as dependências do B1-B; nenhum horário está reservado. Orçamento operacional60min,estimativa de planejamento:15min pré-voo/backup/restore,10min SQL/pós-voo,20min deployment,15min smoke/encerramento. O build Preview histórico5min35s e os ensaios locais4,9s/26,5s não comprovam esses tempos em Production. Se prova/restore/locks consumirem o orçamento,parar antes do próximo estágio e reagendar;não prolongar sem responsável/GO.
- **Técnico,operacional,incidentes,rollback:** **A DEFINIR PELO TITULAR**. Pode haver acúmulo de funções se explicitamente aprovado;nenhuma pessoa foi presumida disponível.
- **Comprovado antes da solicitação:** causa/correção/testes locais do fechamento;baseline histórica;pacote/journal/hashes/ensaios preservados;procedimentos e matriz. Novo SHA/CI devem estar verdes no checkpoint final.
- **Na janela,antes de DDL:**projeto/history/schema atuais,ausência de obrigação AbacatePay que impeça desarme,links anteriores,contenção da transição,backup atual/restore/integridade,chave disponível,locks/timeouts,secrets/flags/cron/alertas e rollback compatível. Nenhum item pendente recebePASS por presunção.
- **Excluído:**sem cobrança de teste real,clínica piloto,nova contratação,abertura de allowlist,webhook/consumidores AbacatePay live,merge automático,alteração de preços/cotas/contratos,aceiteR1–R4 ou execução0160. Atividade legítima Asaas existente permanece;links hospedados anteriores são uma verificação explícita,não uma garantia de revogação local.
- **Pontos de não avanço:**qualquer pré-requisito não comprovado,drift,backup não restaurado,contenção insuficiente,contrato alterado,duplicidade,consumidor inesperado ou perda de saúde exige interromper antes da próxima mutação. Financeiro novo exigiria GateC/D separado.

**Recomendação prevalente:** **NÃO APTO PARA EXECUTAR OU SOLICITAR GO DE EXECUÇÃO DO GATE B** enquanto o B1-B/ambiente/backup e os demais pré-requisitos não forem comprovados. Esta solicitação é histórica e não oferece autorização condicionada automática. Solicitação inclui explicitamente a barreira WAF acima,sem contratação adicional,mas não sua execução automática. A autorização depende de preencher SHA/checks finais,janela/responsáveis e aprovar os pontos de parada. Se a exigência for evidência atual de backup/schema antes da própria autorização de SQL/deploy,liberar primeiro somente coleta/restore/preflight read-only e devolver seu manifesto para essa decisão. Não iniciar qualquer dessas operações de Production por este documento.

## Limpeza local opcional, sem relação com Production

O ensaio criou somente dados sintéticos em `C:\Users\joaom\AppData\Local\Temp\qoro-scratch-schema-hQHtf0`. `pg_ctl status` retornou3 e não há processo PostgreSQL associado. A revisão automática recusou sua exclusão recursiva com `blocked by policy`;não houve tentativa de contorno. A pasta pode ser removida pelo titular no Explorador quando conveniente,conferindo o nome exato. Não remover outros scratches. A primeira tentativa do harness também deixou um diretório sintético sem identificação suficiente no relatório;nenhum diretório foi escolhido por suposição para excluí-lo. Isso não bloqueia GateB nem altera as evidências históricas.
