import type { ClinicalTemplate } from '../types';

/** Template SOAP — Pediatria (puericultura / consulta pediátrica). */
export const pediatriaTemplate: ClinicalTemplate = {
  id: 'pediatria',
  nome: 'Pediatria',
  especialidade: 'Pediatria',
  fields: [
    {
      key: 'queixa_principal',
      label: 'Queixa principal (S)',
      placeholder: 'Relato do acompanhante / criança.',
    },
    {
      key: 'historia_doenca_atual',
      label: 'História da doença atual (S)',
      placeholder: 'Sintomas, febre, alimentação, sono, eliminações; vacinação em dia?',
    },
    {
      key: 'exame_fisico',
      label: 'Exame físico (O)',
      placeholder: 'Peso, altura, PC, percentis; estado geral; ausculta; abdome; otoscopia/orofaringe.',
    },
    {
      key: 'hipotese_diagnostica',
      label: 'Hipótese diagnóstica (A)',
      placeholder: 'Hipótese(s) / CID. Desenvolvimento neuropsicomotor adequado para a idade?',
    },
    {
      key: 'conduta',
      label: 'Conduta (P)',
      placeholder: 'Prescrição (dose por peso), orientações aos pais, sinais de alarme, retorno.',
    },
    { key: 'observacoes', label: 'Observações', placeholder: 'Aleitamento, marcos do desenvolvimento.' },
  ],
};
