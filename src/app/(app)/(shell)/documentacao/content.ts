/**
 * O-7 — conteúdo da central de documentação.
 *
 * `/documentacao` é a documentação DO PRODUTO. Não confundir com `/documentos`,
 * que são os documentos CLÍNICOS do paciente — nomes parecidos, naturezas
 * opostas: um é texto igual para todo mundo, o outro é PII.
 *
 * Todo o conteúdo é estático e idêntico para qualquer clínica: nenhuma linha
 * aqui lê banco, e nenhum tópico aceita parâmetro. É isso que torna a tela
 * tenant-safe por construção, e não por policy — não existe dado de tenant a
 * vazar quando não existe leitura de tenant.
 *
 * O conjunto de slugs é FECHADO: `/documentacao/[topic]` resolve contra esta
 * lista e devolve 404 para qualquer outra coisa, em vez de tentar montar uma
 * página a partir do que veio na URL.
 */

export interface DocSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface DocTopic {
  slug: string;
  title: string;
  summary: string;
  sections: DocSection[];
}

export interface DocGroup {
  label: string;
  slugs: readonly string[];
}

export const DOC_GROUPS: readonly DocGroup[] = [
  {
    label: 'Comece aqui',
    slugs: ['primeiros-passos', 'fluxos-por-papel'],
  },
  {
    label: 'Operação clínica',
    slugs: ['prontuario-e-documentos', 'financeiro'],
  },
  {
    label: 'Integrações',
    slugs: ['asaas', 'whatsapp', 'ia'],
  },
  {
    label: 'Conta e suporte',
    slugs: ['seguranca', 'troubleshooting'],
  },
] as const;

export const DOC_TOPICS: readonly DocTopic[] = [
  {
    slug: 'primeiros-passos',
    title: 'Primeiros passos',
    summary: 'O caminho mais curto entre criar a clínica e atender a primeira pessoa.',
    sections: [
      {
        heading: 'A ordem que funciona',
        paragraphs: [
          'A agenda só consegue marcar um horário quando existem três coisas: alguém para atender, uma janela de atendimento e um procedimento. O checklist de ativação do painel segue exatamente essa ordem, e ele some sozinho quando os passos terminam — não é preciso marcar nada à mão.',
        ],
        bullets: [
          'Cadastre quem atende em Equipe & Permissões.',
          'Defina os horários de atendimento em Configurações › Horários.',
          'Cadastre ao menos um procedimento ativo em Configurações › Procedimentos.',
          'Cadastre o primeiro paciente e marque o primeiro horário.',
        ],
      },
      {
        heading: 'Por que o checklist não tem botão de concluir',
        paragraphs: [
          'Cada item é verificado no banco, não marcado por você. "Cadastre um médico" fica concluído quando existe um médico — nem antes, nem depois. Isso evita a situação mais comum de onboarding: a lista toda verde e a agenda ainda sem conseguir marcar nada.',
        ],
      },
    ],
  },
  {
    slug: 'fluxos-por-papel',
    title: 'Fluxos por papel',
    summary: 'O que cada função vê e pode fazer, e por que as telas mudam de pessoa para pessoa.',
    sections: [
      {
        heading: 'O produto é um só',
        paragraphs: [
          'Não existe painel por especialidade nem versão diferente do sistema por função. O que muda é a permissão: a mesma tela mostra menos, ou deixa de aparecer no menu, quando a pessoa não tem o direito correspondente. Se um bloco sumiu, é permissão — não é outra versão do produto.',
        ],
      },
      {
        heading: 'As funções',
        paragraphs: [
          'Papéis são atribuídos em Equipe & Permissões e valem imediatamente na próxima navegação da pessoa.',
        ],
        bullets: [
          'Owner — acesso completo, inclusive assinatura e permissões.',
          'Gestor — opera a clínica inteira, sem mexer na assinatura.',
          'Médico — agenda, consultório, prontuário e prescrição.',
          'Atendente — recepção, agenda e caixa; sem prontuário.',
          'Financeiro — caixa, lançamentos e relatórios; sem dado clínico.',
        ],
      },
    ],
  },
  {
    slug: 'prontuario-e-documentos',
    title: 'Prontuário e documentos',
    summary: 'Onde fica o registro clínico, quem assina e o que sai impresso.',
    sections: [
      {
        heading: 'O atendimento acontece no Consultório',
        paragraphs: [
          'A fila de espera, a evolução e o prontuário vivem na mesma tela para que o atendimento não exija trocar de contexto. O registro nasce junto do agendamento e fica preso a ele.',
        ],
      },
      {
        heading: 'Documentos clínicos ficam em /documentos',
        paragraphs: [
          'Atestados, receituários e demais documentos do paciente ficam em Documentos, no grupo Clínico. É um lugar diferente desta central: aqui é a documentação do sistema, lá é o documento da pessoa.',
          'Emitir prescrição exige CRM cadastrado no perfil de quem assina. Sem CRM, o sistema recusa a emissão em vez de gerar um documento sem validade.',
        ],
      },
    ],
  },
  {
    slug: 'financeiro',
    title: 'Financeiro e caixa',
    summary: 'Como um atendimento vira dinheiro registrado.',
    sections: [
      {
        heading: 'Do atendimento ao lançamento',
        paragraphs: [
          'Quando um atendimento é concluído, ele passa a aparecer como pendente de faturamento. O painel avisa quantos atendimentos do dia ainda não foram faturados, e o Caixa é onde a baixa acontece.',
        ],
      },
      {
        heading: 'Caixa e Financeiro são coisas diferentes',
        paragraphs: [
          'O Caixa é a operação do dia: receber, dar baixa, registrar saída. O Financeiro é a visão acumulada: o que está a receber, o que vence, o histórico. Quem só opera a recepção costuma precisar do Caixa e não do Financeiro.',
        ],
      },
    ],
  },
  {
    slug: 'asaas',
    title: 'Assinatura e cobrança (Asaas)',
    summary: 'Como a assinatura da clínica é cobrada e o que acontece quando algo falha.',
    sections: [
      {
        heading: 'A assinatura da clínica',
        paragraphs: [
          'A cobrança recorrente do plano é feita pelo Asaas. O meio de pagamento é informado na página do próprio Asaas — nenhum dado de cartão passa pelo Qoro nem fica guardado aqui.',
          'O período de teste começa na criação da clínica. A primeira cobrança vence ao fim dele, não no dia do cadastro.',
        ],
      },
      {
        heading: 'Quando a confirmação demora',
        paragraphs: [
          'Se a resposta do provedor se perder no meio do caminho, o sistema NÃO tenta criar uma segunda assinatura. Ele marca a tentativa como indeterminada e reconcilia depois pela referência externa. É a razão de uma cobrança nunca sair em dobro por causa de um clique repetido ou de uma conexão que caiu.',
        ],
      },
    ],
  },
  {
    slug: 'whatsapp',
    title: 'WhatsApp e Meta',
    summary: 'Conectar o número da clínica e o que o paciente recebe.',
    sections: [
      {
        heading: 'Conectar o número',
        paragraphs: [
          'A conexão é feita em Configurações › WhatsApp. Enquanto o número não estiver conectado, os lembretes não saem e o agente de IA não atende — o sistema não simula envio.',
        ],
      },
      {
        heading: 'O que é enviado hoje',
        paragraphs: [
          'Lembretes de consulta e confirmações. O sistema lembra o paciente do horário; ele não cobra multa por falta.',
        ],
      },
    ],
  },
  {
    slug: 'ia',
    title: 'Agente de IA',
    summary: 'O que o agente responde sozinho e quando ele chama uma pessoa.',
    sections: [
      {
        heading: 'Atendimento e transferência',
        paragraphs: [
          'O agente responde dúvidas e ajuda a marcar horários. Quando a conversa sai do que ele resolve — ou quando o paciente pede uma pessoa —, ele transfere. A fila de transferências aparece em Conversas IA e o painel avisa quando alguém está esperando.',
        ],
      },
      {
        heading: 'Limites',
        paragraphs: [
          'O agente não dá diagnóstico, não orienta tratamento e não confirma procedimento clínico. Fora do horário ele informa que a clínica está fechada em vez de inventar disponibilidade.',
        ],
      },
    ],
  },
  {
    slug: 'seguranca',
    title: 'Segurança e acesso',
    summary: 'Sessão, segundo fator e isolamento entre clínicas.',
    sections: [
      {
        heading: 'Sessão e segundo fator',
        paragraphs: [
          'A sessão expira por inatividade e por tempo absoluto. Revogar o acesso de alguém em Equipe & Permissões vale na navegação seguinte, sem esperar a sessão vencer.',
          'O segundo fator é configurado em Conta › Segurança e é obrigatório para as ações mais sensíveis.',
        ],
      },
      {
        heading: 'Isolamento entre clínicas',
        paragraphs: [
          'Todo dado é escopado à clínica no próprio banco, não apenas na tela. Uma requisição fora do escopo não devolve dado parcial: ela não devolve nada.',
        ],
      },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Quando algo não funciona',
    summary: 'Os problemas mais comuns e o que costuma resolvê-los.',
    sections: [
      {
        heading: 'Não consigo marcar um horário',
        paragraphs: [
          'Quase sempre falta uma das três pré-condições: profissional cadastrado, janela de disponibilidade definida ou procedimento ativo. O checklist de ativação do painel mostra qual delas está aberta.',
        ],
      },
      {
        heading: 'Uma tela sumiu do menu',
        paragraphs: [
          'O menu esconde o que a permissão não alcança. Confira a função da pessoa em Equipe & Permissões; alterações valem na navegação seguinte.',
        ],
      },
      {
        heading: 'A tela pediu login de novo',
        paragraphs: [
          'A sessão venceu, foi revogada ou o acesso foi desativado. Entrar novamente resolve os dois primeiros casos; o terceiro precisa de alguém com permissão para reativar o acesso.',
        ],
      },
    ],
  },
] as const;

export function findDocTopic(slug: string): DocTopic | undefined {
  return DOC_TOPICS.find((topic) => topic.slug === slug);
}
