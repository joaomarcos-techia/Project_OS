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
    re: /\b(dor(es)?|febre|sangram\w*|tontura|tonteira|enjoo|nausea|vomito|diarreia|falta de ar|cansaco|fadiga|mancha\w*|coceira|incha\w*|palpitac\w*|desmaio|formigamento|convuls\w*|sintoma\w*|mal[- ]estar|colica\w*|azia|queimacao|calafrio\w*|secrecao|caroco|nodulo|les(a|o)es?\b)/,
  },
  {
    category: 'diagnostico',
    re: /\b(diagnostic\w*|o que (eu )?tenho|estou com|to com|pode ser (cancer|tumor|infecc\w*|virus|dengue|covid|gripe)|isso (e|indica|parece)|voce (esta|ta) com|doenca\w*|infecc\w*|inflamac\w*|tumor\w*|cancer|diabetes|hipertensao|pressao (alta|baixa)|depressao|ansiedade|virose|dengue|covid|gripe)\b/,
  },
  {
    category: 'medicamentos',
    re: /\b(remedio\w*|medicament\w*|medicac\w*|dosagem|posologia|\d+ ?mg\b|comprimido\w*|antibiotico\w*|anti[- ]?inflamatorio\w*|analgesico\w*|dipirona|paracetamol|ibuprofeno|amoxicilina|omeprazol|rivotril|fluoxetina|pode tomar|devo tomar|tomar (algum|algo|um) (remedio|medicamento)|receit(a|ar|e) (um |o )?(remedio|medicament\w*)|automedicac\w*)\b/,
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

/** Estados de cadastro conduzidos INTEGRALMENTE pelo servidor (sem LLM). */
type ServerDrivenRegistration = 'collecting' | 'awaiting_confirmation';

export type TurnGuardDecision =
  | { kind: 'allow' }
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
const INJECTION_RE =
  /\b(ignore\w*.{0,40}(instru\w*|prompt|regras?)|disregard.{0,40}(instru|above|previous)|esque(ca|ce)\w*.{0,40}(instru\w*|tudo|regras?)|system prompt|reveal.{0,20}(prompt|system)|mostr\w*.{0,25}(prompt|banco|database|todos os pacientes|tabela)|list.{0,20}(patients|pacientes|usuarios|users)|show.{0,20}(database|all (patients|data))|drop table|select \* from|voce agora e|act as|aja como|developer mode|jailbreak)/;

export function detectPromptInjection(inboundText: string): SemanticCheckResult {
  const norm = normalize(inboundText);
  const m = INJECTION_RE.exec(norm);
  return m ? { safe: false, matched: `injection:${m[0]}` } : { safe: true };
}
