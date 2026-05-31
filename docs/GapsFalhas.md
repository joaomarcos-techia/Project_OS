# GAPS E FALHAS IDENTIFICADOS — C0 → C5

Versão: Revisão Arquitetural
Escopo: C0, C1, C2, C3, C4 e C5
Objetivo: Encontrar riscos, inconsistências, pontos frágeis e overengineering antes da implementação.

---

# RESUMO EXECUTIVO

Nota geral da arquitetura: 8.8/10

Pontos fortes:

- Ordem das camadas está correta.
- Multi-tenant via RLS desde o início.
- Outbox antes dos contextos de negócio.
- Idempotência antes das mutações críticas.
- Patient com LGPD antes de Clinical.
- Pouca dependência de serviços externos.

Principais riscos:

1. Complexidade excessiva em C3.
2. Auto-heal de JWT é perigoso.
3. RLS + super_admin possui brechas conceituais.
4. Audit particionado é prematuro.
5. Encryption per-tenant precisa de revisão.
6. Outbox possui risco de poison messages.
7. Dependência excessiva do Auth Hook.

---

# C0 — FUNDAÇÃO

## GAP 0.1

Falta enforcement arquitetural.

Hoje existe apenas regra documental:

"não importar contexto A dentro de contexto B"

Mas nada impede isso tecnicamente.

Sugestão:

Adicionar dependency-cruiser ou eslint-plugin-boundaries.

Caso contrário:

Patient poderá importar Scheduling daqui a 6 meses.

A documentação não impedirá.

---

## GAP 0.2

Não existe ADR obrigatório para mudanças arquiteturais.

Há ADRs mencionados.

Mas não existe processo.

Sugestão:

Qualquer alteração em:

- schema
- eventos
- permissions
- contracts

deve exigir ADR.

---

## GAP 0.3

Não existe política de versionamento.

Não há definição de:

- release tags
- changelog
- rollback version

Isso aparece cedo em SaaS.

---

# C1 — DATABASE FOUNDATION

## GAP 1.1

withTenant aparece em C1.

Mas tenant ainda não existe.

Há mistura conceitual entre C1 e C2.

Ideal:

C1 apenas banco.

C2 tenant.

---

## GAP 1.2

Backup apenas via pg_dump.

Problema:

pg_dump não cobre cenários de PITR.

Supabase Pro oferece PITR.

Plano deveria exigir:

- PITR habilitado
- teste de restore

não apenas dump.

---

## GAP 1.3

Não existe validação de migrations destrutivas.

Falta:

- detector de DROP COLUMN
- detector de DROP TABLE

Um erro humano pode apagar produção.

---

# C2 — MULTI TENANT

## GAP 2.1

Uso simultâneo de:

- JWT claims
- app.current_clinic

Cria dois mecanismos de tenant.

Isso é perigoso.

No futuro alguém usará um.
Outro usará outro.

Sugestão:

Escolher um.

Ideal:

JWT → set_config → RLS.

Fonte única.

---

## GAP 2.2

clinic_domains não possui definição de ownership verification.

Qualquer pessoa poderia apontar DNS.

Não há:

- TXT challenge
- verification token

---

## GAP 2.3

Slug reservado não escala.

Lista manual.

Problema:

novos endpoints futuros.

Exemplo:

billing
dashboard
settings

podem colidir.

Ideal:

reservar automaticamente rotas do Next.

---

## GAP 2.4

Não existe estratégia para mudança de slug.

Hoje slug parece imutável.

Isso gera problema comercial.

---

## GAP 2.5

Falta política de soft delete para clinics.

Existe deleted_at.

Mas não existe definição:

- o que acontece com usuários
- pacientes
- eventos

---

# C3 — AUTH

## GAP 3.1 (GRAVE)

Auto-heal é complexo demais.

Problema:

cada request pode virar consulta ao banco.

Resultado:

JWT deixa de cumprir sua função.

Você troca:

JWT stateless

por

JWT + lookup constante.

Na prática:

vira sessão tradicional.

Sugestão:

Remover auto-heal.

Forçar refresh em:

- login
- alteração de role
- alteração de permissões

---

## GAP 3.2 (GRAVE)

Permissions dentro do JWT.

Hoje:

permissions[] é emitido no token.

Problema:

JWT cresce continuamente.

Hoje:

20 permissões.

Amanhã:

80 permissões.

Sugestão:

JWT conter apenas:

- role
- clinic_id

Permissões calculadas no backend.

---

## GAP 3.3

super_admin sem clinic_id.

Perigo:

Toda policy precisará lembrar:

OR role = super_admin

É uma fonte eterna de bugs.

Ideal:

helper SQL central:

is_super_admin()

---

## GAP 3.4

Role + overrides gera dupla fonte de verdade.

Hoje:

role_permissions
+
user_permission_overrides

Isso funciona.

Mas auditoria de permissões ficará difícil.

---

## GAP 3.5

Tabela sessions não conversa com Supabase Sessions.

Você cria:

sessions

mas Supabase já possui sessões.

Risco:

dados divergentes.

---

## GAP 3.6

Rate limit depende de Upstash.

Se Upstash cair:

o que acontece?

Plano não define fail-open ou fail-closed.

Precisa definir.

---

## GAP 3.7

Auth Hook é SPOF.

Single Point of Failure.

Se quebrar:

ninguém loga.

O próprio documento reconhece isso.

Mas não há plano de observabilidade.

---

# C4 — OUTBOX / AUDIT / IDEMPOTENCY

## GAP 4.1 (GRAVE)

Audit particionado é prematuro.

No MVP:

100 clínicas.

Volume estimado:

10k eventos/dia.

Postgres comum aguenta anos.

Particionamento:

- aumenta complexidade
- aumenta migrations
- aumenta restore complexity

Recomendação:

remover partições até > 5 milhões rows.

---

## GAP 4.2

Poison Messages.

Evento falha 6 vezes.

Depois vira failed.

E então?

Não existe DLQ.

Evento fica morto.

Precisa existir:

dead_letter_events

ou política clara.

---

## GAP 4.3

Outbox sem versionamento de eventos.

Hoje:

event_type

Mas não existe:

event_version

No futuro:

payload muda.

Handlers antigos quebram.

---

## GAP 4.4

Idempotency response cache em JSONB.

Problema:

respostas grandes.

PDFs.

Exports.

Arquivos.

Não cabe.

---

## GAP 4.5

Client gera idempotency key.

Correto.

Mas não existe enforcement.

Cliente mal implementado:

sem key.

Servidor precisa gerar fallback.

---

## GAP 4.6

Audit before/after completo.

Risco:

explosão de storage.

Especialmente em Clinical.

---

## GAP 4.7

Worker único.

Hoje:

Vercel Cron.

Amanhã:

2 execuções simultâneas.

Precisa existir lock global.

Não apenas SKIP LOCKED.

---

# C5 — PATIENT

## GAP 5.1 (GRAVE)

Encryption per-tenant está parcialmente equivocada.

Hoje:

HKDF(master, clinic_id)

Problema:

paciente transferido de clínica.

Dados precisam ser recriptografados.

Sugestão:

Data Encryption Key por tenant armazenada criptografada.

Modelo envelope encryption.

---

## GAP 5.2

Hash de CPF global.

Hoje:

hashForLookup usa salt global.

Problema:

mesmo CPF gera mesmo hash em todas clínicas.

Permite correlação indireta.

Melhor:

HMAC(master + clinic_id).

---

## GAP 5.3

Telefone hash também sofre mesmo problema.

Mesma falha.

---

## GAP 5.4

LGPD delete conflita com audit.

Plano menciona:

"anonimiza audit"

Mas audit deve ser imutável.

Existe conflito conceitual.

Precisa ADR específico.

---

## GAP 5.5

Suppression list ligada ao patient_id.

Problema:

hard delete remove patient.

Mas suppression deve sobreviver.

Melhor:

armazenar hash do telefone.

Não patient_id.

---

## GAP 5.6

Export LGPD depende do outbox.

Se worker estiver parado:

export nunca sai.

Usuário fica sem resposta.

Pra LGPD isso é sensível.

---

## GAP 5.7

patient_clinical_data como jsonb.

Pode virar mini-prontuário escondido.

Há risco de duplicação futura com C7.

Definir claramente:

o que pertence ao Patient
e o que pertence ao Clinical.

---

# MAIORES RISCOS DE TODO O PLANO

## Top 1

Auto-heal JWT.

Provável fonte de bugs.

Remover.

---

## Top 2

Dependência excessiva do Auth Hook.

Adicionar monitoramento.

---

## Top 3

Permissions completas dentro do JWT.

Escala mal.

---

## Top 4

Audit particionado cedo demais.

Complexidade sem benefício.

---

## Top 5

Hash global de CPF.

Permite correlação cross-tenant.

---

## Top 6

Conflito LGPD x Audit Imutável.

Precisa ADR próprio.

---

# RECOMENDAÇÕES PRIORITÁRIAS

Antes de iniciar C3:

- Revisar Auto-Heal.
- Revisar modelo de permissions no JWT.
- Criar enforcement arquitetural (boundaries).

Antes de iniciar C4:

- Adicionar event_version.
- Definir DLQ.

Antes de iniciar C5:

- Revisar estratégia de hash.
- Revisar suppression list.
- Escrever ADR LGPD x Audit.
