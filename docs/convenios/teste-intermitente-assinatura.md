# Teste intermitente da tela de assinatura (`plan-change-form.test.tsx`) — diagnóstico

**Status: investigado, NÃO corrigido.** A tela e o teste são da assinatura (billing; área do agente do PR #53). Pela
orientação do fundador, o #55 não altera esse trabalho: aqui ficam a reprodução, as evidências e a recomendação. O teste
não foi silenciado, removido nem pulado, e a suíte local não é declarada "integralmente aprovada" enquanto ele falhar.

## Fatos

| Pergunta | Resposta |
| --- | --- |
| Arquivo | `src/app/(app)/(shell)/configuracoes/assinatura/plan-change-form.test.tsx` (ambiente `happy-dom`) e o componente `plan-change-form.tsx` |
| Origem | `main` (`01acc8f6` e anteriores). **Idênticos** na `main` (`5620a098`), no #53 (`e8309aee`) e no #55: blobs `7a273759` (teste) e `9c59b9c0` (componente) nos três |
| Frequência observada | 10 execuções completas registradas desde 08/11: 3 falhas (11/11 duas vezes, 12/11 uma), uma por execução, em **dois testes diferentes** |
| Tempo do arquivo | na suíte completa com cobertura de 12/11: **16.084 ms** para os 22 testes; isolado: **3.011 ms** (5,3 vezes mais lento) |
| Testes que falharam | "explica preço anual, próximo vencimento e cartão antes de agendar" (`Unable to find role="alert"`); "mostra imediatamente o link do Checkout proporcional devolvido pelo servidor" (`Unable to find role="link"…`) |
| Isolado | 22/22 em 3 execuções sem carga, 4 com 24 processos de CPU ocupados e 4 com cobertura V8 + carga (11/11 e 12/11) |

## O que os registros mostram

- No caso do "preço anual", o despejo do DOM no momento da falha já tem o **alerta de sucesso renderizado**, mas dentro
  de um container com `aria-hidden="true"`, e o `<body>` ainda com `data-scroll-locked` e `pointer-events: none`: o
  diálogo Radix ainda estava fechando. Para o Testing Library, um elemento sob `aria-hidden` não tem papel acessível;
  o `waitFor` esgotou o tempo antes de o diálogo terminar de fechar.
- No caso do link, o `findByRole('link')` esgotou o tempo antes da nova renderização com o link devolvido pela ação.
- Os dois passos são assíncronos (ação simulada → estado → nova renderização) e usam o tempo **padrão de 1 s** do
  Testing Library (`asyncUtilTimeout`): o projeto não o configura. O `testTimeout` de 30 s do `vitest.config.ts` não
  alcança essas esperas.

## Causa provável (com o que a evidência sustenta)

Asserções assíncronas presas ao limite padrão de 1 s, sob as paradas de laço de eventos da suíte completa com cobertura
(cerca de 620 arquivos em processos paralelos, instrumentação V8, `happy-dom`). Sustentam: falha só na suíte cheia,
cada vez num passo assíncrono diferente, com o DOM a meio caminho do estado esperado; nenhum estado compartilhado
entre testes que explique (os `mockResolvedValueOnce` são consumidos pelo próprio teste, na ordem do arquivo; o
`cleanup` roda depois de cada teste); o arquivo roda 5,3 vezes mais devagar na suíte cheia; e atrasar a ação além de
1 s reproduz a MESMA mensagem de erro de forma determinística (abaixo). **Não comprovado:** a lentidão da suíte cheia
não foi reproduzida sob demanda com carga sintética de CPU; a hipótese de estado compartilhado entre arquivos foi
descartada pelo isolamento por processo do Vitest.

## Reprodução mínima do mecanismo

A falha aparece de forma determinística sempre que o caminho ação → renderização passa de 1 s. Basta atrasar a
resolução da ação simulada além do limite padrão (sem mudar a lógica do componente):

```tsx
vi.mocked(requestPlanChangeAction).mockImplementationOnce(
  () => new Promise((resolve) => setTimeout(() => resolve({ error: null, success: 'upgrade_pending_payment',
    message: 'Pagamento proporcional de R$ 73,50 preparado no Asaas.', paymentUrl: 'https://sandbox.asaas.com/x' }), 1100)),
);
// … mesmo render e clique do teste original …
await screen.findByRole('link', { name: 'Abrir pagamento proporcional no Asaas' }); // falha: limite de 1 s
await screen.findByRole('link', { name: 'Abrir pagamento proporcional no Asaas' }, { timeout: 5000 }); // passa
```

O resultado da execução está em `evidence/tiss-ciclo-d24-pdf-2026-11-12/teste-intermitente-assinatura.log`.

## Recomendação para o dono da tela (sem enfraquecer o teste)

1. Dar folga às esperas assíncronas, do mesmo jeito que o `vitest.config.ts` já fez com o `testTimeout` pelo mesmo
   motivo: `configure({ asyncUtilTimeout: 5000 })` num setup dos testes de interface, ou `{ timeout: 5000 }` nas
   chamadas `findBy*`/`waitFor` desse arquivo. A asserção continua exigindo o mesmo elemento; só deixa de depender da
   velocidade da máquina.
2. No caso do diálogo, esperar primeiro o diálogo sumir (`await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())`)
   e só então procurar o alerta, como o teste de cancelamento do mesmo arquivo já faz.
3. Manter o teste obrigatório na suíte.

Situação na `main` e no #53: o arquivo e o componente são os mesmos, então o risco é o mesmo. As falhas registradas
foram todas na suíte local com cobertura; os logs de CI da `main` e do #53 não foram varridos atrás deste teste.
