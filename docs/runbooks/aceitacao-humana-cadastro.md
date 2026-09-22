# Runbook — aceitação humana do cadastro autônomo

## Status

Canonical para **julgamento de produto**. A revalidação técnica e os limites de acesso aos painéis
estão em [revalidação de 21/09](../evidence/track-o-revalidacao-2026-09-21.md).
O aceite humano não substitui essas provas, e os testes não substituem este julgamento.

## O que você vai julgar

Três perguntas que nenhum teste responde:

1. os textos fazem sentido para quem **nunca viu o produto**?
2. a ordem das etapas é a que uma clínica real seguiria?
3. o tour explica o que **importa**, ou o que é fácil de explicar?

Se a resposta for "sim, sim, sim", o Track O está aceito. Se não, o que você anotar vira trabalho —
não vira "conhecido".

## Onde rodar, e por que não em produção

**Rode no Preview.** O Preview usa o **Sandbox** do Asaas e o banco DEV, então você pode percorrer o
funil inteiro sem criar assinatura em produção. O cadastro atual não solicita cartão: a primeira
fatura vence ao fim dos sete dias e o pagamento é hospedado pelo Asaas.

Em produção cada passagem cria **uma clínica de verdade e uma assinatura cobrada de verdade**. Não
use produção para aceitação, e se algum dia precisar, trate como operação com dinheiro: cancele a
assinatura e remova o tenant depois, com autorização e registro.

### Endereço

O Preview validado para as correções da revalidação é o da revisão `e0e8f15` do
[PR #15](https://github.com/joaomarcos-techia/Project_OS/pull/15):

```
https://project-cofoulm3e-clinic-os-v2-s-projects.vercel.app/cadastro
```

Depois do merge, use um Preview cuja revisão contenha o merge do PR #15. Se não houver um disponível,
gere um Preview dessa revisão e confirme no detalhe do deployment o commit e o ambiente. As flags
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

### 1. Cadastro

Abra `/cadastro` e responda as quatro perguntas de perfil. Depois informe a identidade e confirme o
e-mail pelo link recebido.

**Esperado:** durante as quatro perguntas, F5 ou reabrir a aba no mesmo navegador retoma a primeira
pergunta não respondida, enquanto a sessão continuar válida. O rascunho impessoal local expira em
até uma hora e é apagado quando uma sessão nova é criada ou as respostas são salvas no servidor.
Nome, e-mail, senha e aceite não ficam em armazenamento local: esses campos podem exigir
redigitação. Depois de confirmar o e-mail, inclusive em outro aparelho, as respostas completas
salvas são recuperadas pelo usuário verificado. A tela do primeiro aparelho consulta a confirmação
a cada 20 segundos, por até dez minutos; depois disso, use F5.

**Julgue:** as quatro perguntas são as que você faria? Alguma parece intrusiva ou inútil para quem
ainda não confia no produto?

### 2. Plano e billing

Escolha o plano, informe CPF/CNPJ sintético e conclua a criação da assinatura.

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
