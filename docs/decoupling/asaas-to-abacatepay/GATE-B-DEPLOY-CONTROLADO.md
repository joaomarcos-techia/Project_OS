# Gate B — proposta de deploy técnico com aquisição fechada

## Ensaio sintético e segurança — 15/11/2026, após B1-A

**Checkpoint prevalente.** O titular reconheceu o B1-A administrativo e confirmou no painel os mesmos oito backups físicos abaixo, com a opção Restore. Nenhuma nova listagem ou leitura de dados era necessária para repetir essa evidência. Este ciclo autoriza correções das ferramentas, testes exclusivamente sintéticos, documentação e push no PR53. **B1-B real, B2-A/B, B3 e C/D/E continuam não autorizados; Production NO-GO.** R1–R4 permanecem PARTIAL, sem aceite.

### GPG real — PASS no Windows

Histórico da validação deste ciclo: CI43741996377 do6838435f interrompeu no TypeScript (`exactOptionalPropertyTypes`, campo gpgHome explicitamente undefined); corrigido para omitir a propriedade ausente, sem cast ou relaxamento do tipo. Os47 testes dirigidos passaram novamente. O SHA posterior exige sua própria CI completa; não reutilizar a execução interrompida como aprovação.

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

### Pedido 1 — B1: inventário, cópia atual e recuperação isolada

**Alvo:** projeto Supabase de nome `qoro-prod`; REF exata deve ser confirmada pelo titular/painel antes de conectar. Nunca usar DEV `pqhkirrszzpwezdaqrai`. Não é necessário criar um novo token pessoal se o painel ou a sessão administrativa legítima já permitir a leitura.

**B1-A, apenas metadados:** conferir no [Dashboard](https://supabase.com/dashboard/projects) → qoro-prod → Database → Backups o plano, tipo, UTC, status, retenção e janela disponível. Guardar só metadados, sem clicar Restore. API alternativa já documentada pelo Supabase: `GET /v1/projects/<REF_APROVADA>/database/backups` usando autenticação existente, sem token no comando/chat. Esta consulta Production não foi executada neste ciclo.

**B1-B, autorização separada para dados reais:** se não houver cópia atual adequada já autorizada, criar dump lógico cifrado pelo helper existente e restaurar somente em contêiner local descartável. Não criar snapshot físico pago, novo projeto, PITR ou plano. Não afirmar custo de uso zero: conferir franquia/egress disponível antes da cópia e parar se exigir gasto não aprovado.

O pedido B1 pode aprovar expressamente A+B em uma única resposta, sem uma segunda rodada só para confirmar as mesmas operações. Se a autorização abranger apenas metadados, não executar cópia ou restauração. Nenhuma das opções autoriza B2/B3.

1. **Pré-condições:** B1-B explicitamente aprovado; REF/host/usuário/TLS/porta da conexão conferidos em memória contra o projeto correto; `NODE_ENV=production` e `SUPABASE_PROJECT_ENV=prod` somente no processo de backup; `DATABASE_URL_PROD`/`BACKUP_PASSPHRASE` carregados pelo mecanismo protegido existente. Verificar compatibilidade pg_dump/psql, destino com ACL restrita, criptografia do host e recursos Docker. Não imprimir URLs ou segredos.
2. **Cópia cifrada fora do release:** criar diretório privado aprovado sob `%LOCALAPPDATA%\Qoro\Recovery\gate-b1-<ID_APROVADO>`. Executar o script por caminho absoluto, com cwd nesse diretório, para que `backups/` não entre no pacote de deployment. O loader absoluto é necessário porque o cofre não contém `node_modules`:

```powershell
# SOMENTE depois de B1-B e preflight local de destino/segredos aprovados.
Push-Location $QoroRecoveryRoot
try {
  node --import file:///C:/dev/Qoro_billing_abacatepay_20261107/node_modules/tsx/dist/loader.mjs C:/dev/Qoro_billing_abacatepay_20261107/scripts/db-backup-prod.ts
  if ($LASTEXITCODE -ne 0) { throw 'Backup falhou; parar B1' }
} finally { Pop-Location }
```

3. **Sucesso da cópia:** exit codes, bytes, SHA256 do `.sql.gpg`, UTC e disponibilidade da chave. O helper usa pg_dump somente leitura e GPG em stream, sem SQL aberto em disco. Marcador final de dump não substitui restore. Não carregar variáveis/credenciais live no contêiner.
4. **Destino isolado:** depois de validar Docker/imagem oficial, gerar nome `qoro-gate-b1-` + 12 caracteres hexadecimais e senha aleatória apenas de processo. Comando futuro, com `POSTGRES_PASSWORD` no ambiente do processo (não em argv):

```powershell
docker run -d --name $QoroB1Container --label qoro.recovery.scope=gate-b1 --network none --log-driver none --memory 2g --memory-swap 2g --tmpfs /var/lib/postgresql/data:rw,nosuid,size=1g --tmpfs /tmp:rw,nosuid,size=128m -e POSTGRES_PASSWORD public.ecr.aws/supabase/postgres:17.11.0.006 postgres -c cron.launch_active_jobs=off
docker exec $QoroB1Container pg_isready -h 127.0.0.1 -U supabase_admin -d postgres
```

Conferir initdb finalizado, Vault 0.3.1, PostgreSQL 17.11, `SHOW cron.launch_active_jobs=off`, nenhum host port, mount persistente, app, worker ou saída de rede. O contêiner não é Supabase DEV compartilhado. Tmpfs e limite de swap do contêiner não provam proteção do pagefile/hibernação do host; verificar criptografia/política local antes de tratar dados reais. Se 1GiB de dados/2GiB de RAM não forem suficientes, parar e revisar capacidade antes de restaurar, sem aumentar silenciosamente limites.

5. **Restauração estrita:** executar na raiz deste worktree, com senha do backup no processo e paths reais substituindo todos os placeholders. A ferramenta fica fora do candidato financeiro e não chama migrator:

```powershell
node --conditions=react-server --import tsx scripts/gate-b-isolated-restore.ts --authorize-local-real-data --backup '<COPIA_CIFRADA_APROVADA.sql.gpg>' --sha256 '<SHA256_APROVADO>' --container '<CONTAINER_APROVADO>' --release 'dist/abacatepay-saas-94f6da4a-b0-utf8' --ref '94f6da4aeb32b1ae7da856dc9afa105120ce6dd9' --evidence '<DESTINO_PRIVADO_NOVO.json>'
```

6. **Resultado esperado:** gpg=0, psql=0 com `ON_ERROR_STOP`, histórico/hash/ordem exatos do prefixo136, índices/constraints íntegros e inventário técnico. A ferramenta grava `LOCAL_RESTORE_COMPLETE_REQUIRES_MANIFEST_REVIEW`, nunca aprova B1 sozinha. Comparar inventário/schema com o manifesto da cópia e revisar diferenças de roles/grants (`--no-acl` não restaura todas as permissões), Storage e Auth gerenciado. O script histórico `offer-restored-backup-db.ts` exige outro snapshot e aplica migrations antigas; **não usar diretamente para este B1**. `restore:test` espera `.sql` aberto; não usá-lo como substituto protegido.
7. **Falha/parada:** erro de origem, hash, versão, confinamento, privilégio, espaço, GPG/SQL ou paridade deixa B1 pendente; não eliminar partes do dump, não rodar migrations e não restaurar no projeto ativo. Guardar só estágio/códigos, sem linhas clínicas ou stderr bruto.
8. **Retenção/recuperação:** original cifrado preservado, chave separada; proposta de reter a cópia até sete dias após B3, sem exclusão automática. Descarte do contêiner contém somente a cópia local e deve integrar a autorização B1-B: conferir nome/label antes de `docker rm -f <CONTAINER_APROVADO>`. Sem autorização de descarte, não escolher outro recurso para remover. Não excluir pastas já bloqueadas por política. RTO completo não medido; duração do drill será registrada, sem extrapolar SLA.

**B1 não autoriza B2/B3.** Não houve consulta de backups gerenciados, dump atual, restauração real ou descarte neste ciclo.

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
| Backup físico gerenciado atual | ID,data,escopo e restauração atual NÃO VERIFICADOS; não clicar Restore no projeto ativo |
| Backup pré-Gate B | AINDA NÃO CRIADO. Necessário dump lógico cifrado public+auth/journal, hash, tamanho, versões e restauração estrita isolada antes de qualquer DDL |
| Arquivo histórico28/10 | Não encontrado no caminho documentado nesta máquina. Isso não invalida o restore histórico,mas esse caminho não pode ser usado como prova de cópia disponível agora |
| Ferramentas locais | Node22.23.4,pg_dump/psql17.5;GPG2.4.9 existente em `C:\Program Files\Git\usr\bin\gpg.exe`, fora do PATH observado. Não precisa comprar/instalar GPG. Preparar PATH só na sessão e validar versões contra o servidor; restore que use `\restrict` requer cliente compatível,como a imagem oficial17.11 já usada |

O script `db-backup-prod.ts` transmite SQL ao GPG sem gravar plaintext; `prod-encrypted-backup.ts` confere saída e marcador final por stream. **Marcador final não substitui restore estrito.** O dump não inclui bytes Storage,segredos/configurações externas Auth nem prova recuperação do backup físico gerenciado. Neste GateB não se alteram Storage/Auth gerenciado;recuperação completa continua procedimento separado,não RTO prometido.

Preparação local reversível do operador,sem instalação e sem editar `.env`:

```powershell
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
gpg --version
pg_dump --version
psql --version
```

Na janela autorizada,na pasta exportada aprovada,com `SUPABASE_PROJECT_ENV=prod`,`DATABASE_URL_PROD` e `BACKUP_PASSPHRASE` já carregados de forma protegida: `node --import tsx scripts/db-backup-prod.ts`. A conexão é somente de leitura e a cópia é cifrada;este comando ainda **não foi executado** nesta preparação. Registrar SHA256 do arquivo cifrado,exit code e restore isolado,sem imprimir o conteúdo. Não converter presença de senha em prova de que há uma cópia/chave independente.

Manifesto obrigatório da janela: `ID do backup / UTC / tipo lógico ou físico / origem conferida / public+auth+journal / versão pg_dump e destino / bytes / SHA256 cifrado / local protegido / chave recuperável / responsável / início+fim do restore / exit codes / inventário e integridade / resultado`. Não registrar senha,URL assinada,payload ou dados clínicos. Destino local cifrado com ACL restrita já autorizado; nenhuma cópia para serviço externo sem autorização específica. Restaurar só em destino isolado,sem saída para provedores,preferencialmente tmpfs/logs desativados. Original preservado.

**Parada antes de DDL:** backup atual indisponível,senha/cofre inacessível,restore não concluído,versão incompatível,drift,transação longa/lock esperando ou falta de responsável. Informar o manifesto para avaliação; não converter o aceite anterior de RPO em dispensa desta prova. Caso a aprovação recebida não cubra a coleta/restore ou exija revisão do manifesto antes do SQL,solicitar apenas essa liberação específica e não ultrapassar a parada.

## Sequência proposta e pontos de parada

1. **Autorização e preparação local:** conferir SHA exato/CI/manifests, destino, responsáveis, segredos específicos e regras de aquisição/consumidores acima. Não promover pacote do outro agente ou substituir journal pelo HEAD TISS.
2. **Pré-voo read-only autorizado:** comparar projeto/history/schema, obrigações live,links externos pendentes e locks. Parar se a hipótese de runtime AbacatePay desarmado for incompatível com qualquer obrigação existente.
3. **Backup e restore isolado:** criar/verificar cópia cifrada e manifesto acima; comparar schema/contratos do mesmo snapshot. **Parada P0 antes de qualquer migration.** A existência do botão Restore não basta.
4. **Contenção da transição:** aprovar/conferir proteção efetiva durante a troca do deployment. A versão antiga não fecha a criação para sessões anteriores só com `SIGNUP_ENABLED=false`. Se não houver contenção aprovada suficiente,não iniciar DDL/deploy sob promessa de aquisição totalmente fechada. Não desligar Auth/cron/Asaas como atalho.
5. **SQL somente com GO de execução:** pacote aprovado, backup recuperável,preflight imediatamente antes,sem drift/lock. Usar `scripts/db-migrate-prod.ts` na exportação,journal160,0136–0159. O script cria seu backup e usa sentinel/advisory no session pooler; não é exclusão contra todo DDL nem garante timeout da sessão do migrator. Confirmar limites efetivos do próprio migrator antes de executar; não presumir que o lock da conexão auxiliar limita a outra sessão. Sem limite/observação de espera aprovado,parar. Nada de SQL avulso,DOWN ou edição de histórico.
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

## Solicitação preenchida para avaliação

- **Identificação:** `joaomarcos-techia/Project_OS`,PR53 draft,Production `app.qoro.dev`. SHA exato do novo candidato corrigido e CI final:checkpoint do PR53,obrigatórios no formulário antes da aprovação;10e5d43b é a baseline anterior preservada.
- **Janela proposta:**15/11/2026,10h–11h,America/Sao_Paulo,**a confirmar pelo titular**,sem agendamento automático. Orçamento operacional60min,estimativa de planejamento:15min pré-voo/backup/restore,10min SQL/pós-voo,20min deployment,15min smoke/encerramento. O build Preview histórico5min35s e os ensaios locais4,9s/26,5s não comprovam esses tempos em Production. Se prova/restore/locks consumirem o orçamento,parar antes do próximo estágio e reagendar;não prolongar sem responsável/GO.
- **Técnico,operacional,incidentes,rollback:** **A DEFINIR PELO TITULAR**. Pode haver acúmulo de funções se explicitamente aprovado;nenhuma pessoa foi presumida disponível.
- **Comprovado antes da solicitação:** causa/correção/testes locais do fechamento;baseline histórica;pacote/journal/hashes/ensaios preservados;procedimentos e matriz. Novo SHA/CI devem estar verdes no checkpoint final.
- **Na janela,antes de DDL:**projeto/history/schema atuais,ausência de obrigação AbacatePay que impeça desarme,links anteriores,contenção da transição,backup atual/restore/integridade,chave disponível,locks/timeouts,secrets/flags/cron/alertas e rollback compatível. Nenhum item pendente recebePASS por presunção.
- **Excluído:**sem cobrança de teste real,clínica piloto,nova contratação,abertura de allowlist,webhook/consumidores AbacatePay live,merge automático,alteração de preços/cotas/contratos,aceiteR1–R4 ou execução0160. Atividade legítima Asaas existente permanece;links hospedados anteriores são uma verificação explícita,não uma garantia de revogação local.
- **Pontos de não avanço:**qualquer pré-requisito não comprovado,drift,backup não restaurado,contenção insuficiente,contrato alterado,duplicidade,consumidor inesperado ou perda de saúde exige interromper antes da próxima mutação. Financeiro novo exigiria GateC/D separado.

**Recomendação:** **APTO PARA SOLICITAR AUTORIZAÇÃO CONDICIONADA DO GATE B**, somente depois de CI verde do novo SHA; **NÃO APTO PARA EXECUTAR agora**. Solicitação inclui explicitamente a barreira WAF acima,sem contratação adicional,mas não sua execução automática. A autorização depende de preencher SHA/checks finais,janela/responsáveis e aprovar os pontos de parada. Se a exigência for evidência atual de backup/schema antes da própria autorização de SQL/deploy,liberar primeiro somente coleta/restore/preflight read-only e devolver seu manifesto para essa decisão. Não iniciar qualquer dessas operações de Production por este documento.

## Limpeza local opcional, sem relação com Production

O ensaio criou somente dados sintéticos em `C:\Users\joaom\AppData\Local\Temp\qoro-scratch-schema-hQHtf0`. `pg_ctl status` retornou3 e não há processo PostgreSQL associado. A revisão automática recusou sua exclusão recursiva com `blocked by policy`;não houve tentativa de contorno. A pasta pode ser removida pelo titular no Explorador quando conveniente,conferindo o nome exato. Não remover outros scratches. A primeira tentativa do harness também deixou um diretório sintético sem identificação suficiente no relatório;nenhum diretório foi escolhido por suposição para excluí-lo. Isso não bloqueia GateB nem altera as evidências históricas.
