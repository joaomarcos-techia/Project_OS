# Consulta regulatória: Componente de Segurança e Privacidade do Padrão TISS (S9)

**Para:** assessoria regulatória em saúde suplementar.
**De:** Qoro (software de gestão para clínicas, SaaS).
**Pedido:** a interpretação de cinco pontos do componente de segurança, antes de habilitar o faturamento TISS
para clínicas reais. **Não pedimos atestado de conformidade.** Também não declaramos conformidade integral: a
avaliação abaixo é técnica e interna.

## 1. Norma de referência

- **Componente:** Padrão TISS — Componente de Segurança e Privacidade, versão **202511**, publicado pela ANS.
- **Página oficial:** https://www.gov.br/ans/pt-br/assuntos/prestadores/padrao-para-troca-de-informacao-de-saude-suplementar-2013-tiss/padrao-tiss-setembro-2026
- **Arquivo:** `PadroTISS_segurana_202511.zip` (sha256 `09af14231ae40b95d055fb3effbadfba1f71bdf676a5a3c69a057bace0d2ff73`), com a planilha
  `Padrão TISS_segurança_202511.xlsx` (sha256 `9a834f490eba65a580d6abf475d1f258c0e0f8c373e6185c93f38ac3b54f0a8e`).
- **Escopo declarado na norma:** "Os requisitos que compõem esta relação, se aplicam a todos os sistemas e
  portais que tratam os dados que fazem parte do Padrão TISS para troca de informações na saúde suplementar."
- **Mensagens TISS** usadas pelo Qoro: versão 4.03.00 (guias de Consulta e SP/SADT, lote, recurso de glosa e
  demonstrativos).

## 2. O sistema, em poucas linhas

- **Plataforma:** SaaS multi-clínica. Cada clínica é um inquilino isolado no banco, com políticas por linha e
  verificação do papel a cada requisição. Cada usuário pertence a uma clínica, e trocar a clínica do usuário
  invalida a sessão.
- **Módulo TISS:** opcional, ligado por clínica. Hoje está **desligado para todas as clínicas reais**. Ele
  emite guias, lotes e recursos em XML 4.03.00, validados no XSD oficial antes do envio.
- **Dados pessoais estruturados:** ficam no banco (PostgreSQL). Os dados sensíveis vão cifrados por clínica:
  carteirinha, CPF e conteúdo da guia.
- **XML e PDF emitidos:** são gerados em memória, sem arquivo temporário, e guardados cifrados por clínica num
  armazenamento de objetos privado. Só o servidor lê, conferindo o SHA-256 a cada leitura.
- **Senhas:** guardadas pelo provedor de autenticação (Supabase Auth, bcrypt). O Qoro não armazena senha.

## 3. Situação interna dos 53 requisitos vigentes (avaliação de 12/11/2026)

Obrigatórios: 16 atendem, 6 parciais, 7 lacunas, 4 dependem de interpretação e 9 não se aplicam.

As 7 lacunas e os 6 parciais têm plano técnico, mas não estão ligados. São eles: inatividade de 10 minutos,
complexidade, expiração e histórico de senha, auditoria imutável de 180 dias e aviso de último acesso. Os quatro
pontos de interpretação são as perguntas 2 a 5 abaixo. A pergunta 1 define o alcance de todos.

## 4. Perguntas

### Pergunta 1: alcance no SaaS multi-clínica

O componente vale para a plataforma inteira ou só para as clínicas que trocam dados TISS por ela?

- **Por que perguntamos:** a maioria das clínicas da plataforma não fatura convênio. Aplicar a inatividade de
  10 minutos, a expiração de senha e as demais regras a todas elas muda o uso de quem nunca envia TISS.
- **Leitura técnica (não é parecer):** aplicar o perfil completo às clínicas com o módulo TISS ligado,
  inclusive a todo usuário delas e ao suporte da plataforma quando acessar essas clínicas.
- **O que precisamos:** confirmar se essa delimitação atende ao escopo citado no item 1.

### Pergunta 2: requisito 56 diante do 79 (XML e PDF fora do banco)

- **Requisito 56:** "Componentes que manipulam dados identificados do sistema para fins de
  interoperabilidade, visualização, assinatura e outros, não devem manter tais dados fora do SGBD após o
  término da operação."
- **Requisito 79:** "Dados pessoais e pessoais sensíveis estruturados devem ser armazenados por Sistema(s)
  de Gerenciamento de Banco de Dados (SGBD) e dados pessoais e pessoais sensíveis não estruturados e não
  armazenados em SGBD devem atender à requisitos de confidencialidade."
- **Como está:**
  - o XML do lote e o PDF da guia são documentos de cobrança que precisam ser guardados;
  - ficam cifrados por clínica num armazenamento de objetos privado;
  - o banco guarda só a referência e o SHA-256;
  - nada fica em disco local ou temporário.
- **Pergunta:** guardar esses arquivos, cifrados e fora do banco, atende ao 79 sem violar o 56? Ou o 56 exige
  guardá-los dentro do SGBD?

### Pergunta 3: requisito 41 (documento unívoco do usuário)

- **Texto (trecho):** "toda pessoa usuária do sistema deverá ser vinculada minimamente a um documento de
  identificação pessoal unívoco [...] o sistema não deve permitir a associação de um mesmo documento de
  identificação a dois usuários no sistema."
- **Como está:** cada usuário tem um e-mail único, mas nenhum documento pessoal. A coleta obrigatória de CPF
  não foi adotada, por falta de base e finalidade definidas na LGPD.
- **Pergunta:** o registro no conselho profissional, com a UF, serve de documento unívoco para profissionais
  de saúde (com CPF só para os demais usuários)? Ou o requisito exige o CPF de todos?

### Pergunta 4: requisito 43 (gerenciadores de senha)

- **Texto (trecho):** "A interface de usuário utilizada para digitação de credenciais [...] deve impedir a
  memorização e a visualização de dados anteriores (lista de logins já digitados, lembrança automática de
  senhas associadas a um login, etc.)."
- **Como está:** a senha é mascarada e o campo é limpo após erro. O campo permite gerenciador de senha, o que
  as recomendações atuais de segurança incentivam.
- **Pergunta:** o 43 obriga a bloquear gerenciadores de senha, ou atende impedir a memorização pelo próprio
  sistema (o navegador sem sugerir logins anteriores, a senha nunca exibida)?

### Pergunta 5: requisito 77 (resistência do armazenamento da senha)

- **Texto (trecho):** "A senha deve ser armazenada em banco de dados, de forma codificada por algoritmo
  criptográfico no minimo igual a 256 bits."
- **Como está:** as senhas ficam com o provedor de autenticação, em bcrypt (custo adaptativo, com sal).
  O bcrypt não tem um tamanho de saída de 256 bits comparável ao de um hash.
- **Pergunta:** bcrypt, com custo adequado, atende ao 77? Ou o requisito exige um algoritmo com saída de 256
  bits (por exemplo, uma derivação com SHA-256)? Em caso de exigência, a mudança é do provedor.

## 5. O que pedimos de volta

1. A resposta a cada pergunta, com o fundamento.
2. Se cabe consulta formal à ANS e como fazê-la. O Qoro não contata a ANS sem autorização institucional.
3. Pontos que a assessoria entenda que estão fora das perguntas e mereçam atenção antes da liberação.

Material técnico de apoio (sob pedido): a matriz dos 53 requisitos com a evidência de cada um e a ficha das
decisões S1–S8.
