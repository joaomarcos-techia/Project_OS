/**
 * Semantic Guard (C11) — camada anti-SAMD obrigatória, em DUAS bordas (G4):
 *
 *   1. PRÉ-FILTRO (isMedicalQuestion) — roda ANTES do Gemini sobre a mensagem
 *      do paciente. Pergunta clínica → responde CLINICAL_FALLBACK direto:
 *      custo zero, latência zero, zero chance do LLM tentar orientar.
 *   2. PÓS-RESPOSTA (checkClinicalContent) — roda sobre o output do LLM.
 *      Detectou conteúdo clínico → resposta SUBSTITUÍDA pelo fallback.
 *
 * Estratégia MVP (congelada como experimento §11.17): regex + keywords +
 * blacklist pt-BR, case/acento-insensível. FALSO POSITIVO é aceitável (cai no
 * fallback seguro e o médico assume); falso negativo NÃO é — em dúvida,
 * adicione o termo. Evolução possível: 2ª chamada LLM como juiz (C13+).
 *
 * O agente JAMAIS pode: diagnosticar, interpretar exames, orientar sintomas,
 * sugerir tratamento, sugerir medicamentos.
 */

/** Normaliza para matching: minúsculas + sem acentos. */
function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Blacklist por categoria (termos SEM acento — o input é normalizado).
 * Regex compilada uma vez no module load.
 */
const PATTERNS: ReadonlyArray<{ category: string; re: RegExp }> = [
  {
    category: 'sintomas',
    re: /\b(dor(es)?|doi|doendo|febre|sangram\w*|tontura|tonteira|enjoo|nausea|vomito|diarreia|falta de ar|cansaco|fadiga|mancha\w*|coceira|incha\w*|palpitac\w*|desmaio|formigamento|convuls\w*|sintoma\w*|mal[- ]estar|colica\w*|azia|queimacao|calafrio\w*|secrecao|caroco|nodulo|les(a|o)es?\b|tosse\w*|catarro|coriza|espirr\w*|gripad\w*|resfriad\w*)/,
  },
  {
    category: 'diagnostico',
    re: /\b(diagnostic\w*|o que (eu )?tenho|estou com|to com|pode ser (cancer|tumor|infecc\w*|virus|dengue|covid|gripe)|isso (e|indica|parece)|voce (esta|ta) com|doenca\w*|infecc\w*|inflamac\w*|tumor\w*|cancer|diabetes|hipertensao|pressao (alta|baixa)|depressao|ansiedade|virose|dengue|covid|gripe)\b/,
  },
  {
    category: 'medicamentos',
    re: /\b(remedio\w*|medicament\w*|medicac\w*|dosagem|posologia|\d+ ?mg\b|comprimido\w*|antibiotico\w*|anti[- ]?inflamatorio\w*|analgesico\w*|dipirona|paracetamol|ibuprofeno|amoxicilina|omeprazol|rivotril|fluoxetina|xarope\w*|pode tomar|posso tomar|devo tomar|tomar (algum|algo|um) (remedio|medicamento)|receit(a|ar|e) (um |o )?(remedio|medicament\w*)|automedicac\w*)\b/,
  },
  {
    category: 'exames',
    re: /\b(interpretar?\w* (o |meu )?(exame|laudo|resultado)|resultado d?o exame|laudo|hemograma|raio[- ]?x|ressonancia|tomografia|ultrassom|biopsia|(exame|resultado) (deu|veio|mostra|indica)|valores? de referencia)\b/,
  },
  {
    category: 'tratamento',
    re: /\b(tratamento (para|de|do|da)|como (tratar|curar|aliviar)|o que fazer (para|pra) (dor|febre|melhorar)|cirurgia (e|seria) (necessari\w*|indicad\w*)|preciso (operar|de cirurgia))\b/,
  },
];

export interface SemanticCheckResult {
  safe: boolean;
  /** Categoria + termo casado (telemetria; NUNCA inclui o texto completo). */
  matched?: string;
}

/**
 * Engine única das duas bordas: varre o texto normalizado contra a blacklist.
 */
export function checkClinicalContent(text: string): SemanticCheckResult {
  const norm = normalize(text);
  for (const { category, re } of PATTERNS) {
    const m = re.exec(norm);
    if (m) return { safe: false, matched: `${category}:${m[0]}` };
  }
  return { safe: true };
}

/** Borda 1 (G4): pergunta clínica do paciente → nem chama o LLM. */
export function isMedicalQuestion(inboundText: string): SemanticCheckResult {
  return checkClinicalContent(inboundText);
}

/**
 * Intenção OPERACIONAL na mensagem (F-01 — auditoria 2026-08-14).
 *
 * Não é um guard: é o que distingue "estou com dor" (pergunta clínica pura) de
 * "quero marcar por causa de uma dor de dente" (pedido operacional que MENCIONA
 * sintoma). Os dois viravam a mesma resposta seca e a consulta era perdida em
 * silêncio — no caso mais frequente de uma clínica.
 */
const OPERATIONAL_RE =
  /\b(marcar|marca|marque|agendar|agenda|agende|remarcar|reagendar|desmarcar|cancelar|cancela|confirmar|confirma|horario\w*|hora\b|vaga\w*|encaixe|consulta\w*|atendimento\w*|preco\w*|valor\w*|quanto custa|endereco|onde fica|localizacao|funciona|aberto|convenio|plano de saude|atendente|humano)\b/;

export function detectOperationalIntent(text: string): boolean {
  return OPERATIONAL_RE.test(normalize(text));
}

/**
 * Pedido explícito de atendimento humano (F-02).
 *
 * Durante a coleta de cadastro o servidor interpreta TODA mensagem como o campo
 * pendente — "quero falar com um atendente" virava "nome inválido" e o paciente
 * ficava presa no formulário. Este detector é a porta de saída.
 */
const HUMAN_HANDOFF_RE =
  /\b(atendente|humano|pessoa de verdade|secretaria|recepcao|falar com (alguem|uma pessoa|voce|humano)|me lig(a|ar|ue)|liga(r|m)? (pra|para) mim|telefone da clinica)\b/;

export function detectHumanHandoffRequest(text: string): boolean {
  return HUMAN_HANDOFF_RE.test(normalize(text));
}

/**
 * Pergunta de INFORMAÇÃO da clínica (08/10/2026) — endereço, preço, horário,
 * convênio, estacionamento. Durante o cadastro o servidor lia toda mensagem como
 * o campo pendente: "qual o endereço de vocês?" virava o `motivo` da consulta e
 * "quanto custa a consulta?" virava "CPF inválido". Os termos são específicos de
 * propósito: um motivo legítimo ("consulta de rotina") não pode casar.
 */
const INFORMATION_QUESTION_RE =
  /\b(endereco|onde (fica|ficam)|como (chego|chegar)|localizacao|horario de (funcionamento|atendimento)|que horas (voces )?(abre|abrem|fecha|fecham)|quanto custa|qual (o|e o) (preco|valor)|preco da consulta|valor da consulta|aceita(m)? (convenio|plano|cartao|pix)|tem estacionamento|estacionamento)\b/;

/**
 * "Já paguei" (08/10/2026, EC-22). O paciente AFIRMA que pagou — o servidor
 * responde com o status real da cobrança, sem LLM, e nunca dá nada como pago
 * pela palavra dele. Pergunta e futuro ("posso pagar em dinheiro?", "vou pagar
 * amanhã") não casam: seguem para o fluxo normal. Negação ("ainda não paguei")
 * também não.
 *
 * `cash` separa o pagamento em dinheiro: ele não passa pelo Asaas, quem
 * confirma é a equipe da clínica.
 */
const PAYMENT_CLAIM_RE =
  /\b(ja paguei|paguei|ja fiz o (pix|pagamento)|fiz o (pix|pagamento)|ja transferi|transferi|ja foi pago|pagamento (feito|realizado|efetuado|concluido)|(efetuei|realizei|conclui) o pagamento|(mandei|enviei|segue) o comprovante)\b/;
const PAYMENT_CLAIM_NEGATION_RE =
  /\b(nao|ainda nao|nunca)\s+(paguei|fiz o (pix|pagamento)|transferi|foi pago)\b/;
const PAYMENT_CASH_RE =
  /\b(em dinheiro|no dinheiro|em especie|na especie|na recepcao|no balcao|pessoalmente|no caixa da clinica|na clinica)\b/;

export function detectPaymentClaim(text: string): { claimed: boolean; cash: boolean } {
  const normalized = normalize(text);
  if (!PAYMENT_CLAIM_RE.test(normalized) || PAYMENT_CLAIM_NEGATION_RE.test(normalized)) {
    return { claimed: false, cash: false };
  }
  return { claimed: true, cash: PAYMENT_CASH_RE.test(normalized) };
}

export function detectInformationQuestion(text: string): boolean {
  return INFORMATION_QUESTION_RE.test(normalize(text));
}

/**
 * Sinais de URGÊNCIA (08/10/2026). Não é triagem nem diagnóstico: são relatos em
 * que a resposta clínica padrão — "vou marcar para você conversar com o médico"
 * — é perigosa, porque oferece consulta futura a quem pode estar em emergência.
 * Falso positivo custa um aviso de emergência e um humano na conversa; falso
 * negativo custa alguém com dor no peito esperando o horário de amanhã. Na
 * dúvida, o termo entra. Rótulos fixos: nenhum texto do paciente vai para a
 * telemetria.
 */
const EMERGENCY_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  {
    label: 'peito',
    re: /\b((dor|aperto|pressao|queimacao) (forte )?no peito|peito (doi|doe|doendo|apertado|ta doendo|esta doendo))\b/,
  },
  {
    label: 'respiracao',
    re: /\b(falta de ar|sem ar|nao (consigo|consegue|esta conseguindo|to conseguindo) respirar|dificuldade (para|pra|de) respirar|sufoca\w*)\b/,
  },
  {
    label: 'consciencia',
    re: /\b(desmai\w*|convuls\w*|inconscient\w*|desacordad\w*|perd\w* (a )?consciencia|nao (acorda|responde))\b/,
  },
  {
    label: 'neurologico',
    re: /\b(avc|derrame|boca torta|rosto torto|perd\w* (a )?forca (no|na|do|da) (braco|perna|lado))\b/,
  },
  { label: 'cardiaco', re: /\b(infart\w*|parada cardiaca)\b/ },
  {
    label: 'sangramento',
    re: /\b(hemorragia|sangrando muito|sangramento (forte|intenso|muito forte|que nao para))\b/,
  },
  {
    label: 'intoxicacao',
    re: /\b(overdose|envenen\w*|intoxica\w*|engoli\w* (veneno|produto de limpeza|remedios?|comprimidos))\b/,
  },
  {
    label: 'alergia_grave',
    re: /\b(anafila\w*|garganta (esta |ta )?(fechando|fechou|inchad\w*|inchando)|lingua (esta |ta )?(inchad\w*|inchando)|reacao alergica (grave|forte))\b/,
  },
  {
    label: 'autolesao',
    re: /\b(suicid\w*|me matar|se matar|tirar (a )?minha (propria )?vida|acabar com (a )?minha vida|nao quero mais viver|me machucar|automutila\w*|autolesao)\b/,
  },
  { label: 'emergencia', re: /\bemergencia\b/ },
];

/** Relato com sinal de urgência? `matched` = rótulo fixo (telemetria). */
export function detectEmergency(text: string): SemanticCheckResult {
  const norm = normalize(text);
  for (const { label, re } of EMERGENCY_PATTERNS) {
    if (re.test(norm)) return { safe: false, matched: `emergencia:${label}` };
  }
  return { safe: true };
}

/** Estados de cadastro conduzidos INTEGRALMENTE pelo servidor (sem LLM). */
type ServerDrivenRegistration = 'collecting' | 'awaiting_confirmation';

export type TurnGuardDecision =
  | { kind: 'allow' }
  /** Sinal de urgência → orientação de emergência fixa + humano, sem LLM. */
  | { kind: 'emergency'; matched: string }
  /** Pergunta clínica pura → fallback clínico + contador de escalonamento. */
  | { kind: 'clinical_block'; matched: string }
  /** Clínico E operacional → fallback clínico + retomada da jornada, sem LLM. */
  | { kind: 'clinical_with_operational'; matched: string }
  /** Turno de cadastro: resposta determinística do servidor, LLM nunca roda. */
  | { kind: 'collection_bypass' };

/**
 * Decide o destino do turno ANTES do Gemini (G4 + F-01).
 *
 * A ordem importa e é o coração da correção:
 *
 *  0. **Urgência antes de tudo** (08/10/2026). Nem o cadastro em andamento pode
 *     transformar "estou com dor no peito e falta de ar" no campo `motivo`, nem o
 *     fallback clínico pode responder "vou marcar para você conversar com o
 *     médico" a quem talvez precise do SAMU agora.
 *  1. **Cadastro primeiro.** Num turno de coleta o servidor responde sozinho —
 *     o LLM não é chamado, logo não há risco de orientação clínica. Sem esta
 *     isenção, um `motivo` legítimo como "dor nas costas" era barrado pelo
 *     pré-filtro, nunca gravado, e o cadastro travava para sempre (F-01/F-02).
 *  2. **Clínico + operacional** vira resposta combinada: a recusa clínica
 *     obrigatória MAIS o encaminhamento do que dá para resolver. A jornada
 *     continua na próxima mensagem em vez de morrer.
 *  3. **Clínico puro** mantém exatamente o comportamento anti-SAMD de sempre.
 *
 * A blacklist clínica NÃO é afrouxada em nenhum caminho — `adversarial-corpus`
 * + `semantic-guard.test.ts` travam isso.
 */
export function decideTurnGuard(args: {
  text: string;
  registrationStatus: string;
}): TurnGuardDecision {
  const emergency = detectEmergency(args.text);
  if (!emergency.safe) return { kind: 'emergency', matched: emergency.matched ?? 'emergencia' };

  const serverDriven: readonly string[] = [
    'collecting',
    'awaiting_confirmation',
  ] satisfies readonly ServerDrivenRegistration[];
  if (serverDriven.includes(args.registrationStatus)) return { kind: 'collection_bypass' };

  const clinical = isMedicalQuestion(args.text);
  if (clinical.safe) return { kind: 'allow' };
  const matched = clinical.matched ?? 'clinico';
  return detectOperationalIntent(args.text)
    ? { kind: 'clinical_with_operational', matched }
    : { kind: 'clinical_block', matched };
}

/**
 * C12 (ADR-023) — detecção de prompt-injection APENAS PARA AUDITORIA. NÃO
 * bloqueia: a defesa real é tool whitelist (G9) + Zod + RLS + recusa do próprio
 * LLM (gate §11.12: 50/50). Um filtro de string é frágil e dá falsa sensação de
 * segurança; aqui só emitimos métrica de visibilidade quando há tentativa óbvia.
 * `matched` é categoria:termo (telemetria), nunca o texto completo.
 */
/**
 * Padrões ROTULADOS (F-18 — auditoria 2026-08-14).
 *
 * Antes era um regex único e `matched` levava `m[0]` para a métrica. Como
 * vários ramos usam curingas (`.{0,40}`), o trecho casado carregava TEXTO DO
 * PACIENTE para o log — numa base onde o conteúdo da conversa é cifrado em
 * repouso justamente para não estar em claro. O rótulo abaixo é fixo e escrito
 * por nós; nenhum caractere do inbound atravessa esta fronteira.
 */
const INJECTION_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: 'ignore_instructions', re: /\bignore\w*.{0,40}(instru\w*|prompt|regras?)/ },
  { label: 'ignore_instructions', re: /\bdisregard.{0,40}(instru|above|previous)/ },
  { label: 'ignore_instructions', re: /\besque(ca|ce)\w*.{0,40}(instru\w*|tudo|regras?)/ },
  { label: 'reveal_prompt', re: /\bsystem prompt\b/ },
  { label: 'reveal_prompt', re: /\breveal.{0,20}(prompt|system)/ },
  { label: 'dump_data', re: /\bmostr\w*.{0,25}(prompt|banco|database|todos os pacientes|tabela)/ },
  { label: 'dump_data', re: /\blist.{0,20}(patients|pacientes|usuarios|users)/ },
  { label: 'dump_data', re: /\bshow.{0,20}(database|all (patients|data))/ },
  { label: 'sql', re: /\b(drop table|select \* from)\b/ },
  { label: 'role_override', re: /\b(voce agora e|act as|aja como)\b/ },
  { label: 'jailbreak', re: /\b(developer mode|jailbreak)\b/ },
];

export function detectPromptInjection(inboundText: string): SemanticCheckResult {
  const norm = normalize(inboundText);
  for (const { label, re } of INJECTION_PATTERNS) {
    if (re.test(norm)) return { safe: false, matched: `injection:${label}` };
  }
  return { safe: true };
}
