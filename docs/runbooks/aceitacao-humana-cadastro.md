# Runbook — aceitação humana do cadastro autônomo

## Status

Canonical para **julgamento de produto**. A revalidação histórica e os limites de acesso aos painéis
estão no [relatório de 21/09](../evidence/track-o-revalidacao-2026-09-21.md); a confirmação vigente e
sua prova DEV + Preview 5/5 estão na [matriz Track O](../evidence/track-o.md#emenda-de-identidade--23092026) e na
[ADR-062 §11](../adr/062-identidade-consentimento-cadastro.md#11-emenda-de-23092026--confirmação-e-handoff-de-credencial).
O aceite humano não substitui essas provas, e os testes não substituem este julgamento.

> **Atualização de 25/09/2026.** O fluxo de confirmação agora separa o clique no link do handoff da
> credencial. O roteiro abaixo exige link **e** código de oito dígitos. Não use um Preview anterior a
> essa emenda: ele exercitaria a implementação substituída e produziria um aceite inválido. A prova
> técnica atual também impede outro draft de girar o link vivo e recupera falha transitória depois do
> OTP sem expor a referência na URL.

## O que você vai julgar

Três perguntas que nenhum teste responde:

1. os textos fazem sentido para quem **nunca viu o produto**?
2. a ordem das etapas é a que uma clínica real seguiria?
3. o tour explica o que **importa**, ou o que é fácil de explicar?

As três perguntas orientam o julgamento qualitativo. Só marque o Track O como aceito depois de
concluir todo o roteiro sem condição de parada. Se alguma resposta for "não", o que você anotar vira
trabalho — não vira "conhecido".

## Onde rodar, e por que não em produção

**Rode no Preview.** O Preview usa o **Sandbox** do Asaas e o banco DEV, então você pode percorrer o
funil inteiro sem criar assinatura em produção. O cadastro atual não solicita cartão: a primeira
fatura vence ao fim dos sete dias e o pagamento é hospedado pelo Asaas.

Em produção cada passagem cria **uma clínica de verdade e uma assinatura cobrada de verdade**. Não
use produção para aceitação, e se algum dia precisar, trate como operação com dinheiro: cancele a
assinatura e remova o tenant depois, com autorização e registro.

### Endereço

O Preview vigente da emenda, no
[PR #15](https://github.com/joaomarcos-techia/Project_OS/pull/15), é:

```
https://project-os-git-docs-funil-com-entrada-clinic-os-v2-s-projects.vercel.app/cadastro
```

O E2E automatizado executou os cinco cenários nesse alias em 5,5 min, com um worker, zero retry,
fingerprint do Auth e banco DEV e cleanup Auth/DB/fixture/lock zero. Isso torna o alvo válido para o
roteiro; não substitui a inspeção humana do inbox nem o julgamento de produto.

**Antes do merge técnico**, publique a revisão final da branch e use um Preview cujo detalhe mostre
exatamente esse SHA. O E2E automatizado de Preview é gate para o merge autorizado pelo owner. O aceite
humano pode ocorrer depois do merge, mas continua obrigatório antes de declarar o fluxo aceito como
produto; ele deve usar esse mesmo Preview e nunca produção. As flags
`SIGNUP_IDENTITY_ENABLED` e `SIGNUP_AUTH_ENABLED` já estão no escopo **Preview** do projeto
`project-os`; confira também que Supabase é DEV e Asaas é Sandbox antes do cadastro.

### O que ter em mãos

- **Login da Vercel** — o Preview é protegido; a primeira visita pede autenticação.
- **Um e-mail que você consiga abrir.** Use um alias consentido (`voce+aceite1@…`) e confirme pelo
  link recebido. **Não use e-mail de cliente.**
- **CPF/CNPJ sintético válido para o Sandbox.** Use a fixture aprovada do ambiente de teste.
  Não é necessário cartão para concluir o cadastro e iniciar o trial.

## O roteiro

Reserve ~20 minutos e faça de uma vez. Anote o que te fez hesitar, não só o que quebrou — hesitação é
o sinal que os testes não capturam.

### 1. Cadastro e handoff entre aparelhos

1. Abra `/cadastro` no computador, responda as quatro perguntas e informe identidade, e-mail, senha e
   aceite. Use o olho da senha uma vez e confirme que mostrar/ocultar não apaga o valor.
2. Envie. A tela deve ficar reduzida a “Aguardando a confirmação do e-mail”, uma frase e o botão
   discreto “Não recebeu? Reenviar o e-mail”. Ela não deve repetir aceite nem manter o formulário de
   identidade aberto.
3. Abra a mensagem em outro aparelho. Confira que ela traz **um link e um código de oito dígitos**.
   Não registre nem copie esses valores para a documentação.
4. Abra o link no celular. O destino deve mostrar apenas “E-mail confirmado”. Não deve abrir
   perguntas, revisão, plano ou checkout. Depois da ponte automática, a URL final deve estar limpa,
   sem token, tipo ou referência no querystring ou fragmento.
5. Volte à aba do computador. Ela deve reconhecer `email_verified` e pedir o código. O clique no
   celular, sozinho, não pode abrir `/cadastro/plano` nessa aba.
6. Digite primeiro um código incorreto. A aba deve permanecer no handoff, sem instalar a senha e sem
   mostrar plano. Depois informe o código correto.
7. A continuação correta deve instalar a senha, autenticar e só então abrir `/cadastro/plano`.

**Esperado durante as perguntas:** F5 ou reabrir a aba no mesmo navegador retoma a primeira pergunta
não respondida enquanto a sessão continuar válida. O rascunho impessoal local expira em até uma hora
e é apagado quando uma sessão nova é criada ou as respostas são salvas no servidor. Nome, e-mail,
senha e aceite não ficam em armazenamento local.

**Esperado depois de F5 no handoff:** como e-mail e senha existiam só na memória, a tela pede o mesmo
e-mail, uma nova senha e o código. O código continua sendo a prova de transferência; redigitar o
e-mail não o substitui. A senha aceita 8–72 caracteres, sem espaços, com maiúscula, minúscula e
número; símbolo é opcional.

**Verificação do reenvio:** repita o fluxo com outro alias. Na espera, solicite o reenvio após o
cooldown. A mensagem mais nova deve trazer link e código diferentes; a tentativa anterior deve ser
recusada, e apenas a nova pode concluir o handoff. Numa aba recarregada, clicar no reenvio revela
somente o campo de e-mail.

**Proteção e adoção por outro draft:** isto já passou no E2E DEV, mas pode ser observado no mesmo
Preview. Com o primeiro link ainda válido, inicie outro cadastro em janela privada usando o mesmo
e-mail e dados diferentes. A resposta pública não pode revelar a existência da conta, nenhuma segunda
mensagem deve chegar e o primeiro link/código deve continuar sendo o par válido. Depois de confirmar o
link, use o código original na segunda aba: somente ela deve concluir, com os dados e a senha desse
segundo draft. A primeira aba não pode alcançar plano. Esse controle é diferente do reenvio acima:
somente a própria sessão pode pedir rotação, enquanto o código autoriza a adoção explícita.

Um scanner que apenas abre o link por GET não deve consumi-lo, porque a credencial fica no fragmento
e a verificação ocorre por POST da ponte. Um scanner capaz de executar JavaScript ainda pode consumir
o OTP. Se o primeiro clique humano já chegar como expirado/inválido, registre o provedor de e-mail,
solicite um único reenvio e verifique se o link e o código novos funcionam; não classifique o primeiro
link como PASS.

**Julgue:** as quatro perguntas são as que você faria? Alguma parece intrusiva ou inútil para quem
ainda não confia no produto? A diferença entre “confirmar o e-mail” no celular e “continuar o
cadastro” no computador ficou clara sem explicar a implementação?

### 2. Plano e billing

Escolha o plano, informe CPF/CNPJ sintético e conclua a criação da assinatura.

Esta parte é deliberadamente humana e separada: o E2E técnico de confirmação para quando
`/cadastro/plano` abre. Um PASS naquele spec não diz que checkout, Asaas, webhook, reconciliação ou
provisionamento funcionaram nesta execução.

**Esperado:** nenhuma tela pede dado de cartão **dentro** do Qoro — quem coleta é o Asaas. Se você vir
um campo de cartão com a cara do Qoro, isso é um achado, e é grave.

**Julgue:** o preço e o que está incluído ficam claros antes de confirmar? Dá para saber o que
acontece no fim do trial?

### 3. Provisionamento

**Esperado:** chegar ao dashboard **já dentro da clínica criada**, sem passo manual, sem "aguarde um
e-mail", sem tela de configuração inicial.

**Julgue:** o tempo entre confirmar a assinatura e estar dentro é aceitável? O que aparece durante a espera explica o
que está acontecendo?

### 4. Onboarding

**Esperado:**

- o tour abre sozinho na primeira visita;
- "Pular" fecha e **não reabre** — nem na navegação seguinte, nem depois de um F5;
- recarregar no meio do tour volta **no mesmo passo**;
- "Refazer o tour", na central de ajuda, reabre **de onde parou**.

**Julgue:** o tour explica o que importa? Um psiquiatra que abriu a conta hoje sai dele sabendo o que
fazer primeiro?

### 5. Checklist de ativação

**Esperado:** os itens refletem o que **existe de fato** na clínica. Faça um de verdade — cadastre um
médico, por exemplo — e o item deve marcar sozinho, **sem nenhum clique no checklist**.

**Julgue:** os itens estão na ordem em que uma clínica real faria? Falta algum passo óbvio? Sobra
algum que não importa na primeira semana?

### 6. Ajuda

Abra `/documentacao` e navegue pelos nove tópicos.

**Esperado:** todos abrem; um endereço inventado devolve 404, não erro.

**Julgue:** você encontraria a resposta que procura? Os títulos são o que uma pessoa digitaria?

## Quando parar e chamar alguém

Pare imediatamente e registre, sem continuar, se:

- a aba do cadastro abrir plano ou checkout apenas porque o link foi clicado, antes do código;
- qualquer tela pedir **dado de cartão dentro do Qoro**;
- você chegar ao dashboard de **outra clínica** que não a sua;
- um erro `500` aparecer em qualquer passo;
- o tour reabrir depois de você ter pulado;
- um item do checklist marcar **sem** você ter feito a coisa correspondente.

Os seis são falhas de contrato, não de gosto. Há regressões específicas para isolamento de tenant,
falha conhecida do dashboard, persistência do tour e checklist derivado; elas não provam ausência de
`500` em todo o roteiro. Se o comportamento medido divergir, registre a divergência: a medição vence.

## Onde registrar

Anote em `docs/evidence/track-o.md`, na seção do O-7, com data e ambiente. Três estados bastam:
**aceito**, **aceito com ressalvas** (liste), **recusado** (diga o quê).

Não registre o e-mail usado, o código recebido, nem nada do cartão.

## Medição da campanha, fora deste roteiro

O Google Ads da landing está ligado. O tag carrega em `/comecar`, o evento de conversão é enfileirado
e a requisição sai para o Google antes da navegação. O encaminhamento automático por
`location.replace` não recebe `_gl`; o clique real na âncora de fallback recebe. Isso não afeta a
conversão registrada na landing hoje, porque o app ainda não carrega tag Google.

Este roteiro julga o produto. A chegada e a renderização do e-mail na caixa usada aqui são a evidência
humana que ainda falta; evento/API do Resend não as substitui. Medir a assinatura final no app e
confirmar atribuição no painel do Google Ads são tarefas separadas.
