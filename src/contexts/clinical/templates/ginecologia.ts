import type { ClinicalTemplate } from '../types';

/** Template SOAP — Ginecologia (consulta ginecológica / pré-natal básico). */
export const ginecologiaTemplate: ClinicalTemplate = {
  id: 'ginecologia',
  nome: 'Ginecologia',
  especialidade: 'Ginecologia e Obstetrícia',
  fields: [
    {
      key: 'queixa_principal',
      label: 'Queixa principal (S)',
      placeholder: 'Motivo da consulta.',
    },
    {
      key: 'historia_doenca_atual',
      label: 'História / antecedentes (S)',
      placeholder: 'DUM, ciclo, G/P/A, método contraceptivo, último preventivo, sintomas.',
    },
    {
      key: 'exame_fisico',
      label: 'Exame físico (O)',
      placeholder: 'Exame das mamas, exame especular, toque bimanual; achados.',
    },
    {
      key: 'hipotese_diagnostica',
      label: 'Hipótese diagnóstica (A)',
      placeholder: 'Hipótese(s) / CID.',
    },
    {
      key: 'conduta',
      label: 'Conduta (P)',
      placeholder: 'Exames (preventivo, USG), prescrição, orientações, retorno.',
    },
    { key: 'observacoes', label: 'Observações', placeholder: 'Rastreios, calendário de retorno.' },
  ],
};
