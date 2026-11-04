# Proteção do formulário de primeira senha — 04/11/2026

## Problema confirmado

O E2E externo de recuperação de cadastro no Preview do PR #47 encontrou uma submissão
nativa do formulário de `/cadastro/confirmado` antes de o React instalar o handler.
Sem `method`, o navegador usa GET e pode colocar o campo `password` na URL.
O mesmo formulário existe na base `d5c623ac` de `main`.

A reprodução utilizou somente uma senha descartável e uma identidade sintética DEV,
posteriormente removida. Não há evidência nesta investigação de exposição de senha de
usuário real em Production. Nenhuma consulta ou alteração de conta real foi realizada
para este hotfix.

## Correção restrita

- Método HTML explicitamente POST, evitando o fallback GET.
- Campo, botão de visibilidade e envio indisponíveis até a hidratação instalar o handler.
- Instrução para habilitar JavaScript quando ele estiver desligado.
- Nenhuma migration, dependência, mudança de contrato, preço ou regra de autenticação.

| Antes | Depois |
| --- | --- |
| Campo e envio disponíveis no HTML inicial, sem método explícito. | Campo e envio bloqueados no HTML inicial, com POST explícito. |
| Uma submissão antecipada podia navegar com a senha na query. | A entrada aguarda o handler; a defesa HTML também evita GET. |

## Evidências iniciais

- **PASS 55/55:** testes de formulário, página e API de senha, incluindo renderização
  estática que exige POST e controles desabilitados antes da hidratação.
  Recibo local: `dist/password-safety-unit.json`.
- O E2E existente de confirmação em outro aparelho foi ampliado: abre a mesma sessão
  com JavaScript desligado e verifica as defesas no HTML entregue pelo Next; também
  observa, sem guardar URLs, se alguma requisição contém parâmetro `password`.
- A execução externa desse E2E e os checks do novo commit ainda precisam terminar.
  Código e teste adicionados não equivalem a PASS em Preview ou Production.

## Publicação

Correção separada do PR #47 para permitir revisão e publicação independente da nova
confirmação por código e da migration 0134. Preparação de Preview autorizada; publicação
de Production ainda exige autorização específica depois dos gates.
