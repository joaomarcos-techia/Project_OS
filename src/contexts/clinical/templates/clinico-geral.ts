import type { ClinicalTemplate } from '../types';

/** Template SOAP — Clínico Geral (estrutura base, consulta ambulatorial). */
export const clinicoGeralTemplate: ClinicalTemplate = {
  id: 'clinico-geral',
  nome: 'Clínico Geral',
  especialidade: 'Clínica Médica',
  fields: [
    {
      key: 'queixa_principal',
      label: 'Queixa principal (S)',
      placeholder: 'Motivo da consulta, em palavras do paciente.',
    },
    {
      key: 'historia_doenca_atual',
      label: 'História da doença atual (S)',
      placeholder: 'Início, evolução, fatores de melhora/piora, sintomas associados.',
    },
    {
      key: 'exame_fisico',
      label: 'Exame físico (O)',
      placeholder: 'Sinais vitais, estado geral, achados por sistema.',
    },
    {
      key: 'hipotese_diagnostica',
      label: 'Hipótese diagnóstica (A)',
      placeholder: 'Hipótese(s) diagnóstica(s) / CID.',
    },
    {
      key: 'conduta',
      label: 'Conduta (P)',
      placeholder: 'Prescrições, exames solicitados, orientações, retorno.',
    },
    { key: 'observacoes', label: 'Observações', placeholder: 'Anotações complementares.' },
  ],
};
