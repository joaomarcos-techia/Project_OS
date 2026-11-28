# S-02 (middleware × server action sem cookie): testes de regressão para a frente de segurança da plataforma

**Decisão do fundador (15/11, noite):**
- `src/middleware.ts` **não** muda no PR #55;
- o achado segue com a frente de segurança da plataforma;
- um cabeçalho controlável pelo cliente (`Next-Action`) **não** é prova de autorização: o guard de cada server action
  continua obrigatório.

Diagnóstico completo: [handoff-ui.md §10.3](handoff-ui.md). Este arquivo entrega os testes. Nada foi aplicado. Não
estão no código, porque entrariam como SKIP ou reprovariam até a correção existir.

## O que qualquer correção precisa provar (independe da alternativa escolhida)

| # | Caso | Esperado |
| --- | --- | --- |
| 1 | GET de página protegida sem cookie | 307 para `/login` (igual a hoje) |
| 2 | POST comum (sem `Next-Action`) sem cookie | 307 para `/login` (igual a hoje) |
| 3 | POST com `Next-Action` sem cookie | resposta que o cliente do Next entende como "sessão terminou", **sem HTML** e sem a fronteira de erro "Algo deu errado" |
| 4 | POST com `Next-Action` **forjado** (id inexistente) sem cookie | nenhuma action executada; nada além do que um anônimo já obtém hoje |
| 5 | POST com `Next-Action` sem cookie numa action **financeira** (Caixa, cobrança, assinatura) | a própria action recusa: `requireUser` → `AuthError` → nada gravado, nenhuma chamada ao Asaas ou ao AbacatePay |
| 6 | POST com `Next-Action` e cookie legado | o legado é expirado (igual a hoje) |
| 7 | Origem cruzada (Origin ≠ Host) com `Next-Action` | recusado pelo Next (proteção CSRF das server actions), com ou sem cookie |
| 8 | Webhooks, cron e `api/health` | fora do `matcher` (iguais a hoje) |
| 9 | Toda action exportada | chama `authenticate()` (por `requireUser` ou equivalente). Varredura estática que reprova action nova sem guard. Sem isso, a mudança de middleware **não** pode entrar |
| 10 | Página renderizada depois da action, sem sessão | o guard da página redireciona (`requirePageUser`, `conveniosAccess`); nenhum dado de outra clínica no corpo |

## Esboço para `src/middleware.test.ts` (usa o `request()` do próprio arquivo)

```ts
function actionRequest(path: string, cookie?: string, actionId = 'a'.repeat(40)) {
  return new NextRequest(`https://qoro.test${path}`, {
    method: 'POST',
    headers: { 'next-action': actionId, ...(cookie ? { cookie } : {}) },
  });
}

it('GET sem cookie continua indo para o login', () => {
  const res = middleware(request('/convenios'));
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toMatch(/\/login$/u);
});

it('POST comum sem cookie continua indo para o login', () => {
  expect(middleware(request('/convenios', undefined, 'POST')).status).toBe(307);
});

it('POST de server action sem cookie não vira HTML de login (a action decide e recusa)', () => {
  const res = middleware(actionRequest('/convenios/guias/x'));
  // A alternativa escolhida define o formato; o que não pode é 307 para /login.
  expect(res.headers.get('location')).toBeNull();
});
```

## Prova no Preview (depois da correção, conta sintética)

1. Entrar.
2. Abrir uma guia em edição.
3. Apagar os cookies de sessão em outra aba, ou sair por outra aba.
4. Salvar os "Dados da consulta".
5. Esperado:
   - "Sua sessão terminou. Entre de novo para continuar." e ida ao `/login`;
   - nenhuma tela "Algo deu errado";
   - nenhum evento novo no Sentry;
   - nada gravado (versão da guia igual).
6. Repetir no Caixa (action financeira) e na Equipe.

## O que o TISS mantém enquanto isso

O executor de Convênios (`convenios/_lib/action-ui.tsx`):
- pega a falha sem resposta;
- sonda a sessão (`HEAD` sem seguir redirecionamento);
- com a sessão terminada, mostra a mensagem certa e leva ao login;
- caso contrário, diz que não deu para confirmar o registro.

Não é uma segunda correção do middleware: é tratamento local da tela, e continua útil depois da correção da
plataforma.
