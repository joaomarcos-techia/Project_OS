# ADR-050 — Identidade de pagamento do paciente (customer Asaas por clínica)

- **Status:** Aprovado (2026-08-24) — complementar ao [ADR-049](049-pagamentos-paciente-sinal.md)
- **Data:** 2026-08-24
- **Contexto do repo:** `feat/qorov2-pagamentos`, baseline verde (266 arquivos / 2362 testes ✅ · build ✅)
- **Motivo:** o ADR-049 descreve a cobrança do paciente como se ela pudesse ser criada só com valor +
  referência. Não pode: `POST /payments` do Asaas exige `customer`. Essa lacuna bloqueou a sub-fase 1.3
  (achado **D15** do [discovery log](../discovery-log.md)) e, pelo §0.9 do plano (ADR Freeze), voltar a
  escrever código exige **este** documento aprovado.
- **Relaciona:** ADR-049 (sinal) · ADR-023 (IA read-only em cobrança) · ADR-012 (cripto por tenant) ·
  ADR-011 (outbox/idempotência) · ADR-007 (RLS)

> ⚠️ Precedência: **Código > Banco > Testes > Documentação.** Este ADR foi escrito lendo o código; se
> algo divergir na implementação, atualizar aqui **antes** de prosseguir.

---

## 1. Problema

Para cobrar um paciente na conta Asaas da clínica é preciso que exista um **customer** naquela conta.
Isso levanta três perguntas que o ADR-049 não responde:

1. **Onde vive a associação** paciente ↔ `customerId` (que é por clínica, já que a conta é da clínica)?
2. **Qual PII do paciente sai do Qoro** para essa conta?
3. **Com que base** esse dado é tratado, e o que acontece num hard-delete de LGPD?

Restrições que já existem no código e que este ADR **não** revoga:

- `patientApiV1` **não expõe** CPF decifrado. O único método de CPF (`cpfMatchesPatient`) apenas
  **verifica** — por desenho.
- A IA é **read-only em cobrança** (ADR-023: *"a IA nunca cria/edita cobrança"*).
- Cartão nunca toca o Qoro: cobrança é **link hospedado** do Asaas (ADR-049).

## 2. O que o código já garante (e que encolhe esta decisão)

Levantado antes de decidir, não presumido:

| Fato | Onde |
| --- | --- |
| **CPF é obrigatório no cadastro** de paciente | `CreatePatientSchema.cpf` (sem `.optional()`) |
| O **próprio agente de IA já coleta CPF** ao cadastrar por WhatsApp | `tools/collect-patient-data.ts` (`REQUIRED_FIELDS`) |
| **Nome já é superfície pública** do Patient | `PatientSummary.nome` |
| Leitura decifrada de paciente já existe internamente | `DecryptedPatient extends PatientSummary { cpf }` |
| Existe validador de CPF | `validateCpf` (`lib/crypto/encryption.ts`) |

Ou seja: o dado necessário **já foi coletado, com a finalidade de identificar o paciente na clínica**.
Nada novo é pedido a ninguém.

## 3. Decisões

### D1 — Mapa `patient_payment_customers`, por clínica

Tabela nova no context `payments`:

```
patient_payment_customers(clinic_id, patient_id, provider, provider_customer_id, ...)
UNIQUE (clinic_id, patient_id, provider)
```

**Por que por clínica e não global:** o customer existe *dentro* da conta Asaas da clínica. O mesmo
paciente atendido por duas clínicas tem dois customers, em duas contas diferentes. Um mapa global
seria simplesmente errado.

**Idempotência:** o `UNIQUE` + `onConflictDoNothing` impede customer duplicado sob reentrega do worker.
Quando o POST der timeout, a recuperação é pelo mesmo caminho já usado para cobrança
(`findPaymentByExternalReference` tem irmão em customer: consulta por `cpfCnpj`/externalReference antes
de criar — detalhe de implementação, não de arquitetura).

### D2 — Mínimo de PII: **nome + CPF**. Nada além.

Sai do Qoro para a conta da clínica: **`name` e `cpfCnpj`**.

**NÃO sai:** e-mail, telefone, endereço, data de nascimento, sexo, motivo da consulta, procedimento,
diagnóstico ou qualquer dado clínico. O `description` da cobrança usa texto genérico ("Sinal do
agendamento") — **nunca** o nome do procedimento, que em saúde mental é dado sensível.

**Por que CPF e não só nome:** é o identificador que o Asaas usa para PIX e para o extrato da clínica.
Sem ele a clínica não consegue conciliar quem pagou — que é justamente o problema que o P0 resolve.

### D3 — Um seam estreito no `patientApiV1`

```ts
getPaymentIdentity(clinicId, patientId): Promise<{ nome: string; cpf: string } | null>
```

**Por que no Patient e não uma leitura direta:** a decifra de PII é responsabilidade de quem é dono do
dado. Payments pede o que precisa por um contrato nomeado; não abre o `cpf_encrypted` por conta própria.

**Devolve `null`** quando o paciente não existe, está deletado, ou o CPF armazenado não passa em
`validateCpf`. `null` significa **não cobrar** — nunca "cobrar sem identificar".

O método é `payment` no nome de propósito: é auditável quem chamou e para quê. Não é um
`getDecryptedPatient` genérico.

### D4 — Base legal e LGPD

- **Controladora é a clínica.** A conta Asaas é dela, o atendimento é dela, o paciente é dela. O Qoro é
  operador: transporta o dado que a clínica já detém para o gateway que a clínica escolheu.
- **Finalidade:** executar a cobrança que o paciente aceitou ao concordar com a política de
  cancelamento (consent `politica_cancelamento`, criado na sub-fase 1.2). É execução de contrato, não
  base nova.
- **Minimização:** D2 acima. O que não é necessário para identificar o pagador não viaja.
- **Hard-delete (ADR-017/021):** o hard-delete do paciente **apaga a linha do mapa** (`patient_id ON
  DELETE CASCADE`). O customer **dentro da conta Asaas da clínica NÃO é apagado pelo Qoro** — aquela
  base é da clínica, e apagar registro financeiro de terceiro por conta própria seria pior que não
  apagar. Isso precisa estar escrito no runbook de LGPD e no contrato com a clínica.

### D5 — Quem cria o customer, e quando

O **context `payments`**, de forma **preguiçosa**: no momento da primeira cobrança daquele paciente
naquela clínica. Não há job de sincronização, não há criação em massa no cadastro.

**Por quê:** paciente que nunca é cobrado nunca precisa existir no Asaas. Criar customer para toda a
base seria exportar PII de gente que talvez nunca pague nada.

O passo roda dentro do mesmo handler *detached* da cobrança (chamada externa fora de transação),
descrito no ADR-049 §1.3.

### D6 — Sem CPF válido, **não cobra**

Se `getPaymentIdentity` devolver `null`, o sinal simplesmente não é gerado: o agendamento segue o fluxo
de hoje, e uma métrica registra o caso para o operador enxergar.

**Não** se pede CPF ao paciente por WhatsApp nesta fase. O agente continua read-only em cobrança
(ADR-023); pedir dado para viabilizar cobrança é o começo de uma tool de escrita, e essa fronteira só
se cruza com ADR próprio.

### D7 — O que este ADR explicitamente **não** muda

- A IA **não** cria, edita ou dispara cobrança. Ela entrega o link que o sistema gerou (ADR-049 §1.6).
- Continua **link-only**: sem tokenização, sem cartão no Qoro.
- Payments continua **sem escrever `appointments`** — o Scheduling reage a evento (regra R3).

## 4. Alternativas rejeitadas

| Alternativa | Por que não |
| --- | --- |
| **Customer genérico por clínica** ("Paciente"), identificando pelo `externalReference` | O extrato da clínica fica sem pagador — mata a conciliação, que é o problema que o P0 existe para resolver. E o Asaas exige `cpfCnpj` válido para PIX/boleto |
| **Coletar CPF no checkout do Asaas** | `POST /payments` exige customer *antes* do checkout. Não é ordem que a API permita inverter |
| **Agente de IA cria o link quando o paciente pede** | (a) Não cobre o caso principal: o **sinal nasce no agendamento**, não numa conversa — a secretária agenda por telefone e o paciente pode nem estar no WhatsApp. (b) Não economiza código: customer, cobrança, idempotência e webhook são os mesmos. (c) Coloca criação de cobrança atrás de um LLM, cruzando o ADR-023 e abrindo prompt injection num caminho financeiro. (d) Pediria por WhatsApp um CPF que **já está no cadastro** |

> A ideia do agente permanece válida como **fluxo reativo** — restante após comparecer (1.5) e dunning,
> onde a conversa já existe e o paciente pediu. Mesmo lá: o sistema gera, a IA entrega.

## 4.1 Regras do Asaas verificadas ao vivo (2026-08-24)

Escritas aqui porque nenhuma estava óbvia na documentação, e todas foram descobertas por
`pnpm payments:live-check` contra o sandbox — depois de o código já existir:

| Regra | Onde bate |
| --- | --- |
| `POST /payments` tem **valor mínimo de R$ 5,00** (`UNDEFINED`) | `deposit-charge.ts` não cobra abaixo disso: 50% de um procedimento de R$ 8 daria R$ 4 e o gateway recusaria, virando poison pill a cada agendamento |
| `POST /webhooks` exige **`email`** | usamos o e-mail da própria conta da clínica (`getMyAccount`) — forjar um endereço nosso na conta de um cliente seria pior |
| `POST /webhooks` exige **`sendType`** | fixo em `SEQUENTIALLY` |
| `authToken` precisa de **≥32 caracteres** | `randomBytes(32).toString('base64url')` = 43 |
| `authToken` **não pode ter mais de 4 caracteres iguais consecutivos** | o gerador re-sorteia. Sem isso a conexão de uma clínica falharia **de vez em quando**, sem padrão — o pior tipo de bug |
| `createCustomer` **aceita sem e-mail** | confirma o D2: nome + CPF bastam |

A verificação também pegou um defeito nosso que teste com mock nunca pegaria: o adapter não
estava enviando o `email` no corpo do webhook.

## 5. Consequências

**Positivas:** destrava a 1.3 sem inventar mecanismo novo; a PII que viaja é a mínima e já coletada; o
mapa por clínica reflete a realidade da conta; paciente sem CPF válido degrada para "não cobra" em vez
de falhar no gateway.

**Custo aceito:** o context `payments` passa a depender de um seam do `patient` (mais uma exceção
`boundaries` justificada, como as 53 existentes); e existe uma cópia da identidade do paciente na base
de um terceiro que o Qoro não pode apagar.

**Risco residual:** se o Asaas mudar a exigência de `cpfCnpj`, o D2 revisita-se sozinho — o campo é
enviado, não inferido.

## 6. O que isto destrava

Sub-fase **1.3** volta a andar com escopo: mapa (D1) → seam (D3) → criação preguiçosa do customer (D5)
→ cobrança + `patient_charges` (já entregue) → evento `payments.patient_charge.created`.

Migrations já na branch: `0081` (credencial), `0082` (política), `0083` (cobranças). O mapa entra na
próxima.
