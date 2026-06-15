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
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
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
