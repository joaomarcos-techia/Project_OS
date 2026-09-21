# Runbook — aceitação humana do cadastro autônomo

## Status

Canonical. Este é o único passo do Track O que uma pessoa precisa executar, porque exige **julgamento
de produto**, não verificação. Tudo que é verificável já está coberto por teste, harness e gate.

A aceitação técnica está fechada: suíte 3979/3979, E2E autenticado 5/5 contra Preview, Sandbox 4/4,
webhook 9/9, carga e chaos verdes, banco de produção em 105 migrations. Nada aqui re-testa isso.

## O que você vai julgar

Três perguntas que nenhum teste responde:

1. os textos fazem sentido para quem **nunca viu o produto**?
2. a ordem das etapas é a que uma clínica real seguiria?
3. o tour explica o que **importa**, ou o que é fácil de explicar?

Se a resposta for "sim, sim, sim", o Track O está aceito. Se não, o que você anotar vira trabalho —
não vira "conhecido".

## Onde rodar, e por que não em produção

**Rode no Preview.** O Preview usa o **Sandbox** do Asaas e o banco DEV, então você pode percorrer o
funil inteiro, inclusive o cartão, sem criar cliente real nem cobrança real.

Em produção cada passagem cria **uma clínica de verdade e uma assinatura cobrada de verdade**. Não
use produção para aceitação, e se algum dia precisar, trate como operação com dinheiro: cancele a
assinatura e remova o tenant depois, com autorização e registro.

### Endereço

O Preview vive por branch. Se houver um PR aberto, use o link que o bot da Vercel comenta nele.
Enquanto o alias da branch do Track O existir, ele serve:

```
https://project-os-git-feature-clinic-plan-o4-clinic-os-v2-s-projects.vercel.app/cadastro
```

Se ele tiver expirado: abra qualquer PR (mesmo de uma linha em doc) e use o Preview dele. As flags
`SIGNUP_IDENTITY_ENABLED` e `SIGNUP_AUTH_ENABLED` já estão no escopo **Preview** do projeto
`project-os`, então qualquer Preview nasce com o cadastro aberto.

### O que ter em mãos

- **Login da Vercel** — o Preview é protegido; a primeira visita pede autenticação.
- **Um e-mail que você consiga abrir.** Use um descartável ou um alias (`voce+aceite1@…`). Vai chegar
  um código de confirmação. **Não use e-mail de cliente.**
- **O cartão de teste do Sandbox** (valor público do Asaas, não é segredo):

  | Campo | Valor |
  | --- | --- |
  | número | `4444444444444444` |
  | validade | `12/2030` |
  | CVV | `123` |
  | titular | qualquer nome |

  **Nunca use cartão real neste roteiro.** Se a tela pedir cartão e você estiver em produção por
  engano, pare.

## O roteiro

Reserve ~20 minutos e faça de uma vez. Anote o que te fez hesitar, não só o que quebrou — hesitação é
o sinal que os testes não capturam.

### 1. Cadastro

Abra `/cadastro` e responda as quatro perguntas de perfil. Depois informe a identidade e confirme o
e-mail com o código que chegar.

**Esperado:** cada passo retoma sozinho depois de um F5. Feche a aba no meio e volte: você deve cair
onde parou, não no começo.

**Julgue:** as quatro perguntas são as que você faria? Alguma parece intrusiva ou inútil para quem
ainda não confia no produto?

### 2. Plano e billing

Escolha o plano, informe CPF/CNPJ e conclua com o cartão de teste.

**Esperado:** nenhuma tela pede dado de cartão **dentro** do Qoro — quem coleta é o Asaas. Se você vir
um campo de cartão com a cara do Qoro, isso é um achado, e é grave.

**Julgue:** o preço e o que está incluído ficam claros antes de pedir o cartão? Dá para saber o que
acontece no fim do trial?

### 3. Provisionamento

**Esperado:** chegar ao dashboard **já dentro da clínica criada**, sem passo manual, sem "aguarde um
e-mail", sem tela de configuração inicial.

**Julgue:** o tempo entre pagar e estar dentro é aceitável? O que aparece durante a espera explica o
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

- qualquer tela pedir **dado de cartão dentro do Qoro**;
- você chegar ao dashboard de **outra clínica** que não a sua;
- um erro `500` aparecer em qualquer passo;
- o tour reabrir depois de você ter pulado;
- um item do checklist marcar **sem** você ter feito a coisa correspondente.

Os cinco são falhas de contrato, não de gosto. Os quatro últimos têm teste cobrindo — se aparecerem
mesmo assim, o teste está mentindo, e isso é mais importante que o achado em si.

## Onde registrar

Anote em `docs/evidence/track-o.md`, na seção do O-7, com data e ambiente. Três estados bastam:
**aceito**, **aceito com ressalvas** (liste), **recusado** (diga o quê).

Não registre o e-mail usado, o código recebido, nem nada do cartão.

## Medição da campanha, fora deste roteiro

O Google Ads da landing está ligado. O tag carrega em `/comecar`, o evento de conversão é enfileirado
e a requisição sai para o Google antes da navegação. O encaminhamento automático por
`location.replace` não recebe `_gl`; o clique real na âncora de fallback recebe. Isso não afeta a
conversão registrada na landing hoje, porque o app ainda não carrega tag Google.

Este roteiro julga o produto. Medir a assinatura final no app e confirmar atribuição no painel do
Google Ads são tarefas separadas.
