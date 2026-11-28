# Continuação da migração financeira — Sandbox e persistência candidata

Branch local: `feat/billing-abacatepay-20261107`, base `534995b0`. Sem push, Preview, deploy, alteração de cliente real ou migration remota. A autorização de continuidade mantém os limites do [plano mestre](PLANO-MESTRE-MIGRACAO-ASAAS-ABACATEPAY.md). Este registro complementa a entrega anterior; não substitui seus resultados históricos.

## Decisão aprovada sobre trial

O titular respondeu **“Trial no Qoro; checkout ao final”**. A política candidata está em `src/contexts/onboarding/internal/signup-deferred-trial.ts` e reutiliza o cálculo atual de `signup-trial.ts`:

- 14 dias exatos desde a criação no Auth, sem reinício por atualização da tela ou checkout tardio;
- checkout recorrente indisponível antes do prazo e permitido a partir do instante exato de expiração;
- produto recorrente sem `trialDays` nativo, evitando um segundo trial;
- pagamento confirmado necessário para acesso pós-trial; a política isolada não autentica, provisiona nem concede acesso;
- planos legados excluídos; fluxo Asaas atual intacto.

**A jornada inteira ainda não foi conectada ao cadastro.** Faltam provisionamento do trial sem recorrência, binding persistido, checkout pós-trial, tratamento do pagamento e apresentação na UI. Os 15 testes da política provam a decisão temporal local; não são um E2E desse cadastro.

## Código implementado nesta continuação

| Arquivo | Responsabilidade e limite |
| --- | --- |
| `src/lib/payments/saas/command-operation.ts` | Reserva antes de executar; cache de resultado confirmado; conflito de parâmetros; resultado desconhecido e processo interrompido não disparam retry/failover. Exige journal durável e ID persistido pelo chamador. |
| `src/lib/payments/abacatepay/transport.ts` | Transporte compartilhado, origem V2 fixa, endpoints permitidos, GET/POST sem redirect, cap real de bytes, timeout e erros sanitizados. POST indeterminado não é repetido. |
| `src/lib/payments/abacatepay/sandbox-commands.ts` | Factory exclusivamente Sandbox, comprovação fresca da loja/ambiente antes do comando, criação/releitura de produto/checkout, cancelamento e alteração de plano pendente. Sem modo de produção ou composição ativa. |
| `src/lib/payments/abacatepay/initial-payment.ts` | Readback da primeira cobrança sem trial nativo. Confere conta, cliente, assinatura, checkout, item/quantidade, preço e valor pago. Recusa duas assinaturas do mesmo checkout/cliente. Não concede acesso nem inventa período/liquidação. |
| `src/lib/payments/saas/postgres-store.ts` | Repositórios candidatos de reserva de operações e inbox, com pool central injetado. Chave de negócio impede segunda reserva mesmo com outro UUID. Nenhum pool novo e nenhum consumidor ativo. |
| `src/lib/payments/abacatepay/webhook-handler.ts` | Receptor componível, sem rota pública registrada. Secret + HMAC, bytes originais, cap 256 KiB, minimização, hash e persistência antes de 202. Duplicata durável 200; falha de banco 503; conteúdo conflitante 409. Não aplica regra financeira. |
| `src/lib/http/webhook-body.ts` | Nova leitura de bytes para HMAC. API anterior de texto preservada; 33 testes do webhook Asaas passaram na regressão afetada. |
| `scripts/abacatepay-sandbox-journal.ts` | Journal de operador local, arquivo exclusivo e fsync antes do POST; retomada conserva running/unknown. Não é backend para Vercel ou múltiplas instâncias. |
| `scripts/abacatepay-sandbox-draft.ts` | Fixture fixa e rastreável; registra manifesto/journal; cria produto/checkout de teste sem cliente/pagamento e repete comandos sem novo POST. Resultados de criação em cache não substituem releitura financeira atual. |
| `scripts/security/billing-gateway-schema.ts` | PostgreSQL descartável com todas as migrations existentes; valida DDL, repositórios e receptor Request/Response usando dados sintéticos. Não acessa bancos remotos. |

O código novo não altera o gateway de uma obrigação existente. A presença de `ABACATEPAY_API_KEY` não ativa a integração. O adaptador Asaas e os pagamentos de pacientes continuam preservados.

## API real de Sandbox — observado

Run ID: `qoro-v2-capability-20261107`. Fixture preparada no plano antes do primeiro POST.

| Recurso/ação | Resultado observado |
| --- | --- |
| Produto avulso de testemunho criado pelo titular | `prod_yFBfdSA5twXU3hLREy1YkJtW`, `devMode=true`, BRL/100 centavos, sem ciclo/trial |
| Novo produto mensal sintético | `prod_SsuxBjRrxEMb4J4kaq14yabx`, BRL/100 centavos/MONTHLY, `trialDays=null`; POST e GET 200 |
| Novo checkout de assinatura | `bill_TcYC3cG1aUfnzbYZzB0DaQAR`, CARD, quantidade 1, referência do runID; POST e GET 200 |
| Estado financeiro relido | `PENDING`, valor 100 centavos, `paidAmount=null`, cliente ausente; nenhuma assinatura encontrada |
| Repetição no mesmo processo | Mesmos IDs; nenhum POST adicional |
| Repetição em novo processo | Mesmo produto/checkout, journal reaberto; 3 GETs e zero POSTs |
| Releitura pelo novo leitor financeiro | Mesmo checkout, valor e item, `PENDING` e sem pagamento; 4 GETs e zero POSTs |

Nesta continuação: **17 GETs e 2 POSTs**. Acumulado com a entrega anterior: **31 GETs e 2 POSTs**. Os comandos só ocorreram depois da prova de Sandbox; as primeiras leituras de autenticação precederam essa atestação e não são retroativamente uma prova de ambiente. Os dois POSTs criaram somente catálogo/checkout. Não houve pagamento, customer criado pela engenharia, assinatura ativa, captura de cartão, webhook externo ou concessão de benefício.

O journal está em `%LOCALAPPDATA%\Qoro\SandboxBilling\qoro-v2-capability-20261107`, com ACL restrita ao usuário e SYSTEM. Contém somente a fixture, referências e resultado; nenhuma API key é copiada. O URL do checkout não é publicado no relatório. A fixture fica retida; não apagar recursos enquanto sua possível conclusão/reconciliação estiver em aberto.

Reexecução segura do ensaio, usando as mesmas operações:

```powershell
Set-Location 'C:\dev\Qoro_billing_abacatepay_20261107'
.\node_modules\.bin\tsx.cmd --conditions=react-server scripts/abacatepay-sandbox-draft.ts --apply-draft
```

Não troque o runID/UUID para contornar `unknown` ou `running`. Inspecione o journal e consulte a origem. O comando é de operador, sem endpoint público. A remoção das fixtures exige conferência de dependências e autorização destrutiva aplicável; apagar um checkout não cancela suas assinaturas.

## Banco candidato — escopo comprovado

[SCHEMA-CANDIDATO.sql](SCHEMA-CANDIDATO.sql) fica fora de `drizzle/migrations`; nenhuma migration foi registrada ou aplicada em DEV/Preview/produção. A proposta cria o schema privado `billing_gateway` com contas, vínculos, operações e inbox. Não armazena credenciais e não faz backfill, repricing ou troca de origem.

Foi aplicado inicialmente sobre 136 migrations reais em PostgreSQL 17 local descartável, com identidades e contratos sintéticos. O reteste de `2026-11-08T19:30:09.305Z` passou **38 verificações com as 137 migrations atuais**, incluindo a 0136 de cotas, sem registrar o DDL multigateway no journal:

- FKs de clínica/assinatura/conta e origem imutável;
- unicidade de referência externa por conta e isolamento de namespaces;
- corrida de 12 reservas da mesma obrigação, inclusive com UUIDs novos: um único comando sintético;
- confirmação persistida e reutilizada por uma nova instância do repositório;
- timeout sintético/unknown seguido de nova tentativa: nenhum reenvio;
- evento duplicado em corrida: uma aceitação, onze duplicatas;
- mesmo evento com hash divergente: conflito explícito e conteúdo anterior preservado;
- receptor assinado sintético → inbox PostgreSQL → 202; replay → 200; secret errado → 401;
- ausência de e-mail, secret e corpo bruto na linha persistida;
- acesso negado para anon/authenticated, acesso operacional para service_role;
- snapshot dos contratos preservado e nenhum binding legado criado automaticamente.

O cluster foi parado. A limpeza do helper existente deixou pastas sintéticas em TEMP; isso não contém dados reais e não é tratado como validação de cleanup completo. O harness registra `PRESERVED_SYNTHETIC_DIRECTORY`; não foi tentada remoção por outro caminho para contornar a falha.

Essa prova **não** equivale a migration autorizada, teste de carga de produção ou worker financeiro concluído. A proposta adiciona um índice único `(id,clinic_id)` em `public.subscriptions`; a migration futura exige revisão do lock de DDL, grants/policies, integração no schema Drizzle e procedimento de rollback sem apagar histórico. Nenhum desses cuidados é dispensado pelo PASS local.

## Validações e limites

- **273/273 testes em 13 arquivos:** PASS; zero skips. Inclui os 100 testes da entrega anterior, comandos, journal, leitura financeira, trial, receptor e regressão afetada do Asaas.
- A primeira execução dessa bateria teve um teste com comparação de classe `Buffer`/`Uint8Array`, embora os quatro bytes fossem idênticos. Corrigida a asserção para exigir tipo Uint8Array, comprimento e bytes exatos; nenhuma validação desativada; reexecução integral dessa bateria PASS.
- **38 verificações PostgreSQL:** PASS; zero chamadas a provider e zero escrita remota. Não representam entrega real da AbacatePay.
- TypeScript completo, ESLint completo e build isolado: PASS no fechamento após as cotas de 08/11. Ver resultados, horários e limites no [relatório incremental](../../quality/trial-resource-limits-2026-11-08.md).
- Pagamento Sandbox, webhook externo, worker aplicando domínio, renovação, alteração/cancelamento reais da fixture e E2E UI→banco→provedor: **NOT RUN**. Cancelamento e troca pendente têm prova unitária, não homologação real.

## CLI oficial preparada

A [CLI oficial v0.2.1](https://github.com/AbacatePay/abacatepay-cli/releases/tag/v0.2.1) foi extraída em `%LOCALAPPDATA%\Qoro\Tools\abacatepay-cli\v0.2.1`, sem alterar PATH ou instalar dependência de produção. SHA-256 do ZIP Windows amd64 conferido com o digest do release: `4fcab7d2fb31c44ecc8469ce305792e298d53cbdd3f818a5cd8a6c65574ec644`. `--version`, `login --help` e `listen --help` terminaram 0.

Não foi feito login nem copiada a chave para perfil/argumentos. A versão consultada oferece login pelo navegador ou `--key`; não foi encontrado modo documentado de ler a chave de stdin/env sem passá-la no argumento. A [documentação de credenciais](https://docs.abacatepay.com/pages/cli/flags) descreve o keyring do sistema. O perfil deve ser da mesma loja de teste antes do ensaio; não usar um perfil de produção por suposição.

Quando o ensaio de entrega estiver preparado e houver uma pessoa disponível, a intervenção prevista é somente o login legítimo:

```powershell
& "$env:LOCALAPPDATA\Qoro\Tools\abacatepay-cli\v0.2.1\abacatepay.exe" login --name qoro-sandbox-20261107
```

Isso não é pedido para repetir a API key no chat. A CLI encaminha eventos Dev mode, e seu histórico local pode conter payload bruto; usar somente a fixture sintética, sem `--verbose`, com logs protegidos. O secret de autenticação do receptor é independente da API key. A URL de forwarding não será publicada com secret em logs/documentos. O listener ainda não está executando e nenhum perfil anterior foi alterado.

## Gate atual e sequência

O desenho de trial foi decidido; sua política está testada, mas a jornada ainda precisa ser integrada. A mudança de critério para upgrade imediato foi perguntada ao titular: proporcional pago + alteração recorrente aceita para o próximo ciclo, com reconciliação. **Resposta ainda pendente nesta versão; não presumir aprovação.** O comando implementado retorna somente `pending/next_cycle`, sem dizer que o preço ou a cota já mudaram.

Depois das decisões/validações necessárias: concluir binding/provisionamento do trial, implementar worker transacional e direitos sem inferir períodos ausentes, preparar entrega externa, concluir o pagamento da fixture, homologar ciclo/alteração/cancelamento e executar E2E. Somente depois discutir autorização para schema/Preview e ativação futura. A ausência de `nextDueDate`/período e de lookup documentado da alteração pendente continua sendo lacuna explícita; não inventar campos ou equivalência.

**Decisão desta subentrega:** avanço comprovado em adapter Sandbox, reserva e aceitação durável candidata. **NO-GO para cutover ou contratação real pela AbacatePay.** Asaas, pacientes, Supabase remoto, Vercel e contratos ativos permanecem inalterados.

## Direcionamento do founder em 08/11 — avaliação limitada

O founder definiu 10 pacientes, 15 agendamentos, 15 documentos/receitas somados e 15 por categoria financeira/operacional aprovada; bloqueio de conexão WhatsApp/Asaas e de convite/reenvio de equipe até pagamento. O novo onboarding será tratado depois. [Spec e alcance](../../specs/trial-interface-e-cotas-2026-11.md), [ADR-067](../../adr/067-cotas-temporarias-de-avaliacao.md) e [evidência incremental](../../quality/trial-resource-limits-2026-11-08.md).

A 0136 é uma migration de cotas reais do produto, diferente do `SCHEMA-CANDIDATO.sql` multigateway que continua fora do journal. Inicialmente foi proposta local; após autorização específica, foi aplicada exclusivamente no DEV em 08/11 (136→137), sem contratos existentes inscritos e com dados anteriores preservados. O DDL multigateway não foi aplicado remotamente. O ensaio histórico de 38 verificações multigateway usou 136 migrations; um novo ensaio com as 137 passou em 08/11. As cotas têm ensaio próprio de 43 verificações no schema real e 1 E2E completo de Preview, seis estágios, cleanup PASS. O estágio de pagamento usa invoice sintética, não provider. [Evidência DEV/Preview](../../quality/trial-resource-limits-preview-2026-11-08.json). O hook de pagamento Asaas existente e os gates de integração foram modificados na candidata para essa regra; portanto a declaração de consumidores ativos intocados descreve o snapshot anterior, não o diff atual. O [PR #53](https://github.com/joaomarcos-techia/Project_OS/pull/53) permanece draft, sem produção.

O build adicional iniciado antes desse direcionamento foi interrompido e não recebeu PASS. O build final das cotas terminou com exit 0 às `19:17:38.002Z` de 08/11; todo o `src` final corresponde à cópia compilada. As demais provas e as falhas anteriores ficam no relatório incremental. Não ativar a candidata nem enviar outro checkout por causa dessa mudança de escopo.

Após autorização específica adicional, a 0137 restringiu os grants administrativos das duas tabelas de avaliação no DEV. Readback em `2026-11-08T20:17:09.194Z`: 138 migrations, sem pendências, dados existentes preservados, FORCE RLS e funções protegidas; `service_role` sem os privilégios excedentes herdados do default Supabase. [Evidência sanitizada](../../quality/trial-service-role-dev-2026-11-08.json). A correção não ativa o gateway novo nem altera produção ou contratos. O E2E de cotas e a liberação sintética não substituem a homologação externa AbacatePay ainda pendente.
