/**
 * Catálogo de retenção documental (B6) — fonte única das categorias, dos fundamentos e do que pode acontecer
 * depois do prazo. Pesquisa documental de 25/11/2026 (`docs/convenios/QORO-TISS-CONFORMIDADE-REGULATORIA.md`,
 * seção 7). NÃO é parecer jurídico.
 *
 * Regras que este módulo garante (e os testes travam):
 *  1. Nenhuma categoria com fundamento incerto (`interpretacao` ou `pendente`) tem descarte automático.
 *  2. Descarte de qualquer categoria de documento de paciente ou de cobrança exige decisão humana registrada
 *     (termo de eliminação ou de anonimização, como pede o parecer CFM nº 19/2026 para o prontuário).
 *  3. A simulação de vencimento só CLASSIFICA; não apaga, não anonimiza e não marca nada no banco.
 *  4. A única categoria com purga automática é o registro de acesso (`login_attempts`), cujo piso é expresso
 *     em lei (Marco Civil, art. 15; ANS, requisito 84) e cuja purga depois do piso é minimização (LGPD, art. 6º, III).
 */

export type Certeza = 'expressa' | 'interpretacao' | 'pendente';
export type Destino =
  /** Manter; nada acontece sem decisão humana (inclui "eliminar ou devolver ao paciente" do prontuário). */
  | 'revisao_humana'
  /** Anonimizar o conteúdo pessoal do documento, com termo humano; o documento financeiro fica. */
  | 'anonimizar_com_termo'
  /** Purga automática depois do piso legal (só registro de acesso). */
  | 'purga_automatica';
export type Controlador = 'clinica' | 'qoro';

export interface Fundamento {
  norma: string;
  dispositivo: string;
  url: string;
}

export interface Prazo {
  /** Mínimo antes do qual nada pode ser eliminado. */
  anos?: number;
  dias?: number;
  /** `exercicio_seguinte`: conta do 1º de janeiro do ano seguinte ao marco (regra do CTN, art. 173, I). */
  contagem: 'do_marco' | 'exercicio_seguinte';
}

export interface CategoriaRetencao {
  id: CategoriaId;
  nome: string;
  natureza: string;
  finalidade: string;
  controlador: Controlador;
  /** Hipóteses da LGPD que sustentam a guarda (dado sensível: art. 11). */
  baseLegal: readonly string[];
  /** Prazo mínimo; `null` quando não há prazo que se possa afirmar. */
  minimo: Prazo | null;
  marcoInicial: string;
  fundamentos: readonly Fundamento[];
  certeza: Certeza;
  /** Dúvida material que impede certeza (vazio só quando `expressa`). */
  pendencia: string | null;
  destino: Destino;
  /** Onde o dado vive (tabelas e armazenamento). */
  onde: readonly string[];
  backup: string;
  acesso: string;
  auditoria: string;
}

export type CategoriaId =
  | 'prontuario'
  | 'registro_atendimento'
  | 'guia_tiss'
  | 'autorizacao'
  | 'demonstrativo'
  | 'recurso_glosa'
  | 'documento_fiscal'
  | 'recebivel'
  | 'comprovante_pagamento'
  | 'xml_tiss'
  | 'pdf_tiss'
  | 'log_auditoria'
  | 'registro_acesso'
  | 'backup'
  | 'cadastro_paciente'
  | 'carteirinha';

const LGPD = 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm';
const L13787 = 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13787.htm';
const CFM_1821 = 'https://sistemas.cfm.org.br/normas/arquivos/resolucoes/BR/2007/1821_2007.pdf';
const CFM_P19 = 'https://portal.cfm.org.br/wp-content/uploads/2026/06/19_2026.pdf';
const CFP_01 = 'https://www.crpsp.org/uploads/legislacao/1514/x2FGTbFDQCxbeCfLswwYF9gL224qLaq_.pdf';
const CTN = 'https://www.planalto.gov.br/ccivil_03/leis/l5172compilado.htm';
const CC = 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm';
const CDC = 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm';
const MCI = 'https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm';
const RN501 = 'https://bvsms.saude.gov.br/bvs/saudelegis/ans/2022/res0501_01_04_2022.html';
const TISS_SEG =
  'https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-setembro-2026';

const COBRANCA_FUND: readonly Fundamento[] = [
  {
    norma: 'Código Civil (Lei 10.406/2002)',
    dispositivo: 'art. 206, §5º, I (5 anos: cobrança de dívida líquida em instrumento particular)',
    url: CC,
  },
  {
    norma: 'Código Civil',
    dispositivo:
      'art. 1.194 (conservar escrituração e papéis enquanto não ocorrer prescrição ou decadência)',
    url: CC,
  },
  {
    norma: 'CTN (Lei 5.172/1966)',
    dispositivo:
      'art. 173, I e art. 195, parágrafo único (comprovantes até a prescrição do crédito tributário)',
    url: CTN,
  },
  {
    norma: 'CDC (Lei 8.078/1990)',
    dispositivo: 'art. 27 (5 anos para reparação por fato do serviço)',
    url: CDC,
  },
  {
    norma: 'RN ANS 501/2022',
    dispositivo: 'art. 20 (dados TISS ao beneficiário, sem ônus, quando solicitados)',
    url: RN501,
  },
];
const COBRANCA_PENDENCIA =
  'Não há prazo expresso para documentos TISS; o mínimo vem da prescrição civil e tributária. O contrato com cada operadora pode exigir prazo maior (cláusula a conferir na B5).';

export const RETENTION_CATALOG: readonly CategoriaRetencao[] = [
  {
    id: 'prontuario',
    nome: 'Prontuário do paciente (registro clínico)',
    natureza: 'documento clínico, sigiloso, de caráter legal',
    finalidade: 'continuidade da assistência, prova do atendimento, direito do paciente',
    controlador: 'clinica',
    baseLegal: ['LGPD art. 11, II, a (obrigação legal)', 'LGPD art. 11, II, f (tutela da saúde)'],
    minimo: { anos: 20, contagem: 'do_marco' },
    marcoInicial: 'último registro no prontuário',
    fundamentos: [
      {
        norma: 'Lei 13.787/2018',
        dispositivo:
          'art. 6º (20 anos do último registro; §2º devolução ao paciente; §4º registro da eliminação; §5º vale para o eletrônico)',
        url: L13787,
      },
      {
        norma: 'Resolução CFM 1.821/2007',
        dispositivo: 'art. 7º (guarda permanente do eletrônico) e art. 8º (20 anos do papel)',
        url: CFM_1821,
      },
      {
        norma: 'Parecer CFM 19/2026 (20/05/2026)',
        dispositivo: 'eliminação após 20 anos, com termo formal guardado permanentemente',
        url: CFM_P19,
      },
      {
        norma: 'Resolução CFP 01/2009',
        dispositivo: 'art. 4º, §1º (mínimo de 5 anos para o registro documental do psicólogo)',
        url: CFP_01,
      },
    ],
    certeza: 'expressa',
    pendencia:
      'O mínimo de 20 anos é expresso (lei). A resolução CFM 1.821 fala em guarda permanente do eletrônico; a lei permite eliminar depois de 20 anos. Na dúvida, o Qoro não elimina: só a clínica, com termo.',
    destino: 'revisao_humana',
    onde: [
      'prontuarios (conteúdo cifrado por clínica)',
      'anexos clínicos no armazenamento privado',
    ],
    backup:
      'segue o prontuário; a eliminação, quando decidida, entra no registro de eliminações para reaplicar depois de restauração',
    acesso: 'profissional de saúde da clínica, leitura auditada com finalidade',
    auditoria: 'leitura e alteração em audit_events',
  },
  {
    id: 'registro_atendimento',
    nome: 'Registro do atendimento (agenda, presença, procedimento)',
    natureza: 'registro administrativo que prova a assistência',
    finalidade: 'agenda, faturamento, prova do atendimento',
    controlador: 'clinica',
    baseLegal: [
      'LGPD art. 11, II, a',
      'LGPD art. 11, II, d (exercício regular de direitos, inclusive em contrato)',
    ],
    minimo: { anos: 20, contagem: 'do_marco' },
    marcoInicial: 'data do atendimento',
    fundamentos: [
      {
        norma: 'Lei 13.787/2018',
        dispositivo:
          'art. 6º, aplicado por cautela quando o registro integra a documentação da assistência',
        url: L13787,
      },
    ],
    certeza: 'interpretacao',
    pendencia:
      'Se o registro de agenda integra o prontuário (20 anos) ou é só administrativo (5 anos, CDC art. 27). Por cautela, segue o prontuário.',
    destino: 'revisao_humana',
    onde: ['appointments', 'appointment_events'],
    backup: 'idem prontuário',
    acesso: 'equipe da clínica conforme papel',
    auditoria: 'audit_events',
  },
  ...(
    [
      [
        'guia_tiss',
        'Guia TISS (Consulta e SP/SADT), itens, snapshot e histórico',
        'hi_guides, hi_guide_items, hi_guide_snapshots (cifrado), hi_account_events',
      ],
      ['autorizacao', 'Autorização da operadora (senha, número)', 'hi_authorizations e anexos'],
      [
        'demonstrativo',
        'Demonstrativo de análise e de pagamento da operadora',
        'hi_batch_returns, hi_files (batch_return)',
      ],
      [
        'recurso_glosa',
        'Recurso de glosa e resposta',
        'hi_gloss_appeals, hi_gloss_appeal_items, hi_files (gloss_appeal_xml)',
      ],
    ] as const
  ).map(
    ([id, nome, onde]): CategoriaRetencao => ({
      id,
      nome,
      natureza: 'documento de cobrança à operadora, com dado de saúde',
      finalidade: 'cobrança, conferência, recurso, prova perante a operadora e o beneficiário',
      controlador: 'clinica',
      baseLegal: [
        'LGPD art. 11, II, a',
        'LGPD art. 11, II, d',
        'LGPD art. 16, I (conservação por obrigação legal)',
      ],
      minimo: { anos: 5, contagem: 'exercicio_seguinte' },
      marcoInicial:
        'último evento financeiro da guia (pagamento, glosa definitiva ou resposta do recurso)',
      fundamentos: COBRANCA_FUND,
      certeza: 'interpretacao',
      pendencia: COBRANCA_PENDENCIA,
      destino: 'anonimizar_com_termo',
      onde: [onde],
      backup:
        'expira pela rotação do provedor; anonimização decidida entra no registro para reaplicar depois de restauração',
      acesso: 'faturamento da clínica; leitura do conteúdo só pela via auditada com finalidade',
      auditoria: 'hi_account_events e audit_events (leitura com finalidade)',
    }),
  ),
  {
    id: 'documento_fiscal',
    nome: 'Documento fiscal (NFS-e da clínica)',
    natureza: 'documento fiscal; o Qoro não emite nem guarda NFS-e hoje',
    finalidade: 'obrigação tributária da clínica',
    controlador: 'clinica',
    baseLegal: ['LGPD art. 7º, II e art. 11, II, a'],
    minimo: { anos: 5, contagem: 'exercicio_seguinte' },
    marcoInicial: 'fato gerador (emissão)',
    fundamentos: [
      { norma: 'CTN', dispositivo: 'arts. 173, I, 174 e 195, parágrafo único', url: CTN },
    ],
    certeza: 'expressa',
    pendencia: null,
    destino: 'revisao_humana',
    onde: ['fora do Qoro (sistema da prefeitura ou do contador)'],
    backup: 'não se aplica',
    acesso: 'não se aplica',
    auditoria: 'não se aplica',
  },
  ...(
    [
      [
        'recebivel',
        'Recebível e lançamento financeiro',
        'lancamentos (descrição pode ter o nome do paciente)',
      ],
      [
        'comprovante_pagamento',
        'Movimento de caixa e comprovante de pagamento',
        'payment_transactions, hi_payments, hi_payment_allocations, comprovantes anexados',
      ],
    ] as const
  ).map(
    ([id, nome, onde]): CategoriaRetencao => ({
      id,
      nome,
      natureza: 'registro contábil e comprovante de lançamento',
      finalidade: 'escrituração da clínica, conciliação, prova de pagamento',
      controlador: 'clinica',
      baseLegal: ['LGPD art. 7º, II (obrigação legal)', 'LGPD art. 16, I'],
      minimo: { anos: 5, contagem: 'exercicio_seguinte' },
      marcoInicial: 'lançamento (pagamento ou baixa)',
      fundamentos: [
        {
          norma: 'CTN',
          dispositivo: 'art. 195, parágrafo único (comprovantes dos lançamentos até a prescrição)',
          url: CTN,
        },
        { norma: 'Código Civil', dispositivo: 'art. 1.194', url: CC },
      ],
      certeza: 'expressa',
      pendencia:
        'A regra (guardar até a prescrição) é expressa; a contagem exata por tributo é do contador da clínica.',
      destino: 'anonimizar_com_termo',
      onde: [onde],
      backup: 'expira pela rotação do provedor',
      acesso: 'financeiro da clínica',
      auditoria: 'audit_events e diário da ponte (hi_ledger_entries)',
    }),
  ),
  {
    id: 'xml_tiss',
    nome: 'XML TISS enviado (lote, solicitação, recurso)',
    natureza: 'cópia fiel do que foi enviado à operadora (prova do envio)',
    finalidade: 'prova do envio e da integridade (SHA-256)',
    controlador: 'clinica',
    baseLegal: ['LGPD art. 11, II, a', 'LGPD art. 11, II, d'],
    minimo: { anos: 5, contagem: 'exercicio_seguinte' },
    marcoInicial: 'último evento financeiro das guias do arquivo',
    fundamentos: COBRANCA_FUND,
    certeza: 'interpretacao',
    pendencia: COBRANCA_PENDENCIA,
    destino: 'revisao_humana',
    onde: ['hi_files + bucket privado tiss-files (cifrado por clínica)'],
    backup:
      'armazenamento de objetos do provedor; a eliminação tem de alcançar os bytes, não só a linha',
    acesso: 'só o servidor; download auditado com finalidade e SHA-256 conferido',
    auditoria: 'audit_events (tiss-file-access)',
  },
  {
    id: 'pdf_tiss',
    nome: 'PDF da guia e via do atendimento',
    natureza: 'representação impressa do documento emitido',
    finalidade: 'conferência e assinatura do beneficiário; plano de contingência',
    controlador: 'clinica',
    baseLegal: ['LGPD art. 11, II, a', 'LGPD art. 11, II, d'],
    minimo: { anos: 5, contagem: 'exercicio_seguinte' },
    marcoInicial: 'último evento financeiro da guia',
    fundamentos: COBRANCA_FUND,
    certeza: 'interpretacao',
    pendencia: COBRANCA_PENDENCIA,
    destino: 'revisao_humana',
    onde: ['gerado em memória a partir do snapshot; quando guardado, hi_files (guide_pdf)'],
    backup: 'idem XML',
    acesso: 'download auditado, Cache-Control no-store',
    auditoria: 'audit_events (guide_pdf)',
  },
  {
    id: 'log_auditoria',
    nome: 'Trilha de auditoria (acessos e operações)',
    natureza: 'evidência de quem acessou ou alterou o quê, quando e para quê',
    finalidade: 'responsabilização, auditoria da ANS e do titular, segurança',
    controlador: 'qoro',
    baseLegal: [
      'LGPD art. 37 (registro das operações)',
      'LGPD art. 46 (segurança)',
      'LGPD art. 7º, II',
    ],
    minimo: { dias: 180, contagem: 'do_marco' },
    marcoInicial: 'data do evento',
    fundamentos: [
      {
        norma: 'Padrão TISS — Segurança e Privacidade 202511',
        dispositivo:
          'requisito 85 (180 dias, sem alterar nem remover; "não desconsidera" os prazos do prontuário)',
        url: TISS_SEG,
      },
      {
        norma: 'Padrão TISS — Segurança e Privacidade 202511',
        dispositivo: 'requisito 58 (integridade e proteção contra acesso não autorizado)',
        url: TISS_SEG,
      },
    ],
    certeza: 'interpretacao',
    pendencia:
      'O mínimo de 180 dias é expresso; o requisito 85 manda respeitar os prazos do prontuário para os metadados, o que pode estender a trilha ligada ao prontuário. Hoje nada é purgado.',
    destino: 'revisao_humana',
    onde: ['audit_events (particionada por mês, sem purga)', 'hi_account_events'],
    backup: 'segue o banco',
    acesso: 'super admin e gestão da clínica, leitura sem edição',
    auditoria: 'a própria trilha',
  },
  {
    id: 'registro_acesso',
    nome: 'Registro de acesso (tentativas de login com data, hora e IP)',
    natureza: 'registro de acesso a aplicação (Marco Civil, art. 5º, VIII), com e-mail em HMAC',
    finalidade: 'obrigação legal, limite de tentativas, forense',
    controlador: 'qoro',
    baseLegal: ['LGPD art. 7º, II (obrigação legal: Marco Civil, art. 15)'],
    minimo: { dias: 186, contagem: 'do_marco' },
    marcoInicial: 'data da tentativa',
    fundamentos: [
      {
        norma: 'Marco Civil da Internet (Lei 12.965/2014)',
        dispositivo: 'art. 15 (6 meses, sob sigilo, em ambiente controlado e de segurança)',
        url: MCI,
      },
      {
        norma: 'Padrão TISS — Segurança e Privacidade 202511',
        dispositivo: 'requisito 84 (no mínimo 180 dias)',
        url: TISS_SEG,
      },
    ],
    certeza: 'expressa',
    pendencia: null,
    destino: 'purga_automatica',
    onde: ['login_attempts'],
    backup: 'segue o banco',
    acesso: 'super admin (RLS); escrita só pela função SECURITY DEFINER',
    auditoria: 'não se aplica (é o próprio registro)',
  },
  {
    id: 'backup',
    nome: 'Cópia de segurança do banco e do armazenamento',
    natureza: 'cópia técnica de tudo o que existia na data',
    finalidade: 'continuidade e recuperação',
    controlador: 'qoro',
    baseLegal: ['LGPD art. 46 (segurança)', 'LGPD art. 6º, VII'],
    minimo: null,
    marcoInicial: 'data da cópia',
    fundamentos: [{ norma: 'LGPD', dispositivo: 'arts. 6º, VII, 15, 16 e 46', url: LGPD }],
    certeza: 'interpretacao',
    pendencia:
      'Não há regra expressa sobre eliminação em backup. Medida: o backup expira pela rotação do provedor e toda eliminação ou anonimização decidida é reaplicada depois de uma restauração (registro de eliminações).',
    destino: 'revisao_humana',
    onde: ['provedor do banco (Supabase) e do armazenamento'],
    backup: 'rotação do provedor',
    acesso: 'operação da plataforma, só para restauração',
    auditoria: 'registro de restauração no runbook',
  },
  {
    id: 'cadastro_paciente',
    nome: 'Cadastro do paciente',
    natureza: 'dado pessoal (e sensível, no contexto de saúde)',
    finalidade: 'identificação para assistência e cobrança',
    controlador: 'clinica',
    baseLegal: ['LGPD art. 11, II, f', 'LGPD art. 11, II, a', 'LGPD art. 16, I'],
    minimo: null,
    marcoInicial: 'fim da relação ou pedido do titular',
    fundamentos: [
      {
        norma: 'LGPD',
        dispositivo:
          'art. 16 (conservação autorizada), art. 18, IV e VI (anonimização e eliminação), §2º (oposição)',
        url: LGPD,
      },
    ],
    certeza: 'expressa',
    pendencia:
      'Sem documento retido: excluído. Com prontuário ou guia retidos: anonimizado (o cadastro some; o documento fica).',
    destino: 'anonimizar_com_termo',
    onde: ['patients, contatos, endereços, consentimentos'],
    backup: 'rotação do provedor; registro do pedido em lgpd_requests e lgpd_request_history',
    acesso: 'equipe da clínica conforme papel',
    auditoria: 'lgpd_requests, lgpd_request_history, audit_events',
  },
  {
    id: 'carteirinha',
    nome: 'Carteirinha do beneficiário',
    natureza: 'identificador do beneficiário na operadora (cifrado por clínica)',
    finalidade: 'emitir e conferir guias',
    controlador: 'clinica',
    baseLegal: ['LGPD art. 11, II, d', 'LGPD art. 16, I (quando ligada a guia retida)'],
    minimo: { anos: 5, contagem: 'exercicio_seguinte' },
    marcoInicial: 'último evento financeiro da última guia que a usa',
    fundamentos: COBRANCA_FUND,
    certeza: 'interpretacao',
    pendencia:
      'Ligada a guia: segue a guia. Sem guia e com o paciente anonimizado, não resta finalidade (LGPD art. 6º, III): eliminar é a leitura sustentada, aguardando o OK do fundador.',
    destino: 'anonimizar_com_termo',
    onde: ['hi_memberships (número cifrado, hash e 4 últimos dígitos)'],
    backup: 'rotação do provedor',
    acesso: 'leitura do número só pela via auditada com finalidade',
    auditoria: 'audit_events (membership-access)',
  },
];

/** Data a partir da qual a categoria PODE ir à revisão humana. `null` = sem prazo afirmável. */
export function eligibleForReviewOn(categoria: CategoriaRetencao, marco: Date): Date | null {
  const p = categoria.minimo;
  if (!p) return null;
  const base =
    p.contagem === 'exercicio_seguinte'
      ? new Date(Date.UTC(marco.getUTCFullYear() + 1, 0, 1))
      : new Date(marco.getTime());
  const out = new Date(base.getTime());
  if (p.anos) out.setUTCFullYear(out.getUTCFullYear() + p.anos);
  if (p.dias) out.setUTCDate(out.getUTCDate() + p.dias);
  return out;
}

export type SimulationStatus =
  /** Ainda dentro do mínimo: guarda obrigatória. */
  | 'dentro_do_prazo'
  /** Passou do mínimo: vai para a revisão humana (termo), nunca para descarte direto. */
  | 'revisao_humana'
  /** Sem prazo afirmável: fica, com a pendência registrada. */
  | 'sem_prazo_definido';

export interface SimulationItem {
  ref: string;
  categoria: CategoriaId;
  marco: Date;
}

export interface SimulationResult {
  ref: string;
  categoria: CategoriaId;
  status: SimulationStatus;
  elegivelEm: string | null;
  /** Sempre `false`: a simulação nunca autoriza descarte. */
  descarteAutorizado: false;
  motivo: string;
}

export function categoriaOf(id: CategoriaId): CategoriaRetencao {
  const c = RETENTION_CATALOG.find((x) => x.id === id);
  if (!c) throw new Error(`categoria de retenção desconhecida: ${id}`);
  return c;
}

/** Simula o vencimento: só classifica. Não apaga, não anonimiza, não escreve. */
export function simulateRetention(items: readonly SimulationItem[], now: Date): SimulationResult[] {
  return items.map((it) => {
    const c = categoriaOf(it.categoria);
    const em = eligibleForReviewOn(c, it.marco);
    if (!em) {
      return {
        ref: it.ref,
        categoria: it.categoria,
        status: 'sem_prazo_definido',
        elegivelEm: null,
        descarteAutorizado: false,
        motivo: c.pendencia ?? 'sem prazo',
      };
    }
    if (now < em) {
      return {
        ref: it.ref,
        categoria: it.categoria,
        status: 'dentro_do_prazo',
        elegivelEm: em.toISOString(),
        descarteAutorizado: false,
        motivo: `mínimo até ${em.toISOString().slice(0, 10)}`,
      };
    }
    return {
      ref: it.ref,
      categoria: it.categoria,
      status: 'revisao_humana',
      elegivelEm: em.toISOString(),
      descarteAutorizado: false,
      motivo:
        c.certeza === 'expressa'
          ? 'mínimo cumprido; decisão humana com termo'
          : `mínimo cumprido, mas com pendência: ${c.pendencia}`,
    };
  });
}

export class RetentionDisposalBlocked extends Error {
  constructor(readonly reason: string) {
    super(`descarte bloqueado: ${reason}`);
    this.name = 'RetentionDisposalBlocked';
  }
}

/**
 * Trava de descarte. Qualquer rotina futura de eliminação ou anonimização de documento passa por aqui ANTES de
 * tocar no dado. Hoje nenhuma rotina de documento chama isto para apagar: a trava existe para que a primeira
 * que existir não possa ser escrita sem prazo cumprido, fundamento expresso e termo humano.
 */
export function assertDisposalAllowed(input: {
  categoria: CategoriaId;
  marco: Date;
  now: Date;
  termo: { aprovadoPor: string; referencia: string } | null;
}): void {
  const c = categoriaOf(input.categoria);
  if (c.destino === 'purga_automatica') return;
  if (c.certeza !== 'expressa')
    throw new RetentionDisposalBlocked(`fundamento não confirmado (${c.certeza}): ${c.pendencia}`);
  const em = eligibleForReviewOn(c, input.marco);
  if (!em) throw new RetentionDisposalBlocked('sem prazo mínimo afirmável');
  if (input.now < em)
    throw new RetentionDisposalBlocked(
      `dentro do prazo mínimo (até ${em.toISOString().slice(0, 10)})`,
    );
  if (!input.termo || !input.termo.aprovadoPor.trim() || !input.termo.referencia.trim())
    throw new RetentionDisposalBlocked('falta o termo de eliminação aprovado por uma pessoa');
}
