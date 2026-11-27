# Inventário e configuração

Consulte a [fotografia e fontes E01–E25](01-contexto-atual.md). O [JSON](../decoupling/inventario-codigo.json) lista todas as referências detectadas, migrations, imports estáticos, nomes de process.env e schedules; não contém valores de credenciais. É inventário estático, não tracing distribuído.

## Fronteiras reais

| Contexto                  | Responsabilidade                                       | Dependência de infraestrutura relevante                          |
| ------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| identity / tenancy        | Usuários, papéis, clínica, acesso                      | Auth Supabase, profiles, hook JWT, RLS e crypto                  |
| onboarding                | Sessão anônima, respostas, código, plano, provisioning | Auth, Resend, Turnstile, Redis, billing e Postgres               |
| billing                   | Contrato da clínica, cotas e recorrência               | Asaas SaaS, invoices, mudanças e crons                           |
| payments                  | Conta recebedora da clínica e pagamentos de pacientes  | Asaas por tenant, webhook ref, intents e reconciliação           |
| financial                 | Recebíveis, crédito antecipado, caixa e repasses       | Postgres, eventos de agenda/pagamento e Storage de comprovantes  |
| scheduling                | Disponibilidade, reserva e consulta                    | Postgres, eventos, política de sinal e consentimentos            |
| patient / clinical        | Identificação, consentimento, prontuário e PDFs        | Crypto, RLS, perfis e Storage privado                            |
| messaging / ai-agent      | Meta, atendimento, ferramentas e uso de IA             | Tokens cifrados por clínica, Gemini, outbox, agenda e permissões |
| platform-admin / feedback | Operação transversal e suporte                         | Admin DB, impersonação, audit e exports                          |

**Imports de fornecedor:** 10 arquivos de produção referenciam SDK Supabase, 36 têm referências detectadas de consumidores Auth, 31 Asaas e 12 Vercel. Há sobreposição e comentários nos critérios; números não são contagem de operações nem prova de acoplamento em todos os casos. O grafo completo de imports resolve aliases e o [context-map](context-map.mmd) mostra eventos e imports entre contexts.

## Variáveis: o que já escala e o que falta

| Grupo atual                                                          | Fonte    | Ponto positivo                                                                   | Limite / alteração proposta                                                                                                                                                          |
| -------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DATABASE_URL / DATABASE_URL_RUNTIME                                  | E02–E03  | Conexão central; separa runtime sem BYPASSRLS de admin/worker quando configurado | Runtime sem BYPASSRLS é opcional; pools 6/8/2 por processo exigem orçamento global em múltiplas réplicas                                                                             |
| NEXT_PUBLIC_SUPABASE_URL / PUBLISHABLE_KEY ou ANON_KEY, service role | E02, E06 | Validação tipada; admin somente servidor                                         | Nomes e clientes identificam Supabase; separar endpoint de identidade do endpoint de objetos quando houver adapters                                                                  |
| APP_BASE_URL                                                         | E19      | Origem confiável de e-mail/callback; recusa origem arbitrária                    | Preservar validação HTTPS/CSRF; adicionar configuração explícita de aliases aprovados, sem confiar em Host                                                                           |
| NODE_ENV / VERCEL_ENV / SUPABASE_PROJECT_ENV                         | E02      | Guardas contra ambientes incompatíveis                                           | NODE_ENV=production também em Preview; sem VERCEL_ENV a regra Preview não se aplica. Propor APP_ENV obrigatório e manifesto de identidade do backend                                 |
| VERCEL_URL / VERCEL_BRANCH_URL / AUTOMATION_BYPASS_SECRET            | E19      | Preview limitado aos aliases injetados                                           | Implementar adapter de deployment; nunca substituir por wildcard de hosts ou remover validação de origem                                                                             |
| ASAAS_API_KEY / BASE_URL / WEBHOOK_TOKEN / HTTP_TIMEOUT_MS           | E10      | Credencial global fora do domínio; sandbox como default                          | Novos provedores precisam credenciais e roteamento explícitos por contrato/conta, sem fallback financeiro silencioso                                                                 |
| CRON*SECRET / CRON_SECRET_DESTRUCTIVE / OUTBOX*\*                    | E17–E18  | Bearer e tuning de worker centralizados                                          | Scheduler alternativo deve selecionar segredo apropriado por rota; OUTBOX_CRON_ALLOW_NON_VERCEL só reduz log de anomalia, não autentica                                              |
| CRYPTO*SECRET_BACKEND / MASTER_KEY_VERSION / GCP*\*                  | E20      | Porta existente; versão preserva leitura de ciphertext antigo                    | Não mover/rotacionar chaves junto de banco. Backend GCP faz import lazy de pacote que não consta nas deps do app; imagem alvo precisa comprovar suporte caso esse backend seja usado |
| META*\* / GEMINI*\_ / RESEND\_\_ / UPSTASH\_\*                       | E21      | Capacidades independentes da hospedagem                                          | Habilitações e quotas não são comprovadas por variável presente; recriar callbacks e permitir somente destinos de teste                                                              |
| NEXT_PUBLIC_TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY                | E02, E07 | Chave pública e segredo separados                                                | Widget precisa aceitar novo domínio; validação backend e replay devem passar no host alvo                                                                                            |
| NEXT*PUBLIC_SENTRY_DSN / SENTRY*\*                                   | E18, E22 | Sentry não depende de Vercel para runtime                                        | Config Next contém org/projeto fixos; alinhar efetivamente com configuração e validar sourcemaps sem credencial em imagem                                                            |
| SIGNUP_ENABLED / OFFER_2026_ANNUAL_NEW_SALES_ENABLED                 | E02, E16 | Flags existentes para cadastro e novas vendas anuais                             | Não são flags de migração; reload/redeploy depende de como config foi carregada; preservar contratos existentes                                                                      |

Há **8 arquivos de produção em src** com acesso direto process.env pelo recorte AST. Não significa oito violações: build/public keys, middleware e runtime têm requisitos próprios. `next.config.ts`, Sentry configs e scripts estão fora desse número. Não mover NEXT*PUBLIC*\* cegamente para um objeto dinâmico: o Next precisa de referências estáticas para incorporar valores públicos no build.

**DECISÃO proposta:** continuar com env.ts e helpers atuais; adicionar um pequeno modelo de ambiente/deployment. Não criar um framework universal de configuração, nem renomear todas as variáveis simultaneamente. Variáveis públicas são fixadas no build; uma imagem única promovida entre ambientes exige mecanismo de config pública em runtime ou rebuild por ambiente, escolhido explicitamente. Segredos ficam fora de layers, imagem, logs, JSON de inventário e Git.

## Dependências ocultas

- E04: 24 migrations citam auth.users/uid/jwt. `authenticated`, `anon`, `service_role` e hooks fazem parte do contrato de segurança, além das consultas SQL.
- E08–E09: paths de PDFs já ajudam a migração; `clinics.logo_url` guarda URL e precisa de compatibilidade. Cinco templates de e-mail ainda referenciam logo público de um projeto Supabase específico, inclusive fallback do template novo.
- E11: nomes asaas_customer_id, asaas_subscription_id, asaas_payment_id e asaas_event_id; unicidades devem ganhar namespace provedor + conta, sem reidentificar registros antigos.
- E17: leases e transações não equivalem a exactly-once de efeitos externos; retries devem continuar usando identidade da operação.
- E18: 21 crons, limite de request e timeout, PDF/WASM, headers e redirects precisam existir fora da Vercel.
- E25: landing tem host allowlist, Preview do app fixo em `.vercel.app`, analytics Vercel e regras HTTP no vercel.json. A landing main atual já seleciona destino conforme host; a análise anterior do destino único era incompleta para esse SHA.
- E23: DPAPI depende do perfil Windows; recuperar tabelas/arquivos não garante recuperar serviço, chaves ou sessões. Self-hosting Supabase reduz dependência do operador, mantém dependência da tecnologia.
