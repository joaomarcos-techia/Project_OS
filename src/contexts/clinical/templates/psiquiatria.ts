import type { ClinicalTemplate } from '../types';

/**
 * Template SOAP — Psiquiatria (consulta ambulatorial).
 *
 * O roteiro reúne a anamnese e o exame do estado mental previstos nas
 * Resoluções CFM nº 2.057/2013 e nº 2.153/2016, além da avaliação de segurança
 * indicada para situações de risco em saúde mental.
 */
export const psiquiatriaTemplate: ClinicalTemplate = {
  id: 'psiquiatria',
  nome: 'Psiquiatria',
  especialidade: 'Psiquiatria',
  fields: [
    {
      key: 'queixa_principal',
      label: 'Queixa principal (S)',
      placeholder: 'Motivo da consulta, nas palavras do paciente, e fonte do relato.',
    },
    {
      key: 'historia_doenca_atual',
      label: 'História clínica e psicossocial (S)',
      placeholder:
        'Início, evolução, sintomas e impacto funcional; antecedentes psiquiátricos, clínicos e familiares; tratamentos e internações; medicamentos, adesão e efeitos; uso de álcool e outras substâncias; sono, apetite, contexto psicossocial e rede de apoio.',
    },
    {
      key: 'exame_fisico',
      label: 'Exame físico, estado mental e risco (O)',
      placeholder:
        'Achados físicos pertinentes; aparência e atitude, consciência e orientação, atenção e memória, psicomotricidade, fala, humor e afeto, pensamento, sensopercepção, cognição, insight e crítica; risco de suicídio, autoagressão ou violência (ideação, plano, intenção, acesso a meios, tentativas anteriores e fatores de risco/proteção).',
    },
    {
      key: 'hipotese_diagnostica',
      label: 'Avaliação diagnóstica (A)',
      placeholder:
        'Hipóteses e diagnósticos diferenciais; CID quando definido; gravidade, comorbidades, funcionalidade e prognóstico quando pertinente.',
    },
    {
      key: 'conduta',
      label: 'Plano terapêutico e de segurança (P)',
      placeholder:
        'Psicofármacos, psicoterapia, exames e encaminhamentos; plano de segurança e manejo de crise quando indicado; orientações, decisão compartilhada, retorno e sinais de alarme.',
    },
    {
      key: 'observacoes',
      label: 'Observações',
      placeholder:
        'Confiabilidade das informações, participação de familiar ou responsável e dados complementares relevantes.',
    },
  ],
};
