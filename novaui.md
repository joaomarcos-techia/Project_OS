# Qoro — inventário da interface de produção e prompt mestre para Claude Design

> Documento de design, não de implementação. Copie a seção **“Prompt mestre”** inteira para o Claude Design.

## 0. Fonte da verdade e limites do levantamento

- Produto observado: `https://app.qoro.dev`.
- Fotografia de produção: commit `93da840f620816e0fdf3300dd82a25f97c01118c` (`origin/main` no momento do levantamento).
- Data do levantamento: 07/09/2026.
- Evidência usada:
  - navegação autenticada e somente leitura nas rotas tenant;
  - inspeção do código exatamente no commit publicado;
  - inventário de rotas, componentes, estados e permissões desse commit.
- As telas `/admin/*` foram conferidas no código publicado, mas a conta tenant usada no E2E recebe `404` nelas, como deve ocorrer para quem não é `super_admin`.
- Nenhum nome, contato, valor ou documento de paciente real deve aparecer no mockup. Use apenas dados sintéticos.
- Este documento **não** descreve o estado posterior da branch de desenvolvimento e **não** autoriza implementar, migrar banco, publicar ou alterar contratos.

### Legenda de evidência

- **LIVE**: rota aberta com autenticação em `app.qoro.dev` e resposta `200`.
- **SOURCE**: comportamento confirmado no código do commit publicado.
- **ROLE**: tela ou ação muda conforme papel/permissão.
- **INTERNAL**: subrota acessada por outro fluxo, sem item próprio na navegação principal.
- **PUBLIC**: tela fora do shell autenticado.

---

# Prompt mestre — nova UI da Qoro

## 1. Papel e missão

Atue como um Principal Product Designer e UX Architect especializado em software clínico operacional, health-tech B2B, prontuário eletrônico, agenda médica, cobrança e SaaS multi-tenant.

Você vai criar um **mockup de alta fidelidade**, não código, para a Qoro: um sistema operacional para clínicas. A interface deve ser limpa, muito clara, bonita, rápida de ler e transmitir a confiança de uma startup séria. Ela não pode parecer um template genérico de dashboard, um ERP antigo nem uma interface hospitalar fria.

O trabalho deve partir do produto que existe hoje em produção. Preserve todas as funções, regras, rotas, permissões e estados descritos neste documento. Você pode reorganizar hierarquia, densidade e composição visual, mas não pode inventar funcionalidades, remover controles necessários ou transformar uma ação bloqueada por permissão em ação disponível.

Pense continuamente nesta pergunta:

> “Um médico com atraso, uma recepcionista com paciente no balcão e um gestor conferindo dinheiro conseguem entender o próximo passo em menos de três segundos?”

## 2. Método obrigatório para evitar um quinto redesign sem direção

Não desenhe todas as telas de uma vez.

### Fase A — direção visual

1. Faça um frame de diagnóstico resumido do produto atual.
2. Apresente a direção recomendada **“Operação clínica serena”**.
3. Mostre apenas duas alternativas secundárias como pequenos mood strips; não redesenhe o produto inteiro três vezes.
4. Compare as direções usando o mesmo conjunto mínimo: sidebar, cabeçalho, botão primário, tabela, status e cartão de paciente.
5. Recomende uma direção com justificativa baseada em legibilidade, velocidade operacional e confiança — não apenas gosto estético.

### Fase B — telas North Star

Antes de expandir o sistema, produza quatro telas desktop de alta fidelidade, com dados sintéticos e estados preenchidos:

1. Dashboard em um dia de operação real.
2. Agenda diária com consultas e diferentes status.
3. Consultório com um paciente em atendimento, alerta clínico e prontuário em edição.
4. Caixa com pendências, pagamento parcial, recebimento e uma cobrança que exige revisão.

Essas quatro telas devem parecer partes do mesmo turno clínico. Só depois aplique o sistema aprovado às demais rotas.

### Fase C — sistema completo

Depois do North Star, desenhe todas as telas e estados do inventário, o design system, os padrões responsivos e os principais protótipos navegáveis.

## 3. Princípios do produto

1. **Operação primeiro:** o que exige ação agora vem antes de análises e configurações.
2. **Paciente no centro:** o nome, o estado e o próximo passo devem ser mais fáceis de localizar que metadados técnicos.
3. **Clareza financeira:** receber, pagar, pendência, parcial, pago, cancelado e estornado nunca podem depender apenas de cor.
4. **Segurança visível sem ruído:** clínica ativa, usuário, papel, permissão e estados somente leitura precisam ser claros.
5. **Progressão natural:** Agenda → Consultório → Prontuário/documentos → Encerramento → Caixa deve parecer um fluxo contínuo.
6. **IA identificável:** automação/IA usa o acento visual próprio, sem dominar telas que não são de IA.
7. **Densidade útil:** mais informação operacional por dobra, sem comprimir controles nem criar parede de texto.
8. **Honestidade:** não mostrar botões falsos, módulos “decorativos” ou promessas sem função.
9. **Multi-tenant:** a clínica ativa permanece inequívoca; o console da plataforma não pode ser confundido com o tenant.
10. **LGPD:** dados sensíveis aparecem somente quando necessários; o mockup usa identidades fictícias.

## 4. Pessoas e prioridades

### Médico

- Quer saber quem está esperando, há quanto tempo, por qual motivo e se há alergias.
- Precisa registrar o atendimento, emitir documentos, assinar e encerrar sem trocar de contexto desnecessariamente.
- Não deve ser distraído por configurações e relatórios durante o atendimento.

### Recepção

- Precisa cadastrar/localizar paciente, criar encaixe, fazer check-in, registrar falta e acompanhar a fila.
- Deve entender rapidamente se uma consulta está agendada, confirmada, aguardando, em atendimento, finalizada ou cancelada.

### Dono/gestor

- Precisa visualizar risco operacional, faturamento, equipe, permissões, integrações e trilha de auditoria.
- Deve distinguir configuração da clínica, configuração pessoal e operação diária.

### Financeiro

- Precisa separar visão gerencial (`Financeiro`) de operação diária (`Caixa`).
- Deve conferir saldo, vencimento, forma de pagamento, parcial, reembolso e comprovante sem ambiguidade.

### Superadmin

- Opera um console separado, cross-tenant, explicitamente rotulado como **Plataforma / Admin**.
- Impersonação, auditoria, configurações operacionais e dados agregados exigem tratamento visual de alto risco.

### Paciente

- Não possui dashboard nesta fotografia do produto.
- É destinatário indireto de WhatsApp, PDFs, convites e comunicações clínicas.

## 5. Arquitetura global observada

### 5.1 Shell tenant autenticado

Sidebar fixa no desktop e drawer no mobile. Elementos existentes:

- wordmark Qoro;
- identificação da clínica ativa;
- quatro grupos de navegação;
- item ativo;
- badge numérico em `Conversas IA` quando há handoff aguardando humano;
- identidade do usuário e papel;
- alternância claro/escuro;
- ação `Sair`;
- frase “Qoro — operação sem vazamento”.

Navegação principal:

| Grupo | Item | Rota |
| --- | --- | --- |
| Operação | Dashboard | `/dashboard` |
| Operação | Agenda | `/agenda` |
| Operação | Consultório | `/consultorio` |
| Clínico | Pacientes | `/pacientes` |
| Clínico | Documentos | `/documentos` |
| Gestão | Financeiro | `/financeiro` |
| Gestão | Caixa | `/caixa` |
| Gestão | Conversas IA | `/conversas` |
| Gestão | Relatórios | `/relatorios` |
| Administração | Equipe & Permissões | `/equipe` |
| Administração | Configurações | `/configuracoes` |

### 5.2 Shell do superadmin

Deve ser visualmente relacionado à Qoro, mas inequivocamente diferente do tenant. Elementos existentes:

- selo `Admin`;
- escopo `Plataforma — Console multi-tenant`;
- navegação própria;
- alternância de tema;
- `Sair`;
- aviso “super_admin — toda ação auditada”.

| Grupo | Item | Rota |
| --- | --- | --- |
| Operação | Visão geral | `/admin` |
| Operação | Clínicas | `/admin/clinicas` |
| Operação | Pagamentos | `/admin/billing` |
| Operação | Feedbacks | `/admin/feedbacks` |
| Inteligência | Conversas IA | `/admin/conversas-ia` |
| Inteligência | Métricas | `/admin/metricas` |
| Plataforma | Auditoria | `/admin/audit` |
| Plataforma | Saúde | `/admin/saude` |
| Plataforma | Configurações | `/admin/config` |

### 5.3 Convenções globais

- Cabeçalho de página: breadcrumb, título, descrição e ações à direita.
- Cards, painéis, tabelas, badges, alerts, drawers, dialogs, toasts e estados vazios.
- Light é o padrão; dark existe e precisa ser desenhado com a mesma qualidade.
- Tipografia publicada: Hanken Grotesk para interface, Inter para display e IBM Plex Mono para números/metadados.
- Identidade publicada: navy como primária, neutros quentes, verde/sucesso, âmbar/atenção, vermelho/perigo e orchid como acento raro de IA.
- Base publicada: sidebar de 256 px, conteúdo máximo próximo de 1080 px, grid de 4 px e raios discretos de 3 a 20 px.

## 6. Inventário completo das telas tenant

### 6.1 Dashboard — `/dashboard` — LIVE, ROLE

Objetivo: dar o pulso da clínica agora.

Informações:

- breadcrumb `Dashboard / Hoje` com data;
- checklist de ativação enquanto incompleto;
- consultas de hoje e total finalizado;
- aguardando na sala de espera;
- em atendimento;
- `A receber` e `Faturado hoje` apenas para quem pode ver financeiro;
- faturamento dos últimos sete dias e link para Financeiro;
- próximos da agenda e link `Ver consultório`;
- ocupação por profissional, hoje marcada como `Em breve`;
- alertas da IA, hoje marcados como `Em breve`;
- atividade recente para gestores/auditoria.

Ações e destinos:

- `Atualizar` → recarrega `/dashboard`;
- checklist → `/equipe`, `/configuracoes/horarios`, `/pacientes/novo`, `/configuracoes/procedimentos`, `/configuracoes/whatsapp`;
- `Financeiro` → `/financeiro`;
- `Ver consultório` → `/consultorio`.

Estado especial a representar: usuário sem clínica selecionada.

Nota de consistência: o código publicado aponta o passo “Cadastre o primeiro paciente” para `/pacientes/novo`, mas essa rota não existe no inventário publicado. Não esconda essa divergência; marque-a como issue de produto a ser corrigida, sem inventar backend no mockup.

### 6.2 Agenda — `/agenda` — LIVE, ROLE

Objetivo: visualizar e criar atendimentos por mês, semana ou dia.

Informações e controles:

- navegação anterior/próxima e `Hoje`;
- data/período atual;
- alternância `Mês`, `Semana`, `Dia` via query `?view=&date=`;
- status do atendimento;
- hora, paciente e profissional;
- consultas canceladas/faltas continuam visíveis, esmaecidas;
- séries recorrentes mostram posição e quantidade.

Ações:

- `Importar histórico` → `/agenda/importar`;
- `Lista de espera` → `/agenda/lista-espera`;
- `Ausências médicas` → `/agenda/ausencias`, conforme permissão;
- `Novo atendimento` abre drawer;
- em consulta chegada/em atendimento, `Abrir no Consultório` → `/consultorio`;
- `Corrigir` abre diálogo de correção excepcional;
- badge da série recorrente abre gestão/cancelamento da série.

Drawer `Novo atendimento`:

- tipo `Agendar (dia e hora)` ou `Encaixe (agora)`;
- busca de paciente e link `Cadastrar novo paciente` → `/pacientes?novo=1`;
- procedimento;
- profissional quando aplicável;
- data e hora;
- recorrência semanal, intervalo e quantidade;
- salas/equipamentos opcionais;
- urgência;
- observações;
- ações finais `Agendar` ou `Criar encaixe`.

Diálogo `Corrigir atendimento`:

- interromper e voltar para espera;
- cancelar excepcionalmente;
- reabrir;
- transferir para outro profissional;
- exige motivo; transferência exige novo profissional;
- ações `Voltar` e `Registrar correção`.

Diálogo `Cancelar a série recorrente`:

- explica cadência e alcance;
- informa quantas consultas futuras serão canceladas;
- exige motivo;
- preserva histórico;
- ações `Voltar` e `Cancelar série`.

Estados: mês, semana, dia preenchido, dia vazio, sem clínica, sem acesso e erro.

### 6.3 Importar histórico — `/agenda/importar` — LIVE, ROLE, INTERNAL

Objetivo: importar dados legados de agenda de forma auditável.

Campos:

- fonte dos dados;
- justificativa;
- arquivo JSON;
- orientação sobre formato.

Ação: `Importar histórico`. Mostrar validação do arquivo, sucesso, erro e bloqueio por permissão.

### 6.4 Lista de espera — `/agenda/lista-espera` — LIVE, ROLE, INTERNAL

Objetivo: registrar candidatos e ocupar vagas canceladas.

Campos:

- paciente;
- procedimento;
- profissional opcional;
- preferência de data inicial/final;
- prioridade normal/urgente;
- observações;
- `Mostrar encerrados`.

Informações por item:

- paciente, procedimento, profissional, prioridade, status;
- vaga oferecida quando houver.

Ações:

- `Adicionar à lista`;
- `Aceitar vaga`;
- `Recusar` e repassar quando aplicável;
- `Cancelar`.

Estado vazio: `Lista de espera vazia`.

### 6.5 Ausências médicas — `/agenda/ausencias` — LIVE, ROLE, INTERNAL

Objetivo: registrar ausência e reorganizar atendimentos afetados com auditoria.

Campos:

- profissional ausente;
- estratégia `Transferir atendimentos` ou `Cancelar atendimentos`;
- início e fim no fuso da clínica;
- profissional substituto quando houver transferência;
- motivo.

Ações:

- `Registrar e reorganizar agenda`;
- `Voltar à agenda`.

Informações: aviso de impacto imediato e lista de ausências atuais/futuras com estratégia. Estados sem acesso e sem ausência.

### 6.6 Consultório — `/consultorio` — LIVE, ROLE

Objetivo: operar um turno inteiro sem trocar de tela.

Estrutura:

- cabeçalho, seletor de profissional para gestor/recepção e badge de conexão `Tempo real`, `Conectando` ou `Reconectando`;
- faixa `A chegar hoje`;
- três colunas: `Sala de espera`, `Em atendimento`, `Finalizadas`;
- alerta quando a lista é truncada;
- atualização em tempo real com fallback de polling.

`A chegar hoje`:

- paciente, horário e motivo;
- `Check-in`;
- `Faltou` antes do check-in.

`Sala de espera`:

- paciente, idade/sexo, horário, motivo;
- urgência;
- tempo aguardando, posição e previsão inicial;
- alergias ou ausência de alergias registradas;
- `Chamar`.

`Em atendimento`:

- paciente, idade/sexo, motivo, status e tempo na clínica;
- alerta de alergias;
- editor de prontuário com autosave e conflito de versão;
- `Emitir prescrição`;
- `Emitir documento`;
- `Assinar prontuário`;
- `Encerrar consulta` somente para profissional autorizado;
- informação de que o encerramento é do profissional quando a ação não está disponível.

`Finalizadas`:

- horário, paciente e motivo;
- badge `Faturada` ou `Sem cobrança`;
- clique abre prontuário em somente leitura;
- `Fechar` volta ao estado central vazio.

Estados: turno vazio, conexão instável, falha de ação, múltiplos atendimentos simultâneos, consulta finalizada e atendimento sem paciente cadastrado.

### 6.7 Pacientes — `/pacientes` — LIVE, ROLE

Objetivo: buscar, cadastrar e acessar o hub de cada paciente.

Informações:

- busca por nome;
- alternância entre ativos e `Removidos`;
- tabela com nome, e-mail e, na lixeira, data de remoção;
- total da lista.

Ações:

- `Novo paciente` abre drawer;
- linha/chevron abre `/pacientes/[id]`;
- em removidos, ação de restaurar quando dentro da janela permitida.

Formulário de paciente:

- nome;
- CPF;
- possível vínculo com cadastro já existente;
- tipo de vínculo: mãe, pai, tutor legal, responsável ou outro;
- telefone e e-mail;
- data de nascimento e sexo;
- logradouro, complemento, CEP, cidade e UF;
- salvar/cadastrar.

Estados: sem permissão, nenhum paciente, busca sem resultado, removidos e erro de validação.

### 6.8 Hub do paciente — `/pacientes/[id]` — LIVE por rota dinâmica, ROLE, INTERNAL

Abas:

- `Dados`;
- `Prontuários`, apenas com permissão clínica.

Cabeçalho: nome do paciente e `Voltar` → `/pacientes`.

`Dados` mostra:

- CPF, telefone, e-mail e endereço;
- formulário de edição;
- responsáveis e dependentes;
- consentimentos LGPD;
- ações operacionais e LGPD.

Responsáveis e dependentes:

- vínculos cadastrados;
- buscar/adicionar responsável e tipo de vínculo;
- remover vínculo;
- mesclar cadastro duplicado, com cadastro correto e justificativa;
- confirmação forte porque a mesclagem é crítica.

Consentimentos:

- tratamento de dados de saúde;
- compartilhamento com terceiros;
- cobrança por WhatsApp;
- marketing;
- pesquisa e estudos;
- estado concedido/não concedido, versão e data;
- registrar ou revogar conforme permissão.

Ações LGPD/operacionais:

- exportar dados;
- solicitar exclusão/anonimização conforme regra existente;
- registrar falecimento com data e motivo;
- excluir operacionalmente;
- paciente falecido recebe banner e bloqueio de operações futuras.

`Prontuários` mostra:

- `Novo prontuário`;
- status rascunho/assinado;
- data;
- retorno planejado;
- `Ver` ou `Editar`;
- `Assinar` para rascunho.

### 6.9 Prontuário — `/pacientes/[id]/prontuarios/[pid]` — SOURCE, ROLE, INTERNAL

Objetivo: editar ou consultar um registro clínico independente da tela do Consultório.

Informações e ações:

- breadcrumb até paciente;
- estado `rascunho` ou `assinado`;
- seletor de template clínico publicado;
- editor estruturado, autosave, `salvando/salvo/erro`, conflito de versão;
- templates atuais: Clínico geral, Pediatria, Ginecologia e Psiquiatria;
- campos SOAP e observações de acordo com o template;
- `Emitir prescrição` e `Emitir documento` quando permitido;
- `Assinar prontuário` e retorno em dias;
- assinado é somente leitura.

Não desenhe “módulos por especialidade” na navegação. Esses nomes são apenas templates atuais do prontuário.

### 6.10 Emissão de prescrição — drawer interno — SOURCE, ROLE

Origem: Consultório ou prontuário.

Controles:

- modelo salvo opcional;
- aplicar modelo com aviso se mudar o tipo da receita;
- salvar conteúdo atual como modelo;
- link `Gerenciar modelos` → `/modelos-receita`;
- tipo `Simples` ou `Controle especial`;
- medicamentos com nome, dosagem, posologia, quantidade e via;
- adicionar/remover medicamento;
- observações;
- ação `Emitir prescrição`.

Mostrar regra visual para controle especial branco de duas vias, sem confundir com receita simples.

### 6.11 Emissão de documento clínico — drawer interno — SOURCE, ROLE

Origem: Consultório ou prontuário.

Tipos e campos condicionais:

- `Atestado`: descrição, dias de afastamento e CID opcional;
- `Solicitação de exame`: exames, um por linha, e indicação clínica opcional;
- `Declaração`: texto e período opcional;
- `Encaminhamento`: especialidade e motivo.

Ação final: `Emitir documento`.

### 6.12 Documentos — `/documentos` — LIVE, ROLE

Objetivo atual: consultar o histórico emitido; não é uma central de criação.

Informações e controles:

- busca por paciente;
- filtro `Todos os tipos`, `Receitas` ou `Documentos médicos`;
- tabela com tipo, paciente e data de emissão;
- badge do tipo;
- total de documentos.

Ações:

- `Filtrar`;
- `Abrir` → `/prescricoes/[id]/pdf` ou `/documentos/[id]/pdf`, em nova aba.

Estados: sem permissão, sem documento e filtro sem resultado.

Não invente nesta fotografia um botão global de emissão: em produção a criação ocorre no Consultório/prontuário.

### 6.13 Modelos de receita — `/modelos-receita` — LIVE, ROLE, INTERNAL

Origem principal: link dentro do drawer de prescrição.

Informações e ações:

- busca por nome ou categoria;
- `Novo modelo`;
- criar/editar nome e categoria;
- lista de medicamentos com nome, dosagem, posologia, via e quantidade;
- adicionar/remover medicamento;
- observações;
- salvar/cancelar edição;
- por modelo: `Editar`, `Duplicar`, `Excluir`.

### 6.14 Financeiro — `/financeiro` — LIVE, ROLE

Objetivo: visão gerencial de caixa e lançamentos.

KPIs:

- A receber;
- A pagar;
- Recebido no mês;
- Pago no mês;
- Saldo do mês.

Filtros:

- tipo: todos, a receber, a pagar;
- status: todos, pendente, parcial, pago, cancelado, estornado;
- `Filtrar`.

Tabela:

- descrição e natureza;
- data de criação;
- vencimento;
- status;
- valor positivo/negativo;
- até 50 lançamentos mais recentes.

Ações:

- `Fornecedores` → `/financeiro/fornecedores`;
- `Novo lançamento` abre drawer.

Drawer `Novo lançamento`:

- tipo receber/pagar;
- descrição;
- valor;
- vencimento opcional;
- fornecedor opcional;
- forma de pagamento opcional;
- salvar.

### 6.15 Fornecedores — `/financeiro/fornecedores` — LIVE, ROLE, INTERNAL

Objetivo: cadastro para contas a pagar.

Informações e ações:

- lista de fornecedores ativos/inativos;
- `Novo fornecedor`;
- criar/editar razão social, CNPJ, telefone e condição de pagamento;
- `Editar`;
- `Desativar`/reativar;
- estado vazio.

### 6.16 Caixa — `/caixa` — LIVE, ROLE

Objetivo: operar recebimentos e pagamentos do dia.

Resumo no cabeçalho:

- A receber;
- Recebido hoje;
- A pagar.

Alertas:

- atendimentos concluídos não faturados;
- cobranças aguardando revisão humana;
- falhas operacionais.

Seções:

- `A receber`;
- `Pagamento parcial`;
- `Recebidos hoje`;
- `A pagar`.

Cartão de item:

- paciente ou descrição da conta;
- procedimento/descrição;
- profissional, vencimento e referência;
- valor total;
- pago/falta quando parcial;
- status e forma de pagamento.

Ações:

- `Confirmar pagamento`;
- `Cancelar` com confirmação irreversível;
- `Reembolsar` quando houver saldo reembolsável.

Confirmação de pagamento:

- forma de pagamento;
- valor recebido/pago e saldo;
- comprovante opcional;
- ação contextual `Receber R$ …` ou `Pagar R$ …`.

Reembolso:

- pagamento original e valor disponível;
- valor a reembolsar;
- forma do reembolso;
- comprovante opcional;
- motivo obrigatório;
- `Confirmar reembolso` e `Voltar`.

### 6.17 Conversas IA — `/conversas` — LIVE, ROLE

Objetivo: localizar conversas do agente e priorizar handoffs humanos.

Filtros:

- busca por paciente ou telefone;
- status: aguardando humano, agente respondendo, encerradas, abandonadas;
- prazo: todos ou SLA vencido;
- `Filtrar`.

Tabela:

- paciente/telefone;
- última mensagem;
- status;
- responsável/prazo do atendimento;
- atualização;
- aviso de SLA vencido.

Linha abre `/conversas/[id]`.

### 6.18 Detalhe da conversa — `/conversas/[id]` — LIVE por rota dinâmica, ROLE, INTERNAL

Informações:

- identificação do contato;
- início e última mensagem recebida;
- status;
- alerta de falha de entrega e `Tentar novamente` quando aplicável;
- histórico cronológico com remetente, entrega e horário;
- painel `Atendimento humano`.

Fluxos:

- agente ativo: explicar risco de resposta dupla e oferecer `Assumir atendimento`;
- handoff sem responsável: `Assumir atendimento`;
- atribuído a outro: `Reatribuir para mim`;
- assumido pelo usuário: alterar prioridade normal/urgente, `Atualizar`, responder e `Devolver ao agente`;
- janela Meta aberta: textarea e `Enviar resposta`;
- janela de 24h expirada: bloquear texto livre e explicar que o paciente deve escrever novamente;
- encerrada/abandonada: somente leitura, sem resposta.

### 6.19 Relatórios — `/relatorios` — LIVE, ROLE

Objetivo: indicadores do período, com fuso da clínica.

Controles:

- períodos `Últimos 7 dias`, `Últimos 30 dias`, `Últimos 90 dias`;
- `Exportar PDF` → `/relatorios/pdf?periodo=…` em nova aba.

Informações:

- faturamento recebido, pago e saldo, conforme permissão;
- taxa e volume de no-show;
- ocupação e horas ocupadas/disponíveis;
- total, atendidos, faltas e cancelados.

### 6.20 Equipe & Permissões — `/equipe` — LIVE, ROLE

Objetivo: gerir acesso e capacidade da equipe.

Informações:

- contagem por papel;
- tabela com usuário, função, credencial profissional, 2FA, status e ações;
- papéis: Dono, Gestor, Médico, Financeiro, Recepção e Super admin;
- estados: ativo, inativo, convite pendente e médico incompleto.

`Convidar` abre drawer:

- função;
- nome;
- e-mail;
- CRM e UF quando médico;
- aviso de limite do plano;
- `Enviar convite`.

Ações de membro:

- `Trocar função`;
- `Permissões individuais` com padrão da função, permitir ou bloquear;
- `Desativar acesso`;
- `Reativar acesso`;
- se médico tiver compromissos, informar quantidades e permitir `Desativar mesmo assim` após confirmação.

Ações de convite:

- `Reenviar convite`, copiando link;
- fallback para copiar manualmente;
- `Cancelar convite`.

### 6.21 Configurações — `/configuracoes` — LIVE, ROLE

Objetivo: hub de ajustes da clínica.

Cards existentes:

- Sugestões;
- Assinatura;
- Perfil da clínica;
- Horários de atendimento;
- Solicitações LGPD;
- Procedimentos;
- Salas e equipamentos;
- Conexão do WhatsApp;
- Agente de IA;
- Auditoria;
- Segurança da conta.

As seções devem aparecer somente quando permitidas. Não use cards idênticos como única solução de hierarquia: diferencie “clínica”, “operação”, “integrações”, “conta” e “conformidade”.

Top tabs atuais dentro de `/configuracoes/*`:

- Assinatura;
- Sugestões;
- Visão geral;
- Perfil da clínica;
- Horários;
- Procedimentos;
- Salas e equipamentos;
- LGPD;
- WhatsApp;
- Segurança da conta.

Issue atual: `Agente de IA` e `Auditoria` existem no hub e em rotas reais, mas não aparecem nessa barra de tabs; ao entrar nelas nenhuma tab fica ativa. Proponha uma navegação de configurações que resolva isso sem inventar rotas.

### 6.22 Perfil da clínica — `/configuracoes/perfil` — LIVE, ROLE

Informações/campos:

- nome, endereço, telefone, CNPJ e CNES;
- logo no receituário: preview, enviar/remover;
- credencial do profissional atual: CRM, UF e especialidade.

Ações: `Enviar imagem`, `Remover`, `Salvar perfil`, `Salvar credencial`, `Voltar`.

### 6.23 Horários — `/configuracoes/horarios` — LIVE, ROLE

Informações e ações:

- seletor de profissional quando aplicável;
- disponibilidade semanal agrupada por dia;
- remover faixa de horário;
- criar expediente com dia, início/fim e pausa de almoço opcional, que divide manhã/tarde;
- `Adicionar expediente`;
- feriados de dia inteiro;
- data e motivo opcional;
- remover feriado;
- `Adicionar feriado`.

### 6.24 Procedimentos — `/configuracoes/procedimentos` — LIVE, ROLE

Informações e ações:

- busca por código, descrição ou categoria;
- `Mostrar inativos`;
- `Novo procedimento`;
- código, categoria, descrição, preço e duração;
- salvar/cancelar edição;
- `Editar`, `Duplicar`, `Desativar`/reativar;
- badge inativo.

### 6.25 Salas e equipamentos — `/configuracoes/recursos` — LIVE, ROLE

Informações e ações:

- nome;
- tipo: sala, equipamento ou outro;
- `Cadastrar`;
- lista com tipo e estado;
- `Mostrar inativos`;
- `Desativar`/reativar.

### 6.26 Agente de IA — `/configuracoes/agente` — LIVE, ROLE

Objetivo: definir o que o agente pode fazer e dizer no WhatsApp.

Campos:

- antecedência máxima de agendamento em dias;
- especialidades, separadas por vírgula;
- convênios aceitos, separados por vírgula;
- permitir agendamento sem cadastro prévio;
- permitir informar valores de cobranças pendentes, com explicação de risco de identidade.

Ação: `Salvar`.

### 6.27 WhatsApp — `/configuracoes/whatsapp` — LIVE, ROLE

Objetivo: conectar a clínica ao Meta Embedded Signup.

Estados:

- desconectado: explicação, PIN numérico de seis dígitos e `Conectar WhatsApp`;
- carregando/conectando;
- conectado: número mascarado, data da conexão e `Desconectar`;
- degradado: mensagens de diagnóstico, PIN e `Reconectar WhatsApp`, além de `Desconectar`;
- estado indeterminado mantém a última verificação bem-sucedida com aviso.

O PIN ativa o número na Cloud API e não é salvo pela Qoro.

### 6.28 Assinatura — `/configuracoes/assinatura` — LIVE, ROLE

Informações:

- plano atual, preço/ciclo e limites;
- cards dos planos disponíveis e indicação `Atual`;
- alteração em andamento e link de pagamento quando existir;
- erros e confirmações.

Ações condicionais:

- `Fazer upgrade`/alterar plano;
- `Plano atual` desabilitado;
- bloqueio `Requer 1 usuário ativo` quando aplicável;
- reativar assinatura;
- revogar cancelamento;
- `Cancelar assinatura ao fim do ciclo`.

### 6.29 Auditoria da clínica — `/configuracoes/auditoria` — LIVE, ROLE

Objetivo: exportar a trilha do próprio tenant.

Campos: data `De` e `Até`. Ação: `Exportar CSV`. Mostrar validação, geração e erro.

### 6.30 Solicitações LGPD — `/configuracoes/lgpd` — LIVE, ROLE

Objetivo: operar fila, prazo, tratamento e comunicação ao titular.

Informações:

- tipo/status da solicitação;
- prazo e indicador vencido;
- paciente/titular;
- responsável;
- histórico e export quando disponível.

Ações:

- atribuir responsável;
- processar após comprovação de identidade;
- abrir export assinado;
- marcar titular como notificado;
- canal: e-mail, WhatsApp, telefone ou presencial;
- comprovação da comunicação.

### 6.31 Sugestões — `/configuracoes/sugestoes` — LIVE

Objetivo: canal privado por autor para ideias, melhorias e bugs.

Campos:

- título;
- descrição;
- categoria: nova funcionalidade, melhoria, bug ou outro;
- prioridade percebida: baixa, média ou alta.

Ação: `Enviar sugestão`. Abaixo, `Seus envios` com status, categoria, prioridade e data. Unifique a marca: a copy ainda menciona `ClinicaOS` em produção.

### 6.32 Segurança da conta — `/account/security` — LIVE

Objetivo: gerenciar MFA TOTP da conta individual.

Informações e ações:

- estado da sessão e nível de autenticação;
- seção `TOTP (Authy / Google Authenticator)`;
- `Ativar TOTP`, QR/segredo e código de seis dígitos;
- confirmar ativação;
- remover/desativar fator com confirmação;
- mensagens para sessão inválida, fator ausente e exigência de autenticação forte;
- `Voltar ao dashboard`.

## 7. Telas públicas, autenticação, PDFs e onboarding publicados

### 7.1 Entrada — `/`

Redireciona para `/login`. Não existe landing pública dentro de `app.qoro.dev`.

### 7.2 Login — `/login` — PUBLIC

Layout desktop em duas colunas: formulário e painel de marca.

Controles:

- e-mail;
- senha;
- mostrar/ocultar senha;
- `Entrar`;
- alertas para sessão expirada, acesso revogado ou outros motivos conhecidos.

Copy de marca: “Gerencie sua clínica sem vazamentos”. No mobile, mostrar apenas a área essencial do formulário.

Não há CTA de cadastro autônomo nem recuperação de senha visível nessa fotografia. Não os invente no mockup desta versão.

### 7.3 MFA de login — `/login/mfa` — PUBLIC

- código TOTP de seis dígitos;
- `Confirmar`/continuar;
- erro de código.

### 7.4 Recuperação — `/reset-password` — PUBLIC

- link inválido/expirado;
- nova senha, mínimo de oito caracteres;
- salvar e redirecionar após sucesso.

### 7.5 Convite de funcionário — `/convite` — PUBLIC

- convite inválido/expirado;
- criar senha;
- confirmar senha;
- mostrar/ocultar;
- concluir acesso.

### 7.6 Ativação de clínica por convite — `/join` e `/join/[token]` — PUBLIC

O fluxo publicado é por convite; não é cadastro autônomo.

Estados de entrada:

- validando convite;
- convite indisponível;
- clínica já ativada, com acesso ao dashboard.

Wizard:

1. Boas-vindas: convite válido, clínica/plano quando conhecidos e `Começar`.
2. `Clínica`: nome, CNPJ, telefone e endereço.
3. `Acesso`: nome do responsável, e-mail fixado pelo convite e senha.
4. `Plano`: cards dos planos e seleção.
5. `Pagamento`: titular, CPF/CNPJ, e-mail, telefone, CEP, número e, quando cartão, número, nome, validade e CVV; processamento pelo Asaas.
6. Processamento: criação da clínica, assinatura e acesso.
7. Conclusão: `Ir para o dashboard`.

Exibir stepper `Clínica / Acesso / Plano / Pagamento`, voltar sem perder o estado permitido, erros por etapa e segurança/LGPD. Dados de cartão não devem aparecer em logs, resumos persistentes ou mockups compartilhados.

### 7.7 PDFs

- `/prescricoes/[id]/pdf` — receita emitida;
- `/documentos/[id]/pdf` — documento clínico;
- `/relatorios/pdf` — relatório gerencial.

Desenhar página de impressão/PDF com identidade da clínica, hierarquia documental e assinatura, separada do chrome operacional.

### 7.8 Erros de autenticação — `/auth/auth-error`

Mensagem específica e ação `Voltar para o login`.

## 8. Inventário do console superadmin

Estas telas são SOURCE/ROLE: a conta tenant do levantamento recebeu `404` nas rotas `/admin/*`.

### 8.1 Visão geral — `/admin`

- saúde do negócio em uma tela;
- receita, clínicas, clientes e risco;
- atualização;
- receita paga dos últimos seis meses;
- distribuição de clínicas;
- novas clínicas;
- clínicas em risco;
- links para Pagamentos e detalhe de clínica.

### 8.2 Clínicas — `/admin/clinicas`

- busca por nome/slug;
- filtros de status, billing e plano;
- tabela: clínica, plano, billing, última atividade, status e abrir;
- `Nova clínica · convite`;
- e-mail do gestor, plano sugerido e observação interna;
- convite gerado/copiar;
- convites pendentes e cancelamento;
- linha abre `/admin/clinicas/[id]`.

### 8.3 Detalhe da clínica — `/admin/clinicas/[id]`

- identificação, status e plano;
- dados gerais;
- plano e pagamentos;
- métricas/atividade;
- integrações;
- usuários;
- últimas auditorias;
- exportação de auditoria com período e hash de integridade;
- impersonação protegida por código TOTP;
- deixar o modo impersonado persistentemente visível e fácil de encerrar.

### 8.4 Pagamentos — `/admin/billing`

- KPIs de receita/recebíveis/inadimplência;
- dunning ativo;
- reembolsos;
- faturas recentes com clínica, valor, vencimento e status;
- receita dos últimos seis meses;
- links para detalhe da clínica.

### 8.5 Feedbacks — `/admin/feedbacks` e `/admin/feedbacks/[id]`

- KPIs e gráficos por status/mês/categoria/empresa;
- busca, status, categoria, clínica, usuário e ordenação;
- exportar;
- tabela com feedback, clínica, categoria, status e data;
- detalhe com conteúdo, metadados e histórico;
- alterar status;
- adicionar nota interna;
- ações de gestão definidas pelo estado.

### 8.6 Conversas IA — `/admin/conversas-ia`

- filtros por clínica, período e status;
- lista de conversas;
- seleção mantém contexto na mesma rota;
- mensagens descriptografadas no servidor;
- deixar claro que o console vê conteúdo sensível cross-tenant e que o acesso é auditado.

### 8.7 Métricas — `/admin/metricas`

- DAU, WAU, conversas IA, mensagens e custo Gemini;
- usuários ativos diários em 14 dias;
- custo Gemini diário em 14 dias;
- maiores consumidores de IA com clínica, conversas, mensagens, custo e participação.

### 8.8 Auditoria — `/admin/audit`

- busca por ação;
- filtros de clínica, entidade, usuário e período;
- tabela: horário, ator, clínica, evento, recurso, IP e resultado;
- paginação;
- toda ação superadmin deve ser visualmente identificável.

### 8.9 Saúde — `/admin/saude`

- status de banco, Meta/WhatsApp, IA, billing e jobs;
- estados saudável, degradado, indisponível e desconhecido;
- incidentes ativos;
- horário da última verificação;
- não depender apenas de verde/vermelho.

### 8.10 Configurações da plataforma — `/admin/config`

Áreas existentes:

- kill-switches operacionais;
- modo do agente e proatividade;
- saúde dos jobs;
- retenção e partições;
- avisos globais: criar, listar e desativar;
- integridade de configuração;
- prompt do sistema, somente leitura;
- templates Meta WhatsApp e estado de configuração.

Mudanças de kill-switch devem parecer operações críticas, com contexto, estado atual, confirmação e trilha de auditoria.

## 9. Fluxos internos que o protótipo precisa demonstrar

### 9.1 Turno clínico principal

```text
Dashboard
  → Agenda
  → Novo atendimento ou consulta existente
  → Check-in no Consultório
  → Sala de espera
  → Chamar
  → Em atendimento
  → Editar prontuário
  → Emitir receita/documento
  → Assinar prontuário
  → Encerrar consulta
  → Finalizada com estado Faturada/Sem cobrança
  → Caixa
  → Confirmar pagamento, parcial ou reembolso
```

### 9.2 Paciente e prontuário

```text
Pacientes
  → buscar ou cadastrar
  → hub do paciente
  → Dados / Prontuários
  → novo prontuário ou abrir existente
  → autosave
  → prescrição/documento
  → assinatura
  → PDF
```

### 9.3 Vaga cancelada e lista de espera

```text
Agenda
  → Lista de espera
  → candidato compatível
  → vaga oferecida
  → aceitar, recusar/repassar ou cancelar
  → Agenda atualizada
```

### 9.4 Ausência do profissional

```text
Agenda
  → Ausências médicas
  → período + motivo
  → transferir para substituto OU cancelar
  → confirmação de impacto
  → agenda reorganizada e auditada
```

### 9.5 Conversa entregue a humano

```text
Conversas IA
  → filtrar handoff/SLA
  → abrir thread
  → assumir ou reatribuir
  → definir prioridade
  → responder dentro da janela Meta
  → devolver ao agente
```

### 9.6 Gestão financeira

```text
Financeiro
  → visão mensal e filtros
  → novo lançamento / fornecedor
  → Caixa
  → receber/pagar
  → parcial ou concluído
  → reembolso quando elegível
  → Relatórios / PDF
```

### 9.7 Equipe e acesso

```text
Equipe
  → convidar
  → link de convite
  → criar senha
  → usuário ativo
  → trocar função / override de permissão
  → desativar ou reativar
```

### 9.8 Ativação de nova clínica publicada

```text
Superadmin cria convite
  → /join/[token]
  → clínica
  → responsável e senha
  → plano
  → checkout Asaas
  → provisionamento
  → dashboard
```

## 10. Diagnóstico e direção Antes/Depois

### 10.1 Arquitetura da informação

| Antes | Depois |
| --- | --- |
| Sidebar correta, porém todos os itens têm peso visual semelhante. | Manter grupos e rotas, enfatizando o fluxo diário Operação → Clínico → Gestão e reduzindo o ruído administrativo durante o turno. |
| Configurações combina tabs extensas com um grid que repete os mesmos destinos. | Agrupar em Clínica, Agenda, Integrações, Conta e Conformidade; garantir estado ativo para todas as rotas reais. |
| Rotas internas importantes aparecem como links discretos em cabeçalhos/drawers. | Criar navegação contextual consistente: voltar, trilha, ação primária e ações secundárias no mesmo lugar. |
| Dashboard mistura operação atual, onboarding e dois grandes blocos “Em breve”. | Priorizar o que exige ação hoje; onboarding permanece até concluir; futuras capacidades não ocupam área nobre. |

### 10.2 Hierarquia e densidade

| Antes | Depois |
| --- | --- |
| Muitas telas vazias deixam grande área sem contexto ou próximo passo. | Estados vazios compactos, específicos e com uma ação permitida claramente indicada. |
| Toolbars de Financeiro e Documentos empilham campos estreitos mesmo em desktop largo. | Toolbar horizontal responsiva, filtros agrupados, resumo de filtros e densidade adequada à tabela. |
| Cards idênticos são usados para KPIs, configuração, alerta e conteúdo. | Reservar cards para agrupamentos reais; usar superfícies planas/divisores para listas e elevação apenas para objetos interativos/contextuais. |
| Listas longas crescem verticalmente e escondem o contexto do cabeçalho. | Cabeçalho/tabela legíveis, paginação ou continuidade visível conforme comportamento existente e toolbar sticky quando necessário. |

### 10.3 Tipografia e números

| Antes | Depois |
| --- | --- |
| Mono ajuda em valores e metadados, mas aparece em muitos rótulos pequenos. | Mono apenas para horários, dinheiro, códigos, contagens e dados de comparação; texto humano permanece sans. |
| Títulos funcionam, mas algumas páginas têm pouca relação visual com a urgência do conteúdo. | Escala tipográfica consistente; `text-wrap: balance` em títulos e `text-wrap: pretty` em descrições curtas. |
| Números financeiros e de fila variam entre cards, listas e tabelas. | Usar algarismos tabulares, alinhamento à direita e unidade/sinal consistentes. |

### 10.4 Superfícies, bordas e raios

| Antes | Depois |
| --- | --- |
| Combinação frequente de borda e sombra em quase todo card achata a hierarquia. | Borda para separar regiões/inputs; sombra para elevação real: dropdown, drawer, modal, item arrastável ou conteúdo flutuante. |
| Cards dentro de regiões arredondadas nem sempre deixam clara a relação pai/filho. | Aplicar raios concêntricos: raio interno = raio externo − padding perceptual. |
| Alertas e estados usam cores corretas, mas podem competir com o conteúdo principal. | Intensidade proporcional ao risco; ícone, rótulo e ação além da cor. |

### 10.5 Interação e movimento

| Antes | Depois |
| --- | --- |
| A maior parte da interface muda instantaneamente; alguns componentes legados têm linguagem diferente. | Transições discretas e unificadas apenas em propriedades necessárias; nunca usar `transition: all`. |
| Ações críticas aparecem próximas de ações comuns em alguns painéis. | Separar visualmente ação primária, secundária e destrutiva; confirmar alcance e consequência. |
| Feedback depende de toast/alert após a ação. | Somar estado local de progresso, sucesso persistente quando necessário e preservação do input em erro. |

### 10.6 Acessibilidade e operação real

| Antes | Depois |
| --- | --- |
| Alguns alvos compactos ficam abaixo do conforto para toque. | Alvos mínimos de 40–44 px, inclusive ícones, tabs, menus e linhas acionáveis. |
| Status têm cor e texto, mas a leitura rápida varia por tela. | Padrão único com ícone/forma/texto; contraste AA e ordem semântica consistente. |
| Desktop é forte, mas grandes tabelas e tabs exigem solução específica no mobile. | Mobile usa navegação em drawer, cards/linhas responsivas, barra de ação contextual e nenhuma tabela espremida horizontalmente sem alternativa. |

## 11. Direção visual recomendada: “Operação clínica serena”

### Personalidade

- precisa, calma, humana e confiável;
- tecnologia presente, não exibicionista;
- premium pela tipografia, espaçamento e detalhes, não por gradientes e sombras excessivas;
- sensação de cockpit clínico leve, não de painel bancário ou rede social.

### Cores

- preservar navy Qoro como cor de ação e navegação;
- neutros levemente quentes para reduzir frieza;
- orchid/magenta somente para IA/automação e momentos raros de marca;
- verde, âmbar e vermelho exclusivamente semânticos;
- dark mode não pode ser simplesmente fundo preto: usar superfícies navy-charcoal com contraste controlado.

### Tipografia

- manter a combinação Hanken Grotesk + Inter + IBM Plex Mono como baseline da fotografia publicada;
- interface entre 14 e 16 px na maior parte da operação;
- títulos fortes, não gigantes;
- mono apenas para dados operacionais;
- antialiasing e renderização de fonte consistentes;
- limitar largura de textos explicativos; não limitar tabelas/boards que precisam de área.

### Layout

- desktop de referência: 1440 × 1024;
- sidebar compacta, estável e claramente separada;
- conteúdo entre 1120 e 1240 px quando a tarefa precisa de densidade, em vez de deixar tabelas espremidas no centro;
- cabeçalho de página em uma única gramática: contexto, título, descrição curta e ações;
- grids responsivos; não criar uma coleção de cartões iguais.

### Componentes

- botões: primário, secundário, ghost e perigo com hierarquia inequívoca;
- inputs com label persistente, hint e erro local;
- tabelas com header estável, números tabulares, hover discreto e linha inteira acionável quando seguro;
- badges com texto e símbolo; não só cor;
- drawers para criação/edição contextual;
- dialogs apenas para decisão, confirmação ou consequência ampla;
- toasts curtos; erros que exigem ação ficam no contexto;
- skeletons com a geometria final; sem spinner solto para páginas inteiras.

### Movimento e microinteração

- nenhuma animação obrigatória no primeiro carregamento;
- troca de estado pode usar escala `0.25 → 1`, opacidade `0 → 1` e blur `4 px → 0`, por aproximadamente `300 ms`, sem bounce;
- botões podem usar press scale próximo de `0.96`;
- hover/focus entre 110 e 180 ms;
- transicionar propriedades específicas;
- respeitar `prefers-reduced-motion`;
- usar `will-change` somente durante a interação que realmente anima.

### Superfícies

- raios discretos e concêntricos;
- sombra apenas quando existe elevação;
- borda para divisão e inputs;
- imagens/logos, quando usados sobre fundos variáveis, recebem outline branco ou preto puro com cerca de 10% de opacidade, conforme o fundo.

## 12. Regras específicas para as quatro telas North Star

### Dashboard

- primeira dobra responde: o que está acontecendo, o que está atrasado e o que exige ação;
- checklist de ativação fica compacto e pode recolher após progresso;
- remover “Em breve” da área nobre do conceito visual; se preservado como estado atual, colocá-lo em região secundária e claramente não acionável;
- atividade recente usa verbos humanos, não nomes internos de evento.

### Agenda

- controles de período, data e criação formam uma única barra coerente;
- dia é a vista operacional padrão, mas mês/semana continuam disponíveis;
- cada consulta permite escanear hora → paciente → procedimento/profissional → status → próxima ação;
- cancelados/faltas permanecem visíveis sem disputar com ativos;
- drawer de novo atendimento não pode parecer um formulário longo indiferenciado: revelar campos condicionais conforme Agendar/Encaixe e Recorrência.

### Consultório

- é a tela mais importante do médico;
- centralizar visualmente o paciente em atendimento;
- alergias e urgência têm alta saliência sem causar fadiga de alerta;
- fila lateral é compacta e acionável;
- editor clínico ocupa espaço suficiente;
- assinatura e encerramento ficam no fim lógico, com estado somente leitura claro após concluir;
- conexão em tempo real é informativa, não o elemento mais chamativo.

### Caixa

- separar visualmente dinheiro que entra, dinheiro que sai e exceções;
- cards de item precisam permitir comparação rápida;
- confirmação expande no próprio item, preservando contexto;
- parcial mostra total, pago e saldo com hierarquia;
- reembolso é separado de cancelamento e exige motivo/limite visível;
- alertas de atendimento sem faturamento e revisão humana ficam acima das listas.

## 13. Estados obrigatórios por padrão de tela

Para cada rota relevante, desenhar pelo menos:

- carregando;
- vazio com próximo passo permitido;
- preenchido normal;
- erro recuperável;
- sem permissão;
- somente leitura;
- ação em andamento;
- sucesso;
- item desativado/cancelado quando fizer sentido;
- mobile.

Para tarefas críticas, incluir também:

- conflito de prontuário;
- conexão Meta degradada;
- SLA vencido;
- janela de 24h expirada;
- pagamento parcial;
- reembolso limitado ao disponível;
- série recorrente com impacto;
- médico com agenda futura antes de desativar;
- sessão que exige MFA.

## 14. Responsividade

### Desktop

- referência em 1440 px;
- suportar 1280 px sem perder ações;
- usar largura adicional em tabelas, agenda e consultório.

### Tablet

- sidebar recolhível;
- consultório pode alternar fila/paciente/finalizados sem perder contagens;
- filtros viram popover/drawer apenas quando isso melhora o espaço.

### Mobile

- referência 390 × 844;
- menu em drawer;
- cabeçalho compacto;
- CTA primário acessível sem cobrir conteúdo;
- tabelas viram linhas estruturadas ou cards comparáveis;
- forms em uma coluna;
- botões críticos não ficam lado a lado quando houver risco de toque incorreto;
- mínimo de 44 px para toque.

## 15. O que não criar

- nenhuma nova rota;
- nenhum módulo por especialidade;
- nenhum chatbot flutuante genérico;
- nenhum comando de IA em toda tela;
- nenhuma confirmação de pagamento baseada apenas no frontend;
- nenhuma exposição de `tenant_id`, UUID, token, segredo ou dado real;
- nenhum cadastro autônomo: não existe na fotografia publicada;
- nenhuma central `/documentacao`: não existe na fotografia publicada;
- nenhuma criação global de documento pela tela `/documentos`;
- nenhum calendário, cobrança, gráfico ou alerta sem fonte funcional descrita;
- nenhum botão decorativo;
- nenhum excesso de glassmorphism, gradiente, pill, sombra, ilustração ou espaço vazio;
- nenhuma cópia de dashboard genérico estilo template;
- nenhuma alteração de fluxo de autorização ou regra de negócio.

## 16. Entregáveis do Claude Design

1. Frame de diagnóstico e princípios.
2. Mood strip recomendado + duas alternativas menores.
3. Design system base:
   - cores light/dark;
   - tipografia;
   - spacing;
   - raios;
   - elevação;
   - ícones;
   - estados e acessibilidade.
4. Quatro telas North Star desktop, preenchidas com dados sintéticos.
5. Versão mobile dessas quatro telas.
6. Todas as telas tenant do inventário.
7. Telas públicas de login, MFA, convite e onboarding.
8. Console superadmin separado.
9. Component inventory com estados.
10. Protótipos clicáveis dos fluxos 9.1, 9.2, 9.5, 9.6 e 9.8.
11. Anotações em cada ação com a rota/drawer/dialog de destino.
12. Lista final de inconsistências do produto atual que o design encontrou, sem resolvê-las silenciosamente.

## 17. Critérios de aceite

- [ ] Todas as rotas deste documento estão representadas ou explicitamente marcadas como tela de suporte/PDF.
- [ ] Nenhuma função nova foi inventada.
- [ ] Agenda, Consultório e Caixa parecem um fluxo contínuo.
- [ ] O médico consegue reconhecer o paciente, risco e próxima ação em menos de três segundos.
- [ ] Recepção consegue cadastrar, encaixar, fazer check-in e registrar falta sem ambiguidade.
- [ ] Financeiro distingue a receber, a pagar, parcial, pago, cancelado, estornado e reembolso sem depender de cor.
- [ ] Dono/gestor entende integração, equipe, assinatura e auditoria.
- [ ] Tenant e console superadmin nunca parecem o mesmo escopo.
- [ ] Permissão negada e somente leitura são estados claros e respeitosos.
- [ ] Dark mode tem contraste e hierarquia próprios.
- [ ] Desktop, tablet e mobile são operáveis.
- [ ] Alvos de toque têm 40–44 px.
- [ ] Títulos usam balanceamento; textos curtos evitam viúvas; números comparáveis são tabulares.
- [ ] Raios aninhados são concêntricos.
- [ ] Sombras representam elevação; bordas representam divisão.
- [ ] Movimento é discreto, específico e respeita redução de movimento.
- [ ] Não há dados reais de pacientes no arquivo.
- [ ] O resultado parece Qoro, não um template genérico.

## 18. Resultado esperado

Entregue um produto visualmente maduro, compacto e calmo. A beleza deve vir da ordem: boa tipografia, alinhamento óptico, hierarquia, densidade, contraste e detalhes. O usuário deve sentir que a Qoro entende a rotina da clínica e reduz a carga mental do turno — não que adiciona mais um painel para administrar.

---

## 19. Observações do levantamento para a futura implementação

Estas observações não autorizam alteração de código; servem para a etapa posterior de refinamento:

1. O topo de Configurações não contempla `Agente de IA` e `Auditoria`, embora ambas sejam rotas reais do hub.
2. O checklist do Dashboard referencia `/pacientes/novo`, rota ausente; o drawer de Agenda usa `/pacientes?novo=1`.
3. `Documentos` é uma consulta de emitidos; a emissão ocorre no Consultório/prontuário.
4. `Modelos de receita` é uma rota real acessada de dentro da prescrição, sem item de sidebar.
5. Blocos `Em breve` ocupam área relevante do Dashboard atual.
6. Toolbars de filtros aproveitam pouco a largura disponível em algumas telas desktop.
7. WhatsApp e onboarding ainda usam linguagem visual legada em partes do código publicado; o mockup deve unificar o sistema, preservando o comportamento.
8. A marca aparece como Qoro na maior parte do produto, mas a tela de Sugestões ainda cita ClinicaOS.
9. `/admin/*` responde `404` para usuário tenant; isso é isolamento esperado, não ausência das telas no produto.
10. Não há, nesta fotografia de produção, `/cadastro`, `/documentacao` ou cadastro autônomo iniciado pela landing page.
