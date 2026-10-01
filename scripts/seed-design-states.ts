/**
 * `pnpm seed:design-states`
 *
 * O `--conditions=react-server` do script npm NÃO é cosmético: `@/lib/crypto`
 * importa `server-only`, que lança fora dessa condição. Rodar com `tsx` puro
 * morre antes da primeira query.
 *
 * Popula a clínica de DEV com os ESTADOS que as referências de design mostram,
 * para conferir a UI contra elas: agenda com todos os desfechos, caixa com
 * pendente/parcial/pago/vencido, financeiro com entrada e saída, documentos com
 * receita/atestado/exame/declaração/encaminhamento (com e sem PDF) e conversas
 * com a máquina de estados do agente (handoff, SLA vencido, urgente, encerrada,
 * abandonada, entrega falha).
 *
 * ADITIVO e idempotente: não apaga clínica, usuário nem nada preexistente, e a
 * primeira coisa que faz é remover o que ele mesmo criou antes — rodar duas
 * vezes não duplica. Como nem toda tabela tem coluna livre para um marcador de
 * texto, cada família tem o seu escopo de limpeza:
 *
 *   - lançamentos  → `descricao LIKE '%[demo]%'`
 *   - atendimentos → `snapshot_procedure_codigo = 'DEMO'`
 *   - documentos   → `patient_id` dos pacientes deste script (conteúdo é
 *                    cifrado: não há LIKE possível)
 *   - conversas    → `patient_phone_hash` dos telefones deste script
 *
 * SÓ DEV (assertDevContext). Não existe caminho daqui para produção.
 */
// MUST be first: _env carrega .env.local antes de qualquer @/lib/* que valide env.
import { assertDevContext } from './_env';

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { computeCostUsd } from '@/lib/ai/cost';
import { encryptForTenant, hashForLookup, normalizeCpf } from '@/lib/crypto';
import { dbAdmin } from '@/lib/db';

assertDevContext();

const MARCA = '[demo]';
const BUCKET_PDF = 'clinical-pdfs';
/** O agente roda em Gemini (src/lib/ai/gemini.ts) — não em Claude. */
const MODELO_IA = 'gemini-3.8-flash';

/** Pacientes da referência, com os vínculos que a tela de Pacientes mostra. */
// Tabela de fixture: uma LINHA por estado. Explodida em um campo por linha, a
// comparação entre os estados — que é o ponto — deixa de caber na tela.
// prettier-ignore
const PACIENTES = [
  { nome: 'Marina Bastos Rezende', cpf: '41290800004', nasc: '1979-03-12', sexo: 'F', tel: '11988421190', email: 'marina.rezende@email.com' },
  { nome: 'Eduardo Prado Lima', cpf: '20877400051', nasc: '1966-07-28', sexo: 'M', tel: '11991208834', email: 'eduardo.lima@email.com' },
  { nome: 'Sérgio Antunes Melo', cpf: '33961500022', nasc: '1954-11-19', sexo: 'M', tel: '11996712088', email: 'sergio.melo@email.com' },
  { nome: 'Lívia Camargo Nunes', cpf: '44790200061', nasc: '1995-06-23', sexo: 'F', tel: '11993341207', email: 'livia.nunes@email.com' },
  { nome: 'Rita Camargo Bueno', cpf: '50827100070', nasc: '1988-05-30', sexo: 'F', tel: '11980043392', email: 'rita.bueno@email.com' },
  { nome: 'Heitor Fontes Barreto', cpf: '81255600005', nasc: '1982-12-01', sexo: 'M', tel: '11981107724', email: 'heitor.barreto@email.com' },
  { nome: 'Célia Duarte Fontes', cpf: '27463900048', nasc: '1952-08-17', sexo: 'F', tel: '11998805512', email: 'celia.fontes@email.com' },
  { nome: 'Bruna Ribeiro Aguiar', cpf: '62011800033', nasc: '1991-02-15', sexo: 'F', tel: '11982774409', email: 'bruna.aguiar@email.com' },
] as const;

/**
 * O menor entra à parte porque `trg_patients_require_minor_guardian` é uma
 * constraint DEFERIDA: sem responsável no MESMO commit, o INSERT devolve o id e
 * a linha some no fim da transação. Ele também é o estado "Responsável: X" que
 * a referência da tela de Pacientes mostra, então vale ter.
 */
const MENOR = {
  nome: 'Tomás Ribeiro Aguiar',
  cpf: '77132000088',
  nasc: '2019-01-04',
  sexo: 'M',
  tel: '11982774410',
  email: null,
  /** índice do responsável em PACIENTES (Bruna). */
  responsavel: 7,
} as const;

/**
 * A agenda do dia da referência: um horário para cada desfecho possível, porque
 * o que se quer conferir é justamente como cada estado desenha.
 */
// Tabela de fixture: uma LINHA por estado. Explodida em um campo por linha, a
// comparação entre os estados — que é o ponto — deixa de caber na tela.
// prettier-ignore
const AGENDA = [
  // Horários sem sobreposição: `appointments_no_overlap` é uma exclusion
  // constraint por médico, e o mesmo profissional atende todos aqui.
  { paciente: 6, hora: '08:40', dur: 30, status: 'atendido', proc: 'Retorno clínico', valor: '220.00' },
  { paciente: 4, hora: '10:00', dur: 30, status: 'faltou', proc: 'Consulta cardiologia', valor: '420.00' },
  { paciente: 3, hora: '10:40', dur: 30, status: 'cancelado', proc: 'Retorno clínico', valor: '180.00' },
  // `esperaMin`/`atendendoMin` viram entrada em `waiting_queue_entries`: é de lá
  // que a Agenda tira "aguardando há 24 min". Gravar só o status do atendimento
  // deixa a linha sem o dado que faz a recepção agir.
  { paciente: 0, hora: '13:00', dur: 30, status: 'chegou', proc: 'Consulta cardiologia', valor: '380.00', urgente: true, esperaMin: 24 },
  { paciente: 1, hora: '13:40', dur: 40, status: 'em_atendimento', proc: 'Retorno clínico', valor: '240.00', esperaMin: 21, atendendoMin: 12 },
  { paciente: 8, hora: '14:30', dur: 20, status: 'agendado', proc: 'Consulta pediatria', valor: '320.00', encaixe: true },
  { paciente: 2, hora: '15:00', dur: 30, status: 'confirmado', proc: 'Eletrocardiograma', valor: '420.00', serie: 3 },
] as const;

/**
 * Caixa e Financeiro: cada linha existe para desenhar um estado diferente.
 * `diasDue` é relativo a hoje — negativo vence no passado (linha vermelha).
 */
// Tabela de fixture: uma LINHA por estado. Explodida em um campo por linha, a
// comparação entre os estados — que é o ponto — deixa de caber na tela.
// prettier-ignore
const LANCAMENTOS = [
  { paciente: 2, tipo: 'receber', desc: 'Consulta cardiologia', valor: '420.00', pago: '0', status: 'pendente', diasDue: -10, proc: 'Consulta cardiologia' },
  { paciente: 0, tipo: 'receber', desc: 'Consulta cardiologia', valor: '380.00', pago: '0', status: 'pendente', diasDue: 0, proc: 'Consulta cardiologia' },
  { paciente: 1, tipo: 'receber', desc: 'Retorno clínico', valor: '240.00', pago: '120.00', status: 'parcial', diasDue: 1, proc: 'Retorno clínico', metodo: 'pix' },
  { paciente: 8, tipo: 'receber', desc: 'Consulta pediatria', valor: '320.00', pago: '320.00', status: 'pago', diasDue: 0, proc: 'Consulta pediatria', metodo: 'cartao_credito', pagoHoje: true },
  { paciente: 6, tipo: 'receber', desc: 'Retorno clínico', valor: '220.00', pago: '220.00', status: 'pago', diasDue: 0, proc: 'Retorno clínico', metodo: 'dinheiro', pagoHoje: true },
  { paciente: 4, tipo: 'receber', desc: 'Consulta cardiologia', valor: '420.00', pago: '0', status: 'cancelado', diasDue: -8, proc: 'Consulta cardiologia' },
  { paciente: 3, tipo: 'receber', desc: 'Consulta cardiologia', valor: '180.00', pago: '180.00', status: 'estornado', diasDue: -9, proc: 'Consulta cardiologia', metodo: 'pix' },
  { paciente: 5, tipo: 'receber', desc: 'Solicitação de exame', valor: '180.00', pago: '0', status: 'pendente', diasDue: 5, proc: 'Solicitação de exame' },
  { paciente: null, tipo: 'pagar', desc: 'Materiais de consumo', valor: '330.00', pago: '0', status: 'pendente', diasDue: 0 },
  { paciente: null, tipo: 'pagar', desc: 'Serviço de limpeza', valor: '100.00', pago: '0', status: 'pendente', diasDue: 0 },
] as const;

/**
 * Receitas. `pdf: false` é um ESTADO da tela, não descuido: sem
 * `pdf_storage_path` a linha desenha "PDF pendente" + botão "Gerar PDF"; com
 * path, desenha "Abrir PDF". A referência mostra os dois na mesma lista.
 */
// Tabela de fixture: uma LINHA por estado. Explodida em um campo por linha, a
// comparação entre os estados — que é o ponto — deixa de caber na tela.
// prettier-ignore
const RECEITAS = [
  {
    paciente: 1, kind: 'simples', hAtras: 3, pdf: true,
    medicamentos: [
      { nome: 'Losartana potássica 50 mg', posologia: '1 comprimido pela manhã', quantidade: '30 comprimidos', via: 'Oral' },
      { nome: 'Ácido acetilsalicílico 100 mg', posologia: '1 comprimido após o almoço', quantidade: '30 comprimidos', via: 'Oral' },
    ],
    observacoes: 'Retorno em 30 dias com as aferições de pressão feitas em casa.',
  },
  {
    paciente: 0, kind: 'simples', hAtras: 26, pdf: true,
    medicamentos: [
      { nome: 'Rosuvastatina 10 mg', posologia: '1 comprimido à noite', quantidade: '30 comprimidos', via: 'Oral' },
    ],
    observacoes: null,
  },
  {
    // Rótulo longo ("Receituário de controle especial") — é o que estica a
    // coluna Tipo na referência.
    paciente: 2, kind: 'controle_especial', hAtras: 50, pdf: true,
    medicamentos: [
      { nome: 'Clonazepam 2 mg', dosagem: '2 mg', posologia: '1 comprimido ao deitar', quantidade: '30 comprimidos', via: 'Oral' },
    ],
    observacoes: 'Receituário em duas vias. Não fracionar a dispensação.',
  },
  {
    paciente: 6, kind: 'simples', hAtras: 74, pdf: true,
    medicamentos: [
      { nome: 'Metformina 850 mg', posologia: '1 comprimido após o almoço e o jantar', quantidade: '60 comprimidos', via: 'Oral' },
      { nome: 'Vitamina D 7.000 UI', posologia: '1 cápsula por semana', quantidade: '4 cápsulas', via: 'Oral' },
    ],
    observacoes: null,
  },
  {
    paciente: 4, kind: 'simples', hAtras: 5, pdf: false,
    medicamentos: [
      { nome: 'Dipirona 500 mg', posologia: '1 comprimido a cada 6 horas se dor', quantidade: '20 comprimidos', via: 'Oral' },
    ],
    observacoes: null,
  },
] as const;

/** Documentos médicos — um de cada tipo que o feed sabe rotular. */
// Tabela de fixture: uma LINHA por estado. Explodida em um campo por linha, a
// comparação entre os estados — que é o ponto — deixa de caber na tela.
// prettier-ignore
const DOCUMENTOS_MEDICOS = [
  {
    paciente: 3, tipo: 'atestado', hAtras: 1, pdf: true,
    conteudo: { descricao: 'Afastamento das atividades laborais por quadro gripal.', cid: 'J06.9', dias: 2 },
  },
  {
    paciente: 5, tipo: 'exame', hAtras: 7, pdf: true,
    conteudo: {
      exames: ['Hemograma completo', 'Glicemia de jejum', 'Perfil lipídico', 'TSH e T4 livre'],
      indicacaoClinica: 'Rastreio anual — histórico familiar de diabetes.',
    },
  },
  {
    paciente: 8, tipo: 'declaracao', hAtras: 28, pdf: true,
    conteudo: {
      texto: 'Declaro que o paciente compareceu a esta clínica acompanhado da responsável legal.',
      periodo: 'das 14h às 15h30',
    },
  },
  {
    paciente: 2, tipo: 'encaminhamento', hAtras: 52, pdf: true,
    conteudo: {
      especialidade: 'Cardiologia intervencionista',
      motivo: 'Angina aos médios esforços com eletrocardiograma alterado. Solicito avaliação.',
    },
  },
  {
    paciente: 7, tipo: 'atestado', hAtras: 76, pdf: false,
    conteudo: { descricao: 'Comparecimento a consulta médica nesta data.', dias: 0 },
  },
  {
    paciente: 0, tipo: 'exame', hAtras: 100, pdf: true,
    conteudo: { exames: ['Ecocardiograma transtorácico'], indicacaoClinica: 'Sopro sistólico em ausculta de rotina.' },
  },
] as const;

/**
 * Conversas IA. `min` é "minutos atrás"; as mensagens vão da mais antiga para a
 * mais nova, e o `started_at` da conversa é DERIVADO da primeira delas.
 *
 * Derivar em vez de declarar não é conveniência. `getConversationThread` poda
 * partição com `created_at >= started_at`: uma conversa cujo `started_at` fosse
 * posterior a alguma mensagem esconderia histórico SEM erro nenhum. Derivando,
 * nenhum dado deste arquivo consegue violar o invariante.
 *
 * Os valores seguem o que o AGENTE REAL grava, não o que seria bonito ler:
 *   - `intent` da conversa é o nome da 1ª tool do último turno (`setIntent` em
 *     inbound-received.ts), então é `list_slots`, não "agendamento". Se a tela
 *     mostra um token de tool ao operador, é isso que se precisa ver aqui.
 *   - `ai_messages.intent` fica NULL: `appendOutboundMessage` nunca recebe esse
 *     campo. Preenchê-lo criaria um estado que a produção não produz.
 *   - o provider é Gemini (`AI_PRICE_TABLE_USD_PER_1M`), e o custo é calculado
 *     dos tokens pela mesma tabela — um custo inventado desmentiria o "Diagnóstico
 *     do agente", que mostra tokens e US$ lado a lado.
 */
// Tabela de fixture: uma LINHA por estado. Explodida em um campo por linha, a
// comparação entre os estados — que é o ponto — deixa de caber na tela.
// prettier-ignore
const CONVERSAS = [
  {
    // Pior caso da tela: handoff urgente, SLA vencido e a mensagem humana que
    // não foi entregue — alerta de prazo, alerta de entrega e botão de reenvio.
    paciente: 2, telefone: null, status: 'handoff', intent: 'request_human_handoff', atribuir: 'operador',
    handoff: { motivo: 'manual_takeover', prioridade: 'urgent', dueMin: -35 },
    mensagens: [
      { de: 'paciente', min: 214, texto: 'Boa tarde, preciso remarcar a consulta de quinta-feira.' },
      { de: 'agente', min: 213, texto: 'Boa tarde, Sérgio! Posso ver os horários livres. Prefere manhã ou tarde?', tokIn: 1840, tokOut: 96, latencia: 1120, tools: [{ name: 'list_slots', argKeys: ['date_from', 'date_to'] }] },
      { de: 'paciente', min: 208, texto: 'Prefiro de manhã, mas queria falar com alguém da recepção antes.' },
      { de: 'agente', min: 207, texto: 'Claro. Já chamei a recepção — em instantes alguém assume por aqui.', tokIn: 2010, tokOut: 74, latencia: 980, tools: [{ name: 'request_human_handoff', argKeys: ['reason'] }] },
      { de: 'humano', min: 74, texto: 'Oi, Sérgio, aqui é da recepção. Consigo encaixar quinta às 9h. Serve?', entrega: 'failed' },
    ],
  },
  {
    // Contato SEM cadastro: patient_id nulo ⇒ a lista cai no telefone.
    paciente: null, telefone: '11977310455', status: 'handoff', intent: 'request_human_handoff', atribuir: null,
    handoff: { motivo: 'fallback_limit', prioridade: 'normal', dueMin: -12 },
    mensagens: [
      { de: 'paciente', min: 58, texto: 'Vocês atendem pelo meu convênio? É o plano empresarial.' },
      { de: 'agente', min: 57, texto: 'Vou verificar com a equipe e já retorno com a resposta.', tokIn: 1620, tokOut: 58, latencia: 760, tools: [{ name: 'request_human_handoff', argKeys: ['reason'] }] },
    ],
  },
  {
    // Handoff urgente ainda DENTRO do prazo + mensagem humana entregue.
    paciente: 0, telefone: null, status: 'handoff', intent: 'list_pending_payments', atribuir: 'medico',
    handoff: { motivo: 'divulgação de cobrança', prioridade: 'urgent', dueMin: 18 },
    mensagens: [
      { de: 'paciente', min: 46, texto: 'Recebi uma cobrança da consulta passada, pode confirmar o valor?' },
      { de: 'agente', min: 45, texto: 'Sobre valores eu prefiro passar para a equipe. Só um instante.', tokIn: 1930, tokOut: 66, latencia: 840, tools: [{ name: 'list_pending_payments', argKeys: ['patient_id'] }] },
      { de: 'humano', min: 12, texto: 'Oi, Marina! Confirmo: são R$ 380,00, com vencimento hoje. Já te envio o link.', entrega: 'delivered' },
    ],
  },
  {
    // O estado "normal": agente conduzindo sozinho, sem fila humana.
    paciente: 3, telefone: null, status: 'active', intent: 'prepare_appointment', atribuir: null, handoff: null,
    mensagens: [
      { de: 'paciente', min: 33, texto: 'Oi! Queria marcar um retorno com a Dra.' },
      { de: 'agente', min: 32, texto: 'Oi, Lívia! Tenho terça às 10h40 e quarta às 14h. Alguma dessas serve?', tokIn: 1780, tokOut: 88, latencia: 1340, tools: [{ name: 'list_slots', argKeys: ['date_from', 'date_to'] }] },
      { de: 'paciente', min: 9, texto: 'Terça às 10h40 está ótimo.' },
      { de: 'agente', min: 8, texto: 'Marcado! Terça, 10h40. Vou te lembrar um dia antes.', tokIn: 2240, tokOut: 112, latencia: 1510, tools: [{ name: 'prepare_appointment', argKeys: ['slot_start', 'procedure_id'] }, { name: 'confirm_appointment', argKeys: ['pending_action_id'] }] },
    ],
  },
  {
    // Última mensagem é do PACIENTE: prévia vinda de quem escreveu por último.
    paciente: 5, telefone: null, status: 'active', intent: 'provide_clinic_info', atribuir: null, handoff: null,
    mensagens: [
      { de: 'paciente', min: 130, texto: 'Qual o endereço de vocês?' },
      { de: 'agente', min: 129, texto: 'Estamos na Rua das Acácias, 120 — sala 41. Posso ajudar em mais algo?', tokIn: 1510, tokOut: 52, latencia: 610, tools: [{ name: 'provide_clinic_info', argKeys: [] }] },
      { de: 'paciente', min: 126, texto: 'Só isso, obrigado!' },
    ],
  },
  {
    // Começa com o agente: é um job proativo de confirmação, não um inbound.
    paciente: 4, telefone: null, status: 'closed', intent: 'confirm_appointment', atribuir: null, handoff: null,
    mensagens: [
      { de: 'agente', min: 1580, texto: 'Oi, Rita! Passando para confirmar sua consulta de amanhã às 10h. Posso confirmar?', tokIn: 1340, tokOut: 44, latencia: 720, tools: [] },
      { de: 'paciente', min: 1540, texto: 'Pode confirmar sim.' },
      { de: 'agente', min: 1539, texto: 'Confirmado. Até amanhã!', tokIn: 1580, tokOut: 28, latencia: 640, tools: [{ name: 'confirm_appointment', argKeys: ['appointment_id'] }] },
    ],
  },
  {
    // Abandonada, e sem tool no único turno: `intent_atual` NULL é o estado em
    // que a lista não desenha chip de intenção nenhum.
    paciente: 7, telefone: null, status: 'abandoned', intent: null, atribuir: null, handoff: null,
    mensagens: [
      { de: 'paciente', min: 4210, texto: 'oi' },
      { de: 'agente', min: 4209, texto: 'Oi! Sou o assistente da clínica. Quer marcar, remarcar ou tirar uma dúvida?', tokIn: 1180, tokOut: 62, latencia: 590, tools: [] },
    ],
  },
] as const;

// --- PDF de demonstração -----------------------------------------------------

/**
 * PDF mínimo válido, montado à mão (sem dependência nova).
 *
 * Por que gerar arquivo em vez de só gravar o `pdf_storage_path`: um path que
 * aponta para objeto inexistente faz "Abrir PDF" devolver 404 — o botão
 * existiria mentindo. O pipeline real (`ensurePrescriptionPdf`) não serve aqui
 * porque importa `server-only` e este script roda fora do bundle do Next; o
 * placeholder diz de si mesmo o que é, e o "Regenerar" da tela do PDF o troca
 * pelo documento de verdade.
 */
function pdfDemo(titulo: string): Buffer {
  // O conteúdo de um PDF é latin1 e `(`/`)`/`\` delimitam string: sem isto, um
  // nome com acento ou parêntese corrompe o arquivo inteiro.
  const ascii = (s: string): string =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/([()\\])/g, '\\$1');
  const conteudo = [
    'BT /F1 20 Tf 64 762 Td (Qoro - documento de demonstracao) Tj ET',
    `BT /F1 13 Tf 64 730 Td (${ascii(titulo)}) Tj ET`,
    'BT /F1 10 Tf 64 700 Td (Gerado por scripts/seed-design-states.ts. Sem valor clinico ou legal.) Tj ET',
  ].join('\n');
  const objetos = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    `<</Length ${Buffer.byteLength(conteudo, 'latin1')}>>\nstream\n${conteudo}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objetos.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const inicioXref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/**
 * Sobe o placeholder. Falha de Storage NÃO derruba o seed: a linha fica no
 * estado "PDF pendente", que também é um estado legítimo da tela.
 */
async function subirPdf(path: string, titulo: string): Promise<boolean> {
  try {
    const { error } = await createAdminClient()
      .storage.from(BUCKET_PDF)
      .upload(path, pdfDemo(titulo), { contentType: 'application/pdf', upsert: true });
    if (error) {
      console.warn(`[demo] storage indisponível (${error.message}) — documento fica sem PDF.`);
      return false;
    }
    return true;
  } catch (erro) {
    console.warn(`[demo] storage indisponível (${String(erro)}) — documento fica sem PDF.`);
    return false;
  }
}

/** `IN (...)` com bind por item — drizzle não serializa array JS como `ANY($1)`. */
function listaIn(valores: readonly string[]) {
  return sql.join(
    valores.map((v) => sql`${v}`),
    sql`, `,
  );
}

/**
 * Custo do turno pela MESMA tabela do app, arredondado a 6 casas como manda
 * `cost_usd numeric(10,6)`. O "Diagnóstico do agente" mostra tokens e dólares
 * na mesma linha: um custo inventado desmentiria os tokens ao lado.
 */
function custoGemini(entrada: number, saida: number): string {
  return computeCostUsd({ tokensInput: entrada, tokensOutput: saida, model: MODELO_IA }).toFixed(6);
}

/** `now() - N minutos` sem o `timestamp + unknown` que o Postgres recusa. */
function minutosAtras(min: number) {
  return sql`now() - (${min}::int * interval '1 minute')`;
}

async function main(): Promise<void> {
  // A clínica é a que tem mais gente: em dev é sempre a que se está usando.
  const [clinica] = await dbAdmin.execute<{ id: string; nome: string }>(sql`
    SELECT c.id::text, c.nome
      FROM public.clinics c
      JOIN public.profiles p ON p.clinic_id = c.id
     GROUP BY c.id, c.nome
     ORDER BY count(p.id) DESC, c.created_at ASC
     LIMIT 1
  `);
  if (!clinica) throw new Error('nenhuma clínica em dev — rode `pnpm seed:dev` antes.');
  const clinicId = clinica.id;
  console.log(`[demo] clínica: ${clinica.nome} (${clinicId})`);

  const [medico] = await dbAdmin.execute<{
    id: string;
    nome: string;
    crm: string | null;
    crm_uf: string | null;
    especialidade: string | null;
  }>(sql`
    SELECT id::text, nome, crm, crm_uf, especialidade FROM public.profiles
     WHERE clinic_id = ${clinicId}::uuid AND role = 'doctor' AND ativo
     ORDER BY created_at ASC LIMIT 1
  `);
  if (!medico) throw new Error('nenhum médico ativo na clínica.');

  // Quem assume o handoff. Owner/gestor primeiro porque em dev é quem está
  // logado — e o botão "Reenviar" só aparece para o RESPONSÁVEL da conversa.
  const [operador] = await dbAdmin.execute<{ id: string; nome: string }>(sql`
    SELECT id::text, nome FROM public.profiles
     WHERE clinic_id = ${clinicId}::uuid AND ativo
     ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'gestor' THEN 1 WHEN 'attendant' THEN 2 ELSE 3 END,
              created_at ASC
     LIMIT 1
  `);

  const telefones = [...PACIENTES.map((p) => p.tel), MENOR.tel];
  const nomes = [...PACIENTES.map((p) => p.nome), MENOR.nome];
  const telefonesConversa = [
    ...telefones,
    ...CONVERSAS.flatMap((c) => (c.telefone ? [c.telefone] : [])),
  ];
  const hashesConversa = await Promise.all(telefonesConversa.map((t) => hashForLookup(t)));

  // ---- limpeza do que ESTE script criou antes (idempotência) -----------------
  // `payment_transactions.lancamento_id` é RESTRICT: o razão sai primeiro, e o
  // estorno antes do pagamento que ele referencia.
  await dbAdmin.execute(sql`
    DELETE FROM public.payment_transactions
     WHERE clinic_id = ${clinicId}::uuid
       AND lancamento_id IN (
         SELECT id FROM public.lancamentos
          WHERE clinic_id = ${clinicId}::uuid AND descricao LIKE ${`%${MARCA}%`}
       )
       AND kind = 'refund'
  `);
  await dbAdmin.execute(sql`
    DELETE FROM public.payment_transactions
     WHERE clinic_id = ${clinicId}::uuid
       AND lancamento_id IN (
         SELECT id FROM public.lancamentos
          WHERE clinic_id = ${clinicId}::uuid AND descricao LIKE ${`%${MARCA}%`}
       )
  `);
  await dbAdmin.execute(sql`
    DELETE FROM public.lancamentos
     WHERE clinic_id = ${clinicId}::uuid AND descricao LIKE ${`%${MARCA}%`}
  `);
  // `waiting_queue_entries` tem FK CASCADE para appointments; `recurrence_series`
  // é RESTRICT no sentido inverso (o atendimento aponta para a série), então a
  // série só pode sair DEPOIS dos atendimentos que a referenciam.
  await dbAdmin.execute(sql`
    DELETE FROM public.appointments
     WHERE clinic_id = ${clinicId}::uuid AND snapshot_procedure_codigo = 'DEMO'
  `);
  await dbAdmin.execute(sql`
    DELETE FROM public.recurrence_series
     WHERE clinic_id = ${clinicId}::uuid
       AND procedure_id IN (
         SELECT id FROM public.procedures
          WHERE clinic_id = ${clinicId}::uuid AND codigo = 'DEMO'
       )
  `);
  // ai_messages e ai_handoff_queue caem por FK CASCADE.
  await dbAdmin.execute(sql`
    DELETE FROM public.ai_conversations
     WHERE clinic_id = ${clinicId}::uuid AND patient_phone_hash IN (${listaIn(hashesConversa)})
  `);
  await dbAdmin.execute(sql`
    DELETE FROM public.outbound_messages
     WHERE clinic_id = ${clinicId}::uuid AND to_number_hash IN (${listaIn(hashesConversa)})
  `);
  console.log('[demo] estado anterior removido');

  // ---- procedimento ---------------------------------------------------------
  const [proc] = await dbAdmin.execute<{ id: string }>(sql`
    INSERT INTO public.procedures
      (clinic_id, codigo, descricao, categoria, valor_padrao, duracao_padrao_min, ativo)
    VALUES (${clinicId}::uuid, 'DEMO', ${`Consulta ${MARCA}`}, 'Consulta', '380.00', 30, true)
    ON CONFLICT (clinic_id, codigo) DO UPDATE SET descricao = EXCLUDED.descricao
    RETURNING id::text
  `);
  if (!proc) throw new Error('não foi possível criar o procedimento de demo.');

  // ---- pacientes (upsert por hash de CPF; PII cifrada como no app) -----------
  const pacienteIds: string[] = [];
  for (const p of PACIENTES) {
    const cpf = normalizeCpf(p.cpf);
    const [row] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.patients
        (clinic_id, nome, data_nascimento, sexo, email,
         cpf_encrypted, cpf_hash, telefone_encrypted, telefone_hash)
      VALUES (${clinicId}::uuid, ${p.nome}, ${p.nasc}::date, ${p.sexo}, ${p.email},
         ${await encryptForTenant(clinicId, cpf)}, ${await hashForLookup(cpf)},
         ${await encryptForTenant(clinicId, p.tel)}, ${await hashForLookup(p.tel)})
      ON CONFLICT (clinic_id, cpf_hash) WHERE cpf_hash IS NOT NULL
        DO UPDATE SET nome = EXCLUDED.nome, email = EXCLUDED.email,
                      telefone_encrypted = EXCLUDED.telefone_encrypted,
                      telefone_hash = EXCLUDED.telefone_hash,
                      data_nascimento = EXCLUDED.data_nascimento
      RETURNING id::text
    `);
    if (!row) throw new Error(`falha ao criar paciente ${p.nome}`);
    pacienteIds.push(row.id);
  }
  // O menor e o vínculo no MESMO commit — a constraint é deferida e só valida
  // no fim da transação.
  const responsavelId = pacienteIds[MENOR.responsavel]!;
  const cpfMenor = normalizeCpf(MENOR.cpf);
  const cpfHashMenor = await hashForLookup(cpfMenor);
  const cpfCifradoMenor = await encryptForTenant(clinicId, cpfMenor);
  const telCifradoMenor = await encryptForTenant(clinicId, MENOR.tel);
  const telHashMenor = await hashForLookup(MENOR.tel);

  const menorId = await dbAdmin.transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string }>(sql`
      INSERT INTO public.patients
        (clinic_id, nome, data_nascimento, sexo, email,
         cpf_encrypted, cpf_hash, telefone_encrypted, telefone_hash)
      VALUES (${clinicId}::uuid, ${MENOR.nome}, ${MENOR.nasc}::date, ${MENOR.sexo}, ${MENOR.email},
         ${cpfCifradoMenor}, ${cpfHashMenor}, ${telCifradoMenor}, ${telHashMenor})
      ON CONFLICT (clinic_id, cpf_hash) WHERE cpf_hash IS NOT NULL
        DO UPDATE SET nome = EXCLUDED.nome, data_nascimento = EXCLUDED.data_nascimento
      RETURNING id::text
    `);
    if (!row) throw new Error('falha ao criar o paciente menor');
    await tx.execute(sql`
      INSERT INTO public.patient_relationships
        (clinic_id, responsible_patient_id, dependent_patient_id, relationship_type,
         legal_guardian, financial_responsible, can_manage_appointments)
      VALUES (${clinicId}::uuid, ${responsavelId}::uuid, ${row.id}::uuid, 'mae', true, true, true)
      ON CONFLICT (responsible_patient_id, dependent_patient_id) DO NOTHING
    `);
    return row.id;
  });
  pacienteIds.push(menorId);
  console.log(`[demo] ${pacienteIds.length} pacientes (1 menor com responsável)`);

  // ---- agenda de hoje -------------------------------------------------------
  // Uma série recorrente para a linha "3 de 8 · semanal": sem ela o campo
  // `recurrence_occurrence` não informa nada — "ocorrência 3" de quantas?
  const [serie] = await dbAdmin.execute<{ id: string }>(sql`
    INSERT INTO public.recurrence_series
      (clinic_id, doctor_id, patient_id, procedure_id, interval_weeks, occurrences, status, created_by)
    VALUES (${clinicId}::uuid, ${medico.id}::uuid, ${pacienteIds[2]}::uuid, ${proc.id}::uuid,
       1, 8, 'active', ${medico.id}::uuid)
    RETURNING id::text
  `);
  if (!serie) throw new Error('falha ao criar a série recorrente de demo');

  let naFila = 0;
  for (const a of AGENDA) {
    const encaixe = 'encaixe' in a && a.encaixe;
    const ocorrencia = 'serie' in a ? a.serie : null;
    const [atendimento] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.appointments
        (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
         snapshot_procedure_name, snapshot_procedure_codigo, snapshot_procedure_categoria,
         snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome,
         created_via, urgencia, recurrence_series_id, recurrence_occurrence, created_by, created_at)
      VALUES (${clinicId}::uuid, ${medico.id}::uuid, ${pacienteIds[a.paciente]}::uuid,
         ${proc.id}::uuid, (current_date + ${a.hora}::time) AT TIME ZONE 'America/Sao_Paulo',
         ${a.dur}, ${a.status}::appointment_status, ${a.valor},
         ${a.proc}, 'DEMO', 'Consulta',
         ${a.valor}, ${a.dur}, ${medico.nome},
         ${encaixe ? 'walkin' : 'attendant'}::appointment_created_via,
         ${'urgente' in a && a.urgente ? true : false},
         ${ocorrencia == null ? null : serie.id}::uuid, ${ocorrencia},
         ${medico.id}::uuid,
         ${encaixe ? minutosAtras(184) : sql`now()`})
      RETURNING id::text
    `);
    if (!atendimento) throw new Error(`falha ao criar atendimento de ${a.hora}`);

    // O check-in do consultório é linha PRÓPRIA. `queued_at` é a chegada e
    // `started_at` é a chamada — a Agenda e o Consultório contam o tempo a
    // partir daí, não do horário agendado.
    const espera = 'esperaMin' in a ? a.esperaMin : null;
    if (espera != null) {
      const atendendo = 'atendendoMin' in a ? a.atendendoMin : null;
      await dbAdmin.execute(sql`
        INSERT INTO public.waiting_queue_entries
          (clinic_id, appointment_id, doctor_id, priority, status,
           estimated_wait_minutes_at_entry, queued_at, started_at, created_by)
        VALUES (${clinicId}::uuid, ${atendimento.id}::uuid, ${medico.id}::uuid,
           ${'urgente' in a && a.urgente ? 'urgent' : 'normal'}::waiting_queue_priority,
           ${atendendo == null ? 'waiting' : 'in_service'}::waiting_queue_status,
           15, ${minutosAtras(espera)},
           ${atendendo == null ? sql`NULL` : minutosAtras(atendendo)}, ${medico.id}::uuid)
      `);
      naFila += 1;
    }
  }
  console.log(`[demo] ${AGENDA.length} atendimentos hoje (${naFila} na fila do consultório)`);

  // ---- caixa / financeiro ---------------------------------------------------
  // Dinheiro recebido mora em DOIS lugares e os dois têm de contar a mesma
  // história: `lancamentos` é o SALDO da cobrança (o que Caixa e Financeiro
  // leem) e `payment_transactions` é o RAZÃO (o que Relatórios soma). Gravar só
  // o primeiro produz um estado que a produção nunca cria: a cobrança aparece
  // paga na tela do dia e o faturamento do período fica em zero.
  let transacoes = 0;
  for (const l of LANCAMENTOS) {
    const metodo = 'metodo' in l ? l.metodo : null;
    const pagoHoje = 'pagoHoje' in l && l.pagoHoje;
    const [lancamento] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.lancamentos
        (clinic_id, tipo, descricao, valor, valor_pago, status, due_date, paid_at,
         patient_id, payment_method, created_via, snapshot_procedure_name, snapshot_doctor_nome)
      VALUES (${clinicId}::uuid, ${l.tipo}::lancamento_tipo, ${`${l.desc} ${MARCA}`},
         ${l.valor}, ${l.pago}, ${l.status}::lancamento_status,
         current_date + (${l.diasDue})::int, ${pagoHoje ? sql`now()` : sql`NULL`},
         ${l.paciente == null ? null : pacienteIds[l.paciente]}::uuid,
         ${metodo}, 'manual',
         ${'proc' in l ? l.proc : null}, ${l.paciente == null ? null : medico.nome})
      RETURNING id::text
    `);
    if (!lancamento) throw new Error(`falha ao criar lançamento ${l.desc}`);
    if (Number(l.pago) <= 0) continue;

    const quando = pagoHoje ? sql`now()` : minutosAtras(60 * 24 * 2);
    const [pagamento] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.payment_transactions
        (clinic_id, lancamento_id, kind, amount, payment_method, occurred_at, created_by)
      VALUES (${clinicId}::uuid, ${lancamento.id}::uuid, 'payment', ${l.pago},
         ${metodo}, ${quando}, ${medico.id}::uuid)
      RETURNING id::text
    `);
    if (!pagamento) throw new Error(`falha ao registrar pagamento de ${l.desc}`);
    transacoes += 1;

    // Estorno é lançamento PRÓPRIO no razão, apontando para o pagamento que
    // desfaz (`payment_transactions_kind_coerencia_chk` exige original + motivo).
    // O pagamento original CONTINUA lá: é assim que o histórico não mente.
    if (l.status === 'estornado') {
      await dbAdmin.execute(sql`
        INSERT INTO public.payment_transactions
          (clinic_id, lancamento_id, kind, amount, payment_method, occurred_at,
           original_payment_id, reason, created_by)
        VALUES (${clinicId}::uuid, ${lancamento.id}::uuid, 'refund', ${l.pago},
           ${metodo}, ${quando}, ${pagamento.id}::uuid,
           ${`Estorno de demonstração ${MARCA}`}, ${medico.id}::uuid)
      `);
      transacoes += 1;
    }
  }
  console.log(`[demo] ${LANCAMENTOS.length} lançamentos (${transacoes} no razão)`);

  // ---- documentos -----------------------------------------------------------
  // O PDF sai junto com a linha: o path deriva do id, então cada reseed deixaria
  // um objeto órfão no bucket se a limpeza olhasse só para o banco.
  const crm = medico.crm ?? 'CRM 00000';
  const orfaos: string[] = [];
  const apagadasReceitas = await dbAdmin.execute<{ pdf_storage_path: string | null }>(sql`
    DELETE FROM public.prescriptions
     WHERE clinic_id = ${clinicId}::uuid AND patient_id IN (${listaIn(pacienteIds)})
    RETURNING pdf_storage_path
  `);
  const apagadosDocs = await dbAdmin.execute<{ pdf_storage_path: string | null }>(sql`
    DELETE FROM public.medical_documents
     WHERE clinic_id = ${clinicId}::uuid AND patient_id IN (${listaIn(pacienteIds)})
    RETURNING pdf_storage_path
  `);
  for (const row of [...apagadasReceitas, ...apagadosDocs]) {
    if (row.pdf_storage_path) orfaos.push(row.pdf_storage_path);
  }
  if (orfaos.length > 0) {
    try {
      await createAdminClient().storage.from(BUCKET_PDF).remove(orfaos);
    } catch {
      // Objeto órfão em bucket de dev não justifica derrubar o seed.
    }
  }

  let comPdf = 0;
  for (const r of RECEITAS) {
    const controle = r.kind === 'controle_especial';
    const nome = nomes[r.paciente]!;
    const [row] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.prescriptions
        (clinic_id, patient_id, doctor_id, kind, medicamentos_encrypted, observacoes_encrypted,
         snapshot_patient_nome, snapshot_doctor_nome, snapshot_doctor_crm, snapshot_doctor_crm_uf,
         snapshot_doctor_especialidade, snapshot_patient_endereco, snapshot_emitente_nome,
         snapshot_emitente_endereco, snapshot_emitente_telefone, created_by, created_at, updated_at)
      VALUES (${clinicId}::uuid, ${pacienteIds[r.paciente]}::uuid, ${medico.id}::uuid,
         ${r.kind}::prescription_kind,
         ${await encryptForTenant(clinicId, JSON.stringify(r.medicamentos))},
         ${r.observacoes ? await encryptForTenant(clinicId, JSON.stringify(r.observacoes)) : null},
         ${nome}, ${medico.nome}, ${crm}, ${medico.crm_uf},
         ${medico.especialidade},
         ${controle ? 'Rua das Acácias, 120 — São Paulo/SP' : null},
         ${controle ? clinica.nome : null},
         ${controle ? 'Rua das Acácias, 120 — sala 41 — São Paulo/SP' : null},
         ${controle ? '(11) 4000-2088' : null},
         ${medico.id}::uuid, ${minutosAtras(r.hAtras * 60)}, ${minutosAtras(r.hAtras * 60)})
      RETURNING id::text
    `);
    if (!row) throw new Error('falha ao criar receita de demo');
    const path = `${clinicId}/prescriptions/${row.id}.pdf`;
    if (r.pdf && (await subirPdf(path, `Receita - ${nome}`))) {
      await dbAdmin.execute(sql`
        UPDATE public.prescriptions SET pdf_storage_path = ${path} WHERE id = ${row.id}::uuid
      `);
      comPdf += 1;
    }
  }

  for (const d of DOCUMENTOS_MEDICOS) {
    const nome = nomes[d.paciente]!;
    const [row] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.medical_documents
        (clinic_id, patient_id, doctor_id, type, content_encrypted,
         snapshot_patient_nome, snapshot_doctor_nome, snapshot_doctor_crm, snapshot_doctor_crm_uf,
         snapshot_doctor_especialidade, created_by, created_at, updated_at)
      VALUES (${clinicId}::uuid, ${pacienteIds[d.paciente]}::uuid, ${medico.id}::uuid,
         ${d.tipo}::medical_document_type,
         ${await encryptForTenant(clinicId, JSON.stringify(d.conteudo))},
         ${nome}, ${medico.nome}, ${crm}, ${medico.crm_uf},
         ${medico.especialidade}, ${medico.id}::uuid,
         ${minutosAtras(d.hAtras * 60)}, ${minutosAtras(d.hAtras * 60)})
      RETURNING id::text
    `);
    if (!row) throw new Error('falha ao criar documento de demo');
    const path = `${clinicId}/documents/${d.tipo}/${row.id}.pdf`;
    if (d.pdf && (await subirPdf(path, `${d.tipo} - ${nome}`))) {
      await dbAdmin.execute(sql`
        UPDATE public.medical_documents SET pdf_storage_path = ${path} WHERE id = ${row.id}::uuid
      `);
      comPdf += 1;
    }
  }
  const totalDocs = RECEITAS.length + DOCUMENTOS_MEDICOS.length;
  console.log(
    `[demo] ${totalDocs} documentos (${comPdf} com PDF, ${totalDocs - comPdf} pendentes)`,
  );

  // ---- conversas IA ---------------------------------------------------------
  let mensagens = 0;
  for (const c of CONVERSAS) {
    const telefone = c.telefone ?? telefones[c.paciente!]!;
    const telefoneHash = await hashForLookup(telefone);
    const primeira = c.mensagens[0]!;
    const ultima = c.mensagens[c.mensagens.length - 1]!;
    const [conversa] = await dbAdmin.execute<{ id: string }>(sql`
      INSERT INTO public.ai_conversations
        (clinic_id, patient_id, patient_phone_hash, patient_phone_encrypted,
         started_at, last_message_at, status, intent_atual, created_at, updated_at)
      VALUES (${clinicId}::uuid,
         ${c.paciente == null ? null : pacienteIds[c.paciente]}::uuid,
         ${telefoneHash}, ${await encryptForTenant(clinicId, telefone)},
         ${minutosAtras(primeira.min)}, ${minutosAtras(ultima.min)},
         ${c.status}::ai_conversation_status, ${c.intent},
         ${minutosAtras(primeira.min)}, ${minutosAtras(ultima.min)})
      RETURNING id::text
    `);
    if (!conversa) throw new Error('falha ao criar conversa de demo');

    for (const m of c.mensagens) {
      const agente = m.de === 'agente';
      const humano = m.de === 'humano';
      // `event_id` é a chave de idempotência da mensagem humana: é por ele que a
      // thread cruza com outbound_messages para saber se ela foi entregue.
      const eventId = humano ? randomUUID() : null;
      const entrega = 'entrega' in m ? m.entrega : 'sent';
      await dbAdmin.execute(sql`
        INSERT INTO public.ai_messages
          (clinic_id, conversation_id, direction, content_encrypted, intent, tool_calls,
           tokens_input, tokens_output, cost_usd, model, latency_ms, event_id, sent_by_user_id,
           created_at)
        VALUES (${clinicId}::uuid, ${conversa.id}::uuid,
           ${m.de === 'paciente' ? 'in' : 'out'}::ai_message_direction,
           ${await encryptForTenant(clinicId, m.texto)},
           ${null},
           ${'tools' in m ? JSON.stringify(m.tools) : null}::jsonb,
           ${'tokIn' in m ? m.tokIn : null}, ${'tokOut' in m ? m.tokOut : null},
           ${'tokIn' in m ? custoGemini(m.tokIn, m.tokOut) : null},
           ${agente ? MODELO_IA : null},
           ${'latencia' in m ? m.latencia : null},
           ${eventId}::uuid,
           ${humano && operador ? operador.id : null}::uuid,
           ${minutosAtras(m.min)})
      `);
      mensagens += 1;

      if (humano && eventId) {
        await dbAdmin.execute(sql`
          INSERT INTO public.outbound_messages
            (clinic_id, idempotency_key, to_number_hash, content_encrypted, status,
             sent_at, delivered_at, failed_at, status_updated_at, created_at)
          VALUES (${clinicId}::uuid, ${eventId}, ${telefoneHash},
             ${await encryptForTenant(clinicId, m.texto)},
             ${entrega}::outbound_status,
             ${minutosAtras(m.min)},
             ${entrega === 'delivered' ? minutosAtras(m.min - 1) : sql`NULL`},
             ${entrega === 'failed' ? minutosAtras(m.min - 1) : sql`NULL`},
             ${minutosAtras(m.min - 1)}, ${minutosAtras(m.min)})
        `);
      }
    }

    if (c.handoff) {
      const assignee =
        c.atribuir === 'operador'
          ? (operador?.id ?? null)
          : c.atribuir === 'medico'
            ? medico.id
            : null;
      await dbAdmin.execute(sql`
        INSERT INTO public.ai_handoff_queue
          (clinic_id, conversation_id, reason, assigned_to, assigned_at, priority, due_at,
           created_at, updated_at)
        VALUES (${clinicId}::uuid, ${conversa.id}::uuid, ${`${c.handoff.motivo} ${MARCA}`},
           ${assignee}::uuid, ${assignee ? minutosAtras(ultima.min) : sql`NULL`},
           ${c.handoff.prioridade}::ai_handoff_priority,
           ${minutosAtras(-c.handoff.dueMin)},
           ${minutosAtras(ultima.min)}, ${minutosAtras(ultima.min)})
      `);
    }
  }
  console.log(`[demo] ${CONVERSAS.length} conversas IA (${mensagens} mensagens)`);

  console.log(
    '\n[demo] ✅ pronto — recarregue /agenda, /consultorio, /caixa, /financeiro, /documentos, /conversas.',
  );
}

await main();
process.exit(0);
