# ADR-055 — Documentos clínicos centrados no paciente, com consulta opcional

- **Status:** Accepted — decisão de produto em 2026-09-07; suporte de domínio parcial já existente;
  entrada unificada de criação ainda não implementada
- **Data:** 2026-09-07
- **Contextos:** clinical e patient; navegação composta somente na aplicação
- **Relaciona:** [ADR-007](007-rls-implementation-patterns.md),
  [ADR-011](011-outbox-audit-idempotency-patterns.md),
  [ADR-048](048-ai-agent-conversational-safety.md) e
  [Qoro v2 §23](../qorov2.md#23-central-de-documentacao-e-documentos-clinicos-longitudinais)

## Contexto

O fluxo atual favorece a emissão dentro de `/consultorio`, dando a impressão de que prontuário,
prescrição e documento médico só podem nascer de um agendamento. Essa limitação é de descoberta e
navegação, não do modelo:

- `prontuarios.appointment_id` já é anulável e a ficha do paciente possui “Novo prontuário” manual;
- `prescriptions.prontuario_id` já é anulável;
- `medical_documents` já é ligado diretamente a paciente, clínica e profissional, sem depender de
  consulta ou prontuário;
- `/documentos` já lista prescrições, atestados, declarações, pedidos de exame e encaminhamentos, mas é
  somente leitura; a criação está exposta no Consultório ou dentro de um prontuário.

O produto também terá `/documentacao`, uma central de ajuda sobre o funcionamento do Qoro. Os nomes
precisam permanecer distintos: `/documentos` contém artefatos clínicos reais; `/documentacao` contém
orientação operacional e não armazena dados de pacientes.

## Decisão

1. O **paciente**, a **clínica** e o **profissional autor** são obrigatórios para qualquer documento
   clínico. Não existirão prescrições, prontuários ou documentos órfãos.
2. O vínculo com `appointment_id` é opcional. Um documento pode ser produzido durante uma consulta,
   em acompanhamento longitudinal ou como emissão avulsa autorizada pelo profissional.
3. “Sem consulta agendada” não significa “sem responsabilidade clínica”. A autoria, data/hora,
   credenciais profissionais, conteúdo, assinatura aplicável, auditoria e motivo clínico continuam
   sujeitos às regras do tipo documental.
4. `/documentos` evoluirá de feed somente leitura para workspace clínico com ação **Novo documento**.
   O fluxo seleciona primeiro o paciente e depois o tipo: entrada de prontuário, prescrição, atestado,
   declaração, pedido de exame ou encaminhamento.
5. A ficha do paciente terá os mesmos atalhos. Abrir pelo Consultório preenche paciente, prontuário e
   consulta; abrir por Pacientes/Documentos mantém a consulta ausente e nunca cria agendamento falso.
6. Builders continuam tipados por documento. Não haverá editor genérico capaz de se declarar receita,
   atestado ou documento regulado apenas por texto livre.
7. A prescrição digital reutilizará o caminho regulatório da 2.2/Memed quando aprovado. Emissão avulsa
   não contorna CRM, assinatura eletrônica, regras da Anvisa nem requisitos do SNCR.
8. Prontuário assinado continua imutável; correção ocorre por versão/adendo. RLS forçada, RBAC,
   idempotência, criptografia por tenant e trilha de auditoria continuam obrigatórios nos dois caminhos.

## Experiência esperada

```text
/documentos ou ficha do paciente
        ↓
Novo documento
        ↓
selecionar paciente, quando necessário
        ↓
selecionar tipo documental
        ↓
builder específico + validação de credenciais
        ↓
rascunho/assinatura/emissão conforme o tipo
        ↓
feed clínico do paciente e da clínica
```

Quando originado no Consultório, o mesmo fluxo recebe `appointment_id` e `prontuario_id` válidos. A
identidade do tenant e do autor sempre vem da sessão; o browser nunca escolhe `clinic_id` nem assina em
nome de outro profissional.

## Entrega incremental

1. **C2.0 — discovery/UI contract:** auditar permissões, drawers e builders existentes; definir quais
   tipos podem ser rascunho e quais exigem assinatura imediata.
2. **C2.1 — criação avulsa sem migration:** adicionar CTAs em `/documentos` e na ficha do paciente,
   reutilizando actions e schemas existentes. Uma migration só será proposta se o código provar uma
   lacuna real de origem/status — `appointment_id = null` já suporta o vínculo opcional.
3. **C2.2 — prescrição regulada:** integrar Memed/SNCR somente depois do spike 2.2.0 e de contrato,
   assinatura e estados autoritativos confirmados.
4. **C2.H/C2.S:** segurança e estabilização próprias, sem misturar com o comprovante financeiro 2.1A.

## Testes mínimos

- criação com e sem consulta, sempre ligada ao paciente e autor autenticado;
- mesma action/idempotency key não duplica documento;
- perfil sem permissão não cria, assina nem lê;
- tenant A não seleciona paciente, prontuário, consulta ou documento do tenant B;
- `appointment_id` inválido ou cross-tenant falha fechado;
- assinatura, imutabilidade, revisão e PDF permanecem iguais nos dois caminhos;
- E2E por `/documentos`, ficha do paciente e Consultório prova que os três acessos convergem para o
  mesmo contrato, sem criar consulta fictícia.

## Referências regulatórias

- [CFM — Resolução 2.314/2022](https://www.sistemas.cfm.org.br/normas/visualizar/resolucoes/BR/2022/2314):
  registros e documentos emitidos a distância preservam identificação, data/hora, prontuário,
  integridade, confidencialidade e assinatura aplicável;
- [Anvisa — receituários eletrônicos e assinaturas](https://www.gov.br/anvisa/pt-br/assuntos/medicamentos/controlados/sncr/perguntas-e-respostas/perguntas-e-respostas-rdc-1000-2025-1-ed):
  o nível de assinatura depende do tipo de prescrição e medicamentos sujeitos a controle especial
  exigem assinatura qualificada.

## Fora de escopo desta decisão

- criar prontuário ou prescrição sem paciente;
- transformar emissão avulsa em consulta retroativa;
- alterar cálculo financeiro, agenda ou prontuário já assinado;
- afirmar que o PDF atual é prescrição digital válida para todos os medicamentos;
- implementar Memed, SNCR, migration ou nova assinatura neste lote documental.
