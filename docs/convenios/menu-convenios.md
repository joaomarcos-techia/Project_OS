# Item "Convênios" no menu (R39) — integração preparada, aplicação depois da branch de UI

**Situação (12/11/2026):** a rota `/convenios` funciona (Painel, Solicitações, Guias, Lotes, Conciliação, Repasses).
O item de menu **não** foi acrescentado nesta branch: o menu é o registro `src/components/painel/modules.ts`, que a
branch `ui/refactor-qoro-20261108` (`e47ec2f0`) reescreve inteiro (campo `requires` por permissão, `navLabel`,
ícones novos). Não há ponto de extensão isolado: qualquer linha nossa nesse arquivo conflita com a reescrita. Nada do
worktree da UI foi tocado.

## Ponto de integração

No `MODULES` da branch de UI, grupo **Gestão**, logo depois de `financeiro`:

```ts
  {
    id: 'convenios',
    icon: 'shield',
    label: 'Convênios',
    group: 'Gestão',
    href: '/convenios',
    requires: PERMISSIONS.VIEW_FINANCIAL,
  },
```

- `requires` espelha o gate da página (`conveniosAccess` exige `VIEW_FINANCIAL`); o `modules.test.ts` da branch de UI
  confere essa correspondência.
- O ícone deve existir no conjunto da UI; se `shield` não existir, usar o mais próximo do design system (decisão da UI).

## Regra de exibição (orientação de 12/11, seção 4)

- **Ver o item** não é **poder operar**. O item aparece para quem tem `VIEW_FINANCIAL`.
- **Operar** continua barrado, no servidor e no banco, por:
  - assinatura paga e período verificável (D24, `qoro_premium_denial`);
  - plano que inclui Convênios;
  - permissão de gestão (`MANAGE_FINANCIAL`) nas ações;
  - módulo habilitado na clínica (`hi_clinic_settings.enabled`);
  - estado da clínica (suspensa = só preservação, D24-a).
- No trial, o item pode levar à página, que mostra o recurso como contratável. Nenhuma operação acontece: as ações e o
  banco recusam.

## Dependência

Aplicar depois do merge da branch de UI na `main` e do rebase do #55 sobre ela: um commit de uma entrada no `MODULES`
mais o teste de correspondência. Antes disso, o acesso é pelo endereço `/convenios` e pelos links internos.
