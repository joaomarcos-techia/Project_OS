/**
 * O-7 — conteúdo da central de documentação.
 *
 * `/documentação` é a documentação DO PRODUTO. Não confundir com `/documentos`,
 * que são os documentos CLÍNICOS do paciente — nomes parecidos, naturezas
 * opostas: um é texto igual para todo mundo, o outro é PII.
 *
 * Todo o conteúdo é estático e idêntico para qualquer clínica: nenhuma linha
 * aqui lê banco, e nenhum tópico aceita parâmetro. É isso que torna a tela
 * tenant-safe por construção, e não por policy — não existe dado de tenant a
 * vazar quando não existe leitura de tenant.
 *
 * O conjunto de slugs é FECHADO: `/documentação/[topic]` resolve contra esta
 * lista e devolve 404 para qualquer outra coisa, em vez de tentar montar uma
 * página a partir do que veio na URL.
 */

export interface DocSection {
  heading: string;
  paragraphs: string[];
  bullets?: string[];
  steps?: string[];
}

export interface DocTopic {
  slug: string;
  title: string;
  summary: string;
  category: 'Comece por aqui' | 'Atendimento' | 'WhatsApp e IA' | 'Financeiro' | 'Sua clínica';
  sections: DocSection[];
}

export const DOC_TOPICS: readonly DocTopic[] = [
  {
    slug: 'primeiros-passos',
    title: 'Primeiros passos',
    summary: 'Prepare a clínica e faça o primeiro atendimento.',
    category: 'Comece por aqui',
    sections: [
      {
        heading: 'Prepare a clínica',
        paragraphs: [
          'O painel inicial mostra o que falta configurar. Os itens são concluídos quando as informações são salvas; você não precisa marcar cada tarefa manualmente.',
        ],
        steps: [
          'Abra Equipe & Permissões e confira quem vai atender. Se você também é médico, complete seu CRM no perfil.',
          'Em Configurações › Horários, informe os períodos de atendimento dos médicos.',
          'Em Configurações › Procedimentos, cadastre os atendimentos oferecidos, a duração e o valor.',
          'Cadastre um paciente em Pacientes e crie um horário na Agenda.',
        ],
      },
      {
        heading: 'Conecte os serviços quando for usar',
        paragraphs: [
          'Para conversar com pacientes pelo sistema, conecte o número em Configurações › WhatsApp. Para receber sinal ou pagamentos online, conecte a conta Asaas da própria clínica em Configurações › Pagamentos.',
          'Se você usa apenas agenda e recepção, pode começar por essas telas. As mensagens e os links de cobrança dependem das conexões e permissões correspondentes.',
        ],
      },
      {
        heading: 'Onde procurar ajuda',
        paragraphs: [
          'Use a busca desta central ou escolha um assunto. Algumas ações dependem do seu plano e da sua função. Se uma opção não aparecer, peça ao responsável pela clínica para conferir seu acesso.',
        ],
      },
    ],
  },
  {
    slug: 'cadastro-e-acesso',
    title: 'Cadastro, confirmação de e-mail e acesso',
    summary: 'Crie sua conta, confirme o código e continue de onde parou.',
    category: 'Comece por aqui',
    sections: [
      {
        heading: 'Criar a conta',
        paragraphs: [],
        steps: [
          'No cadastro, responda às perguntas da clínica e preencha os dados solicitados.',
          'Defina sua senha e confira o endereço de e-mail antes de continuar.',
          'Abra a mensagem enviada pela Qoro. Volte ao cadastro e cole o código de oito dígitos. Ele vale por 10 minutos.',
          'Confirme o e-mail, escolha seu plano e use Continuar para o checkout.',
          'Conclua as etapas no Asaas e aguarde a confirmação para seguir à clínica.',
        ],
      },
      {
        heading: 'O código não chegou ou expirou',
        paragraphs: [
          'Confira a caixa de spam e se o e-mail informado está correto. Na tela de confirmação, use Reenviar código quando o botão estiver disponível. Use o código da mensagem mais recente.',
          'Você define a senha uma vez. Se retornar ao cadastro, siga a continuação apresentada; não crie outra conta para tentar corrigir um código expirado.',
        ],
      },
      {
        heading: 'Esqueci a senha ou fui convidado',
        paragraphs: [
          'Use Esqueci minha senha na tela de entrada para redefinir sua senha. Nunca envie sua senha nem o código de confirmação para outra pessoa.',
          'Se recebeu um convite para entrar em uma clínica existente, abra esse convite. O convite para participar da equipe é diferente do cadastro de uma nova clínica.',
        ],
      },
    ],
  },
  {
    slug: 'planos-e-acessos',
    title: 'Planos, médicos e acessos da equipe',
    summary: 'Entenda quem ocupa cada vaga e quando contratar um médico adicional.',
    category: 'Comece por aqui',
    sections: [
      {
        heading: 'Consultório e Clínica',
        paragraphs: [
          'Na oferta atual, o Consultório inclui 1 médico e até 3 pessoas da equipe administrativa: até 4 logins.',
          'A Clínica inclui 2 médicos e até 3 pessoas da equipe administrativa: até 5 logins. Na Clínica, você pode contratar médicos adicionais até chegar a 5 médicos e 3 administrativos, totalizando até 8 logins.',
        ],
      },
      {
        heading: 'Médico não é o mesmo que acesso administrativo',
        paragraphs: [
          'O acesso cadastrado com a função Médico ocupa uma vaga de médico. O dono ou gestor que também atende e tem CRM preenchido ocupa uma vaga de médico, sem ser contado novamente como administrativo.',
          'Recepção e Financeiro usam as vagas administrativas. O dono ou gestor sem CRM também ocupa uma dessas vagas. Um atendente não passa a ser médico apenas por ter um CRM escrito no cadastro.',
          'O atendente já está incluído nos 3 acessos administrativos. Hoje não há compra online de um quarto acesso administrativo.',
        ],
      },
      {
        heading: 'Recursos exclusivos da Clínica',
        paragraphs: [
          'Na nova oferta, o ajuste de permissões por pessoa, o relatório por médico e as regras de repasse aos médicos por procedimento são recursos da Clínica.',
          'Ter o recurso no plano não significa que todo membro da equipe pode acessá-lo. O responsável também precisa conceder a permissão adequada.',
        ],
      },
      {
        heading: 'Valores e contratos existentes',
        paragraphs: [
          'Consulte Configurações › Assinatura para ver o valor, as vagas e as opções disponíveis na sua conta. Na oferta mensal atual, a Clínica começa em R$ 397 e cada médico adicional custa R$ 147 por mês.',
          'Contratos anteriores podem ter condições diferentes. Uma nova oferta não substitui automaticamente o preço ou os direitos já contratados.',
        ],
      },
    ],
  },
  {
    slug: 'fluxos-por-papel',
    title: 'Equipe e permissões',
    summary: 'Convide pessoas e escolha o que cada uma pode acessar.',
    category: 'Sua clínica',
    sections: [
      {
        heading: 'Adicionar alguém à equipe',
        paragraphs: [],
        steps: [
          'Abra Equipe & Permissões.',
          'Confira se há vaga de médico ou de equipe disponível.',
          'Escolha a opção de convidar, preencha o e-mail e selecione a função.',
          'Peça à pessoa para abrir o convite e concluir o acesso.',
        ],
      },
      {
        heading: 'Escolher a função certa',
        paragraphs: [
          'A função define um conjunto inicial de acessos. As opções que você pode atribuir dependem do seu próprio acesso.',
        ],
        bullets: [
          'Dono: responsável pela clínica e pela administração da conta.',
          'Gestor: cuida da operação conforme as permissões recebidas.',
          'Médico: atende e utiliza os recursos clínicos autorizados.',
          'Recepção: trabalha com recepção, agenda e outras ações permitidas.',
          'Financeiro: acompanha recebimentos, despesas e relatórios autorizados.',
        ],
      },
      {
        heading: 'Ajustar ou retirar acesso',
        paragraphs: [
          'Na Clínica, o responsável pode ajustar as permissões por pessoa. Confira tanto o plano quanto a função antes de tentar liberar uma tela.',
          'Para afastamentos ou saída de alguém, desative o acesso pela equipe. Não compartilhe um único login entre várias pessoas: cada pessoa deve usar sua própria conta.',
        ],
      },
    ],
  },
  {
    slug: 'pacientes',
    title: 'Cadastro e histórico de pacientes',
    summary: 'Cadastre, encontre e mantenha as informações do paciente atualizadas.',
    category: 'Atendimento',
    sections: [
      {
        heading: 'Cadastrar ou localizar um paciente',
        paragraphs: [],
        steps: [
          'Abra Pacientes e pesquise antes de criar um novo cadastro.',
          'Se o paciente já existir, abra seu registro e confira as informações.',
          'Para um novo paciente, preencha os campos solicitados e salve.',
          'Confira especialmente o telefone e o e-mail, pois eles são usados nos contatos da clínica.',
        ],
      },
      {
        heading: 'Telefone e permissões para mensagens',
        paragraphs: [
          'Ter o telefone cadastrado não significa que o paciente autorizou mensagens. Registre separadamente a autorização para mensagens de agendamento e para cobranças.',
          'Use um número válido com DDD e confirme com o paciente se ele recebe WhatsApp nesse número. Uma autorização não garante entrega: a conexão da clínica e as regras do WhatsApp também precisam permitir o envio.',
        ],
      },
      {
        heading: 'Histórico e documentos',
        paragraphs: [
          'O cadastro reúne as informações disponíveis do paciente. Registros clínicos e dados financeiros só aparecem para quem possui o acesso correspondente.',
          'Antes de alterar um registro ou tratar uma duplicidade, confira a pessoa correta. Não crie outro cadastro apenas porque não encontrou um agendamento.',
        ],
      },
    ],
  },
  {
    slug: 'procedimentos-e-horarios',
    title: 'Procedimentos, horários e salas',
    summary: 'Prepare os atendimentos que podem aparecer na agenda.',
    category: 'Sua clínica',
    sections: [
      {
        heading: 'Cadastrar um procedimento',
        paragraphs: [],
        steps: [
          'Abra Configurações › Procedimentos.',
          'Informe o nome do atendimento, a duração e o valor.',
          'Confira se o procedimento está ativo.',
          'Ao alterar preço ou duração, revise os novos agendamentos antes de confirmá-los.',
        ],
      },
      {
        heading: 'Definir a disponibilidade',
        paragraphs: [
          'Em Configurações › Horários, configure os dias e períodos de cada médico. Confira também ausências e feriados.',
          'Se o atendimento exige sala ou outro recurso, confira sua configuração em Configurações › Recursos. A disponibilidade precisa considerar tanto o médico quanto o recurso utilizado.',
        ],
      },
      {
        heading: 'Um horário não aparece',
        paragraphs: [
          'Confira se o médico está ativo, se há disponibilidade naquele dia e se o período comporta a duração do procedimento. Verifique ausências, feriados e horários já ocupados antes de tentar novamente.',
        ],
      },
    ],
  },
  {
    slug: 'agenda',
    title: 'Agendar, remarcar e cancelar',
    summary: 'Organize os horários e acompanhe a chegada dos pacientes.',
    category: 'Atendimento',
    sections: [
      {
        heading: 'Criar um agendamento',
        paragraphs: [],
        steps: [
          'Abra Agenda e escolha a data.',
          'Selecione o paciente, o médico, o procedimento e um horário disponível.',
          'Confira data, horário, duração e valor.',
          'Salve e confira o agendamento na agenda. Se houver sinal obrigatório, acompanhe também a situação do pagamento.',
        ],
      },
      {
        heading: 'Confirmar e receber o paciente',
        paragraphs: [
          'Use os estados da agenda para indicar a confirmação e a chegada do paciente. Quando ele estiver pronto para ser atendido, a equipe médica continua pelo Consultório.',
          'Uma mensagem enviada ao paciente não substitui a conferência do agendamento salvo. Antes de prometer um horário, confirme que ele aparece na agenda.',
        ],
      },
      {
        heading: 'Remarcar, cancelar ou registrar falta',
        paragraphs: [
          'Abra o agendamento e escolha a ação apropriada. Na remarcação, confira o novo horário antes de salvar. Use falta quando o paciente não comparecer e cancelamento quando a consulta for cancelada.',
          'Cancelar a consulta não significa que um pagamento já recebido foi devolvido. Confira o financeiro e combine qualquer devolução com o paciente.',
        ],
      },
    ],
  },
  {
    slug: 'consultorio',
    title: 'Do início ao fim da consulta',
    summary: 'Receba o paciente, registre o atendimento e conclua a consulta.',
    category: 'Atendimento',
    sections: [
      {
        heading: 'Atender pelo Consultório',
        paragraphs: [],
        steps: [
          'Confirme a chegada do paciente na agenda ou na recepção.',
          'Abra Consultório e escolha o paciente da fila.',
          'Inicie o atendimento e registre as informações clínicas nas áreas disponíveis.',
          'Revise os registros e documentos antes de concluir.',
          'Conclua o atendimento para que a situação da consulta e o financeiro possam ser atualizados.',
        ],
      },
      {
        heading: 'Salvar não é concluir',
        paragraphs: [
          'Salvar um registro mantém o trabalho, mas não equivale a finalizar a consulta. Confira o estado do atendimento antes de sair.',
          'Se houve pagamento antecipado, ele fica como crédito até sua aplicação ao atendimento. Depois da conclusão, confira o valor recebido e o saldo, sem registrar o mesmo pagamento novamente.',
        ],
      },
      {
        heading: 'Se precisar interromper',
        paragraphs: [
          'Use a ação disponível para interromper ou encerrar a etapa atual. Não abra outra consulta para o mesmo atendimento apenas para contornar um erro. Se a tela não permitir a ação esperada, peça ao responsável para verificar o estado do agendamento.',
        ],
      },
    ],
  },
  {
    slug: 'prontuario-e-documentos',
    title: 'Prontuário, receitas e documentos',
    summary: 'Registre informações clínicas e encontre os documentos do paciente.',
    category: 'Atendimento',
    sections: [
      {
        heading: 'Prontuário do paciente',
        paragraphs: [
          'Abra o paciente ou o atendimento no Consultório para acessar as informações clínicas permitidas ao seu perfil. Confira sempre a identificação do paciente antes de registrar algo.',
          'Revise antes de assinar ou finalizar um registro. Um documento assinado possui regras de alteração diferentes de um rascunho.',
        ],
      },
      {
        heading: 'Emitir um documento',
        paragraphs: [],
        steps: [
          'Abra Documentos ou a área de documentos do paciente.',
          'Escolha o paciente e o tipo de documento.',
          'Preencha e revise o conteúdo, os dados do paciente e de quem assina.',
          'Use a opção de salvar, emitir ou gerar o arquivo disponível para aquele documento.',
        ],
      },
      {
        heading: 'CRM e acesso',
        paragraphs: [
          'Mantenha o CRM e os dados profissionais de quem assina atualizados. A emissão de prescrições exige os dados e as permissões correspondentes.',
          'Documentos clínicos não são os guias desta central. Para consultar receitas e atestados de pacientes, use Documentos no menu da Qoro.',
        ],
      },
      {
        heading: 'Não confundir com documento fiscal',
        paragraphs: [
          'Uma receita, um atestado e um comprovante de pagamento têm finalidades diferentes. A Qoro não emite Nota Fiscal nesta etapa.',
        ],
      },
    ],
  },
  {
    slug: 'whatsapp',
    title: 'Conectar o WhatsApp da clínica',
    summary: 'Conecte um número e confira o que precisa estar pronto para enviar mensagens.',
    category: 'WhatsApp e IA',
    sections: [
      {
        heading: 'Conectar o número',
        paragraphs: [],
        steps: [
          'Abra Configurações › WhatsApp.',
          'Escolha a conexão oferecida para seu tipo de número.',
          'Conclua a autorização nas telas da Meta e selecione a empresa e o número corretos.',
          'Volte à Qoro e confira o estado da conexão.',
          'Confira no painel da Meta as pendências de verificação, pagamento ou liberação que forem indicadas.',
        ],
      },
      {
        heading: 'Número novo e WhatsApp Business no celular',
        paragraphs: [
          'A opção de conectar o WhatsApp Business permite usar o aplicativo do celular junto da Qoro quando a Meta autoriza esse tipo de conexão. O fluxo para um número dedicado pode ser diferente.',
          'Se a conexão apresentar uma restrição da Meta, siga o aviso da tela. Estar conectado à Qoro não elimina exigências de verificação ou faturamento da Meta.',
        ],
      },
      {
        heading: 'Antes de começar a atender',
        paragraphs: [
          'Confira também Configurações › Agente de IA e as permissões dos pacientes para receber mensagens. Use um número de teste consentido antes de orientar a equipe a depender do canal.',
          'O WhatsApp pode cobrar por determinados envios. Os custos e a disponibilidade dependem das regras da Meta; eles não são uma taxa de repasse ao médico.',
        ],
      },
    ],
  },
  {
    slug: 'ia',
    title: 'Agente de IA e atendimento humano',
    summary: 'Prepare as respostas da clínica e saiba quando assumir uma conversa.',
    category: 'WhatsApp e IA',
    sections: [
      {
        heading: 'Configurar o que a IA pode informar',
        paragraphs: [
          'Em Configurações › Agente de IA, confira as informações da clínica, os procedimentos, os convênios informados e as orientações de atendimento disponíveis. Informe as condições reais de atendimento online, infantil e de retorno.',
          'A IA usa o que está configurado e a disponibilidade da agenda. Uma informação não cadastrada pode exigir confirmação da equipe.',
        ],
      },
      {
        heading: 'Acompanhar e assumir uma conversa',
        paragraphs: [],
        steps: [
          'Abra Conversas IA e localize a conversa.',
          'Confira o histórico e o motivo da transferência.',
          'Assuma o atendimento quando a equipe precisar responder.',
          'Depois de resolver a questão, use a ação de devolver ao agente para retomar o atendimento automático.',
        ],
      },
      {
        heading: 'Por que pode haver transferência',
        paragraphs: [
          'O paciente pode pedir uma pessoa. Também pode haver dúvida que depende da equipe, falta de informação ou uma falha no atendimento automático. Transferir não significa, por si só, que o agendamento falhou.',
          'A IA não substitui o médico, não fornece diagnóstico e não deve orientar tratamento. Confira na Agenda e no Financeiro se uma ação realmente foi concluída.',
        ],
      },
      {
        heading: 'Respostas pelo celular e avisos de uso',
        paragraphs: [
          'Na conexão com WhatsApp Business, uma resposta pelo celular pode colocar a conversa em atendimento humano para evitar respostas simultâneas. Confira a conversa e devolva ao agente quando for apropriado.',
          'A referência de uso da nova oferta é de 500 conversas por médico. Os avisos de consumo não significam cobrança automática de excedente nem interrupção automática por essa referência.',
        ],
      },
    ],
  },
  {
    slug: 'lembretes-e-consentimentos',
    title: 'Mensagens, lembretes e autorizações',
    summary: 'Saiba quando o paciente pode receber mensagens da clínica.',
    category: 'WhatsApp e IA',
    sections: [
      {
        heading: 'Registre as autorizações',
        paragraphs: [
          'No cadastro do paciente, confira separadamente a autorização para mensagens de agendamento e para cobrança. Cadastre apenas autorizações realmente fornecidas.',
          'Mesmo que você tenha digitado o número manualmente, a mensagem depende dessa autorização e de uma conexão válida. Não é correto prometer envio só porque o telefone foi salvo.',
        ],
      },
      {
        heading: 'Envio e entrega são etapas diferentes',
        paragraphs: [
          'Uma mensagem pode estar aguardando envio, ter sido aceita pelo WhatsApp ou já ter confirmação de entrega. Confira o estado mostrado na conversa ou na cobrança.',
          'Fora da janela de conversa permitida pelo WhatsApp, podem ser necessários modelos de mensagem aprovados. Envios automáticos também respeitam horários e regras configurados; uma mensagem pode ficar aguardando a próxima janela.',
        ],
      },
      {
        heading: 'Se o paciente não recebeu',
        paragraphs: [
          'Confira número e DDD, autorização, conexão e estado do envio. Se houver uma restrição da Meta, resolva a pendência indicada em Configurações › WhatsApp. Não repita envios sem conferir o histórico.',
        ],
      },
    ],
  },
  {
    slug: 'sinal-e-cobrancas',
    title: 'Sinal e cobrança de consultas',
    summary: 'Configure o sinal, acompanhe o pagamento e evite cobrar duas vezes.',
    category: 'Financeiro',
    sections: [
      {
        heading: 'Preparar o recebimento',
        paragraphs: [
          'Em Configurações › Pagamentos, conecte a conta Asaas da própria clínica. Use uma chave da conta e do ambiente corretos. A conta da assinatura Qoro é uma finalidade diferente da conta que recebe dos pacientes.',
          'Na política de sinal, confira quais atendimentos exigem pagamento antecipado, o percentual e as condições disponíveis antes de ativar. Primeira consulta e retorno seguem as regras configuradas; retorno considera atendimento anterior concluído.',
        ],
      },
      {
        heading: 'Do agendamento ao pagamento',
        paragraphs: [
          'Quando a política se aplica, acompanhe o sinal associado ao agendamento. O paciente paga no Checkout Asaas pelo meio disponível naquele link.',
          'A criação do link não comprova que o paciente pagou. Aguarde a confirmação indicada na Qoro. Fechar o navegador ou voltar do Asaas também não substitui essa confirmação.',
        ],
      },
      {
        heading: 'Sinal ou pagamento total antecipado',
        paragraphs: [
          'Se o paciente pagar antes da consulta, o valor fica como crédito antecipado. Após a conclusão e o faturamento do atendimento, esse crédito é usado para abater o valor devido.',
          'Se o crédito cobrir o valor total, confira a quitação. Se cobrir apenas uma parte, confira o saldo restante. Não lance novamente como recebido um valor que já foi confirmado.',
        ],
      },
      {
        heading: 'Cancelamento e devolução',
        paragraphs: [
          'Cancelar um agendamento não faz uma devolução automática. A clínica deve combinar a devolução com o paciente e realizá-la pelo meio apropriado.',
          'Uma solicitação de estorno ou uma aprovação inicial ainda pode não ser a conclusão da devolução. Confira o estado final no Asaas e na Qoro antes de informar que o dinheiro voltou.',
        ],
      },
    ],
  },
  {
    slug: 'financeiro',
    title: 'Financeiro, caixa e taxas',
    summary: 'Entenda recebimentos, despesas, saldo e crédito antecipado.',
    category: 'Financeiro',
    sections: [
      {
        heading: 'O que cada tela mostra',
        paragraphs: [
          'O Caixa ajuda na operação diária de entradas e saídas. O Financeiro reúne recebíveis, contas, pagamentos e pendências de faturamento.',
          'Use os filtros de período e situação para localizar um lançamento. O que aparece depende da sua permissão.',
        ],
      },
      {
        heading: 'Conferir um atendimento',
        paragraphs: [],
        steps: [
          'Conclua o atendimento corretamente no Consultório.',
          'Abra Financeiro ou Caixa e localize a consulta ou o paciente.',
          'Confira o valor, os pagamentos aplicados e eventuais créditos antecipados.',
          'Se houver uma pendência de faturamento ou saldo, siga a ação indicada pela tela.',
          'Registre uma baixa manual somente quando o recebimento aconteceu e ainda não foi registrado.',
        ],
      },
      {
        heading: 'Valor bruto, taxa e líquido',
        paragraphs: [
          'Bruto é o valor cobrado do paciente. A taxa é o custo do meio de recebimento. Líquido é o que resta depois das taxas consideradas.',
          'Estimativas ajudam a planejar, mas não substituem a taxa efetivamente informada pelo Asaas. Condições da conta, modalidade e parcelamento podem mudar o resultado. O preço não aumenta automaticamente por o paciente escolher Pix ou cartão.',
        ],
      },
      {
        heading: 'Não confundir saldo com faturamento',
        paragraphs: [
          'Um crédito antecipado pode existir antes de a consulta ser concluída. Um valor cobrado também pode continuar em aberto. Confira a situação do lançamento antes de somar recebimentos ou informar que uma consulta está quitada.',
        ],
      },
    ],
  },
  {
    slug: 'repasses',
    title: 'Repasses aos médicos',
    summary:
      'Configure as regras e confira o resumo mensal, sem confundir cálculo com transferência.',
    category: 'Financeiro',
    sections: [
      {
        heading: 'Disponibilidade',
        paragraphs: [
          'Na nova oferta, as regras de repasse e o relatório por médico são recursos da Clínica. A pessoa também precisa da permissão correspondente. Contratos anteriores preservam as condições aplicáveis.',
        ],
      },
      {
        heading: 'Como calcular',
        paragraphs: [
          'A regra pode considerar o valor bruto ou o líquido e a condição definida para o médico e procedimento. Base bruta usa o valor antes das taxas; base líquida considera as taxas previstas pela regra.',
          'Exemplo: uma consulta de R$ 150 com repasse de 50% sobre o bruto resulta em R$ 75 antes de qualquer ajuste posterior. Os mesmos 50% sobre o líquido podem resultar em um valor diferente. Confira a regra salva antes de usar o cálculo.',
        ],
      },
      {
        heading: 'Conferir o mês',
        paragraphs: [],
        steps: [
          'Abra Relatórios e acesse o relatório de repasses.',
          'Escolha o mês. A competência considera o mês em que a consulta foi concluída.',
          'Confira consultas, valores, situação dos pagamentos e eventuais revisões.',
          'Compare o resumo com os detalhes antes de realizar um pagamento ao médico.',
        ],
      },
      {
        heading: 'Estorno e revisão',
        paragraphs: [
          'Um estorno pode suspender o repasse para revisão. O responsável deve avaliar a situação e registrar a decisão e o motivo quando solicitado. Não é aplicada uma proporção automática sem revisão.',
          'O relatório mostra repasses calculados ou revisados. Ele não comprova uma transferência bancária e a Qoro não faz automaticamente o pagamento ao médico.',
        ],
      },
    ],
  },
  {
    slug: 'relatorios',
    title: 'Dashboard e relatórios',
    summary: 'Leia os indicadores com o período e a permissão corretos.',
    category: 'Sua clínica',
    sections: [
      {
        heading: 'Acompanhar a clínica',
        paragraphs: [
          'O Dashboard reúne os indicadores disponíveis para o seu perfil. Escolha o período antes de comparar valores e confira se está olhando consultas agendadas, atendidas ou valores recebidos.',
          'Um total de agendamentos não significa a mesma coisa que faturamento ou dinheiro recebido. Para entender uma diferença, abra os registros que compõem o indicador.',
        ],
      },
      {
        heading: 'Relatórios por médico',
        paragraphs: [
          'Na nova oferta, o relatório por médico está disponível na Clínica. A permissão define se a pessoa pode ver apenas sua atuação ou uma visão mais ampla.',
          'Para repasses, escolha a competência do mês e consulte os detalhes. Um resumo de repasse não é comprovante de pagamento ao médico.',
        ],
      },
      {
        heading: 'Exportações e documentos fiscais',
        paragraphs: [
          'Quando houver uma opção de exportar, confira os filtros antes de baixar o arquivo e guarde os dados em local autorizado pela clínica.',
          'Um relatório, um arquivo para a contabilidade ou um comprovante não é uma Nota Fiscal. A emissão de NF ainda não está disponível na Qoro.',
        ],
      },
    ],
  },
  {
    slug: 'asaas',
    title: 'Assinatura, mudança de plano e cancelamento',
    summary: 'Gerencie o plano da Qoro sem confundir com a cobrança dos pacientes.',
    category: 'Sua clínica',
    sections: [
      {
        heading: 'Teste e primeira cobrança',
        paragraphs: [
          'Na nova oferta, o teste dura 14 dias desde a criação da sua conta. Reenviar o código de e-mail ou retomar o cadastro não reinicia o prazo.',
          'O Checkout pode cadastrar a assinatura e um vencimento futuro durante o teste. Isso não significa que uma cobrança já foi paga. Se o teste já terminou antes de concluir o Checkout, o acesso pode depender da confirmação do pagamento.',
        ],
      },
      {
        heading: 'Consultar ou mudar o plano',
        paragraphs: [],
        steps: [
          'Abra Configurações › Assinatura com um perfil autorizado.',
          'Confira o plano, o valor, o ciclo e as vagas disponíveis.',
          'Selecione a mudança e leia a confirmação antes de continuar.',
          'Em uma mudança com cobrança, aguarde a confirmação para utilizar as novas vagas.',
        ],
      },
      {
        heading: 'Adicionar ou reduzir médicos',
        paragraphs: [
          'Na Clínica, a inclusão de médico adicional pode gerar a diferença proporcional do período e atualizar a mensalidade. A vaga só deve ser utilizada depois da confirmação.',
          'A redução de plano ou de vagas é programada para o fim do ciclo e depende de a equipe caber no plano escolhido. A Qoro não remove pessoas automaticamente para fazer o limite caber.',
        ],
      },
      {
        heading: 'Cancelar a renovação',
        paragraphs: [
          'Use a opção de cancelamento na assinatura e confira a confirmação e a data indicada. O período já contratado segue as condições mostradas na conta. Cancelar não significa estorno automático.',
          'A oferta atual prioriza contratação mensal. Quem possui contrato anual anterior mantém as condições aplicáveis; as modalidades disponíveis são as apresentadas na sua assinatura.',
        ],
      },
    ],
  },
  {
    slug: 'seguranca',
    title: 'Conta, segurança e privacidade',
    summary: 'Proteja seu acesso e compartilhe dados somente com as pessoas certas.',
    category: 'Sua clínica',
    sections: [
      {
        heading: 'Proteger o login',
        paragraphs: [],
        steps: [
          'Use uma senha própria, sem compartilhá-la com a equipe.',
          'Abra Segurança da conta para conferir e configurar o segundo fator disponível.',
          'Ao terminar em um computador compartilhado, use Sair.',
          'Se esquecer a senha, use a recuperação na tela de entrada.',
        ],
      },
      {
        heading: 'Dar acesso só ao necessário',
        paragraphs: [
          'Cada pessoa deve ter seu próprio login e a função adequada. Revise a equipe quando alguém trocar de atividade ou sair da clínica.',
          'Evite enviar prints com dados de pacientes, senhas ou códigos em conversas de suporte. Informe a tela, o horário aproximado e a mensagem de erro, sem incluir informações clínicas.',
        ],
      },
      {
        heading: 'Pedidos sobre dados pessoais',
        paragraphs: [
          'O responsável pela clínica deve usar os recursos de privacidade disponíveis e verificar o pedido recebido. A exclusão de um cadastro e a guarda de registros clínicos podem seguir regras diferentes.',
          'Não trate um download ou um pedido iniciado como conclusão de todas as etapas. Confira o estado apresentado e, quando necessário, procure orientação do responsável pela clínica.',
        ],
      },
    ],
  },
  {
    slug: 'troubleshooting',
    title: 'Quando algo não funciona',
    summary: 'Confira o básico antes de repetir uma ação ou pedir suporte.',
    category: 'Comece por aqui',
    sections: [
      {
        heading: 'Não aparece um horário para agendar',
        paragraphs: [
          'Confira médico ativo, procedimento, duração, horários de atendimento, ausências, feriados e ocupações. Verifique também a sala ou recurso exigido. Se o horário não estiver disponível, escolha outro ou peça ao responsável para revisar a configuração.',
        ],
      },
      {
        heading: 'A IA encaminhou para uma pessoa',
        paragraphs: [
          'Abra Conversas IA e confira o motivo e as mensagens anteriores. O paciente pode ter pedido atendimento humano ou a resposta pode depender de uma informação ainda não cadastrada. Confira a agenda antes de concluir que não houve agendamento.',
        ],
      },
      {
        heading: 'O pagamento não apareceu',
        paragraphs: [
          'Confira se o link e a conta Asaas são da clínica correta e se o pagamento foi concluído. Aguarde a confirmação da Qoro. Se continuar pendente, informe ao suporte o horário e o identificador da cobrança, sem dados de cartão nem chaves de acesso.',
          'Não crie outra cobrança nem dê baixa manual só para tirar uma pendência da tela. Isso pode fazer a equipe cobrar ou registrar o valor duas vezes.',
        ],
      },
      {
        heading: 'Uma opção não aparece ou está bloqueada',
        paragraphs: [
          'Confira o plano e a permissão com o responsável pela clínica. Algumas funções são exclusivas da Clínica e outras exigem acesso clínico ou financeiro. Se a sessão expirou, entre novamente.',
        ],
      },
      {
        heading: 'Preciso de ajuda',
        paragraphs: [
          'Anote a tela, o que tentou fazer, o horário aproximado e a mensagem exibida. Se enviar um print, esconda dados pessoais e clínicos. Não envie senha, código de confirmação ou chave de integração.',
        ],
      },
    ],
  },
];

export function findDocTopic(slug: string): DocTopic | undefined {
  return DOC_TOPICS.find((topic) => topic.slug === slug);
}
