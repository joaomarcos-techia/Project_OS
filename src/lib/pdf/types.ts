/**
 * Input types do engine de PDF (C7). Definidos AQUI (não importados de
 * `@/contexts/clinical`) porque `src/lib` não pode importar `src/contexts`
 * (boundaries). As Server Actions do clinical mapeiam suas rows para estes tipos.
 *
 * Render é PURO: recebe data + branding + doctor (snapshots), devolve Buffer.
 * Sem DB, sem upload, sem efeito colateral (§7.7).
 */

export interface PdfBranding {
  nome: string;
  logoUrl: string | null;
  primaryColor: string | null;
  endereco: string | null;
  telefone: string | null;
  cnpj: string | null;
  cnes: string | null;
}

export interface PdfDoctor {
  nome: string;
  /** Obrigatório nos documentos (a action garante via assertDoctorHasCrm). */
  crm: string;
  crmUf: string | null;
  especialidade: string | null;
}

export interface PdfMedicamento {
  nome: string;
  dosagem?: string | undefined;
  posologia?: string | undefined;
  quantidade?: string | undefined;
  via?: string | undefined;
}

export interface PrescriptionPdfData {
  patientNome: string;
  medicamentos: PdfMedicamento[];
  observacoes?: string | null;
  /** ISO 8601 — formatado em dd/mm/aaaa no render. */
  issuedAt: string;
  /** Fuso da clínica: a data impressa é o dia local da emissão. */
  timeZone: string;
}

/**
 * Receituário de Controle Especial (branco, 2 vias). Diferente de
 * PrescriptionPdfData: a identificação LEGAL do emitente vem de SNAPSHOT
 * congelado na emissão (G1 — validade documental imutável), não do branding atual.
 * Endereço do paciente também é snapshot (decifrado server-side no ato da emissão).
 */
export interface ReceituarioControleEspecialPdfData {
  patientNome: string;
  patientEndereco: string | null;
  /** Snapshot do emitente no ato da emissão (R8). */
  emitenteNome: string;
  emitenteEndereco: string | null;
  emitenteTelefone: string | null;
  medicamentos: PdfMedicamento[];
  observacoes?: string | null;
  /** ISO 8601 — formatado em dd/mm/aaaa no render. */
  issuedAt: string;
  /** Fuso da clínica: a data impressa é o dia local da emissão. */
  timeZone: string;
}

export interface AtestadoPdfData {
  patientNome: string;
  descricao: string;
  cid?: string | null;
  dias?: number | null;
  issuedAt: string;
  /** Fuso da clínica: a data impressa é o dia local da emissão. */
  timeZone: string;
}

export interface DeclaracaoPdfData {
  patientNome: string;
  texto: string;
  periodo?: string | null;
  issuedAt: string;
  /** Fuso da clínica: a data impressa é o dia local da emissão. */
  timeZone: string;
}

export interface ExamePdfData {
  patientNome: string;
  exames: string[];
  indicacaoClinica?: string | null;
  issuedAt: string;
  /** Fuso da clínica: a data impressa é o dia local da emissão. */
  timeZone: string;
}

export interface EncaminhamentoPdfData {
  patientNome: string;
  especialidade: string;
  motivo: string;
  issuedAt: string;
  /** Fuso da clínica: a data impressa é o dia local da emissão. */
  timeZone: string;
}
