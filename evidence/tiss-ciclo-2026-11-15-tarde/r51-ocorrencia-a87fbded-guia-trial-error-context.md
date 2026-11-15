# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: convenios-guide-states-preview.spec.ts >> trial no meio da sessão: o formulário já aberto não contorna o servidor; recarregada, a tela não oferece o ajuste
- Location: e2e\convenios-guide-states-preview.spec.ts:469:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message or use the non-minified dev environment for full errors and additional helpful warnings. @ /convenios/guias/5e2cca20-092c-40fb-9fd4-e0d7486e1b50",
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=f2e1]:
  - generic [ref=f2e2]:
    - link "Pular para o conteúdo" [ref=f2e3] [cursor=pointer]:
      - /url: "#qoro-main"
    - generic [ref=f2e4]:
      - complementary [ref=f2e5]:
        - link "Qoro — início" [ref=f2e7] [cursor=pointer]:
          - /url: /
          - img "Qoro" [ref=f2e8]
        - navigation "Navegação principal" [ref=f2e15]:
          - generic [ref=f2e16]:
            - generic [ref=f2e17]: Operação
            - link "Dashboard" [ref=f2e18] [cursor=pointer]:
              - /url: /dashboard
            - link "Agenda" [ref=f2e26] [cursor=pointer]:
              - /url: /agenda
            - link "Consultório" [ref=f2e31] [cursor=pointer]:
              - /url: /consultorio
          - generic [ref=f2e38]:
            - generic [ref=f2e39]: Clínico
            - link "Pacientes" [ref=f2e40] [cursor=pointer]:
              - /url: /pacientes
            - link "Documentos" [ref=f2e48] [cursor=pointer]:
              - /url: /documentos
          - generic [ref=f2e55]:
            - generic [ref=f2e56]: Gestão
            - link "Financeiro" [ref=f2e57] [cursor=pointer]:
              - /url: /financeiro
            - link "Caixa" [ref=f2e63] [cursor=pointer]:
              - /url: /caixa
            - link "Conversas IA" [ref=f2e69] [cursor=pointer]:
              - /url: /conversas
            - link "Relatórios" [ref=f2e74] [cursor=pointer]:
              - /url: /relatorios
          - generic [ref=f2e79]:
            - generic [ref=f2e80]: Administração
            - link "Equipe & Permissões" [ref=f2e81] [cursor=pointer]:
              - /url: /equipe
            - link "Configurações" [ref=f2e87] [cursor=pointer]:
              - /url: /configuracoes
            - link "Ajuda" [ref=f2e93] [cursor=pointer]:
              - /url: /documentação
        - generic [ref=f2e99]:
          - button "GE Gestora Sintética E2E Gestor" [ref=f2e100] [cursor=pointer]:
            - generic [ref=f2e101]: GE
            - generic [ref=f2e102]:
              - generic [ref=f2e103]: Gestora Sintética E2E
              - generic [ref=f2e104]: Gestor
          - generic [ref=f2e108]:
            - button "Tema claro. Alternar tema" [ref=f2e109] [cursor=pointer]: Tema claro
            - button "Sair" [ref=f2e116] [cursor=pointer]
      - main [ref=f2e121]:
        - generic [ref=f2e122]:
          - navigation "Trilha de navegação" [ref=f2e123]:
            - list [ref=f2e124]:
              - listitem [ref=f2e125]:
                - link "Convênios" [ref=f2e126] [cursor=pointer]:
                  - /url: /convenios
                - generic [ref=f2e127]: /
              - listitem [ref=f2e128]:
                - link "Guias" [ref=f2e129] [cursor=pointer]:
                  - /url: /convenios/guias
                - generic [ref=f2e130]: /
              - listitem [ref=f2e131]:
                - generic [ref=f2e132]: Guia de consulta nº 5
          - generic [ref=f2e134]:
            - heading "Guia de consulta nº 5" [level=1] [ref=f2e135]
            - paragraph [ref=f2e136]: Operadora Sintética E2E · Paciente Sintético E2E Um
        - alert [ref=f2e137]:
          - generic [ref=f2e140]:
            - text: Convênios faz parte das assinaturas ativas
            - generic [ref=f2e141]: "Convênios: este recurso está disponível para clínicas com assinatura ativa. Conheça os planos do Qoro para habilitar esta funcionalidade."
        - navigation "Navegação da seção" [ref=f2e142]:
          - link "Painel" [ref=f2e143] [cursor=pointer]:
            - /url: /convenios
          - link "Atendimentos" [ref=f2e144] [cursor=pointer]:
            - /url: /convenios/atendimentos
          - link "Solicitações" [ref=f2e145] [cursor=pointer]:
            - /url: /convenios/solicitacoes
          - link "Guias" [ref=f2e146] [cursor=pointer]:
            - /url: /convenios/guias
          - link "Lotes" [ref=f2e147] [cursor=pointer]:
            - /url: /convenios/lotes
          - link "Conciliação" [ref=f2e148] [cursor=pointer]:
            - /url: /convenios/conciliacao
          - link "Repasses" [ref=f2e149] [cursor=pointer]:
            - /url: /convenios/repasses
          - link "Carteirinhas" [ref=f2e150] [cursor=pointer]:
            - /url: /convenios/carteirinhas
          - link "Configuração" [ref=f2e151] [cursor=pointer]:
            - /url: /convenios/configuracao
        - generic [ref=f2e152]:
          - region "Situação da guia" [ref=f2e153]:
            - heading "Situação" [level=4] [ref=f2e155]
            - generic [ref=f2e156]:
              - generic [ref=f2e157]:
                - term [ref=f2e158]: Etapa
                - definition [ref=f2e159]:
                  - generic [ref=f2e160]: Para conferir
              - generic [ref=f2e161]:
                - term [ref=f2e162]: Valor
                - definition [ref=f2e163]: R$ 150,00
              - generic [ref=f2e164]:
                - term [ref=f2e165]: Lote
                - definition [ref=f2e166]: —
              - generic [ref=f2e167]:
                - term [ref=f2e168]: Revisão
                - definition [ref=f2e169]: "1"
            - button "Cancelar guia" [ref=f2e172] [cursor=pointer]
          - region "Pendências da guia" [ref=f2e173]:
            - heading "Pendências" [level=4] [ref=f2e175]
            - paragraph [ref=f2e176]: Nenhuma pendência de dado.
        - region "Dados da consulta" [ref=f2e177]:
          - heading "Dados da consulta" [level=4] [ref=f2e179]
          - generic [ref=f2e181]:
            - generic [ref=f2e182]:
              - term [ref=f2e183]: Regime de atendimento
              - definition [ref=f2e184]: "Padrão: 01 · Ambulatorial"
            - generic [ref=f2e185]:
              - term [ref=f2e186]: Indicação de acidente
              - definition [ref=f2e187]: "Padrão: 9 · Não Acidente"
            - generic [ref=f2e188]:
              - term [ref=f2e189]: Tipo de consulta
              - definition [ref=f2e190]: "Padrão: 1 · Primeira Consulta (2 se for retorno no prazo do contrato)"
            - generic [ref=f2e191]:
              - term [ref=f2e192]: Cobertura especial
              - definition [ref=f2e193]: Não informada
            - generic [ref=f2e194]:
              - term [ref=f2e195]: Saúde ocupacional
              - definition [ref=f2e196]: Não informada
            - generic [ref=f2e197]:
              - term [ref=f2e198]: Observação
              - definition [ref=f2e199]: Sem observação
        - region "Procedimentos da guia" [ref=f2e200]:
          - heading "Procedimentos" [level=4] [ref=f2e202]
          - table [ref=f2e204]:
            - rowgroup [ref=f2e205]:
              - row [ref=f2e206]:
                - columnheader "#" [ref=f2e207]
                - columnheader "Data" [ref=f2e208]
                - columnheader "Código" [ref=f2e209]
                - columnheader "Descrição" [ref=f2e210]
                - columnheader "Qtd." [ref=f2e211]
                - columnheader "Valor" [ref=f2e212]
            - rowgroup [ref=f2e213]:
              - row [ref=f2e214]:
                - cell "1" [ref=f2e215]
                - cell "01/10/2026" [ref=f2e216]
                - cell "22 · 10101012" [ref=f2e217]
                - cell "Consulta em consultório" [ref=f2e218]
                - cell "1" [ref=f2e219]
                - cell "R$ 150,00" [ref=f2e220]
        - region "Histórico da guia" [ref=f2e221]:
          - heading "Histórico" [level=4] [ref=f2e223]
          - list [ref=f2e224]:
            - listitem [ref=f2e225]:
              - generic [ref=f2e226]: 15/11/2026 ·
              - text: Para conferir
              - generic [ref=f2e227]: · Gestora Sintética E2E
  - alert [ref=f2e228]
```

# Test source

```ts
  395 |     ),
  396 |   );
  397 |   console.log(`títulos da guia: ${levels.join(' | ')}`);
  398 |   expect(levels.filter((l) => l.startsWith('h1:'))).toHaveLength(1);
  399 | 
  400 |   expect(await axe(s.page, '[data-testid="consulta-fields"]', 'painel-fechado')).toEqual([]);
  401 | 
  402 |   // Teclado: o botão abre o formulário com o foco no primeiro campo; Tab percorre na ordem visual.
  403 |   const open = region.getByRole('button', { name: 'Ajustar dados da consulta' });
  404 |   await open.focus();
  405 |   await s.page.keyboard.press('Enter');
  406 |   await expect(form(s.page)).toBeVisible();
  407 |   await expect(form(s.page).getByLabel('Regime de atendimento')).toBeFocused();
  408 |   const order: string[] = [];
  409 |   for (let i = 0; i < 7; i++) {
  410 |     await s.page.keyboard.press('Tab');
  411 |     order.push(await focusedName(s.page));
  412 |   }
  413 |   expect(order).toEqual([
  414 |     'Indicação de acidente',
  415 |     'Tipo de consulta',
  416 |     'Cobertura especial',
  417 |     'Saúde ocupacional',
  418 |     'Observação',
  419 |     'Salvar dados da consulta',
  420 |     'Voltar',
  421 |   ]);
  422 |   // A dica da observação (limite e aviso de CID) é a descrição acessível do campo.
  423 |   const describedBy = await form(s.page).getByLabel('Observação').getAttribute('aria-describedby');
  424 |   expect(describedBy).toBeTruthy();
  425 |   await expect(s.page.locator(`[id="${describedBy}"]`)).toHaveText(
  426 |     /^0\/500 \(padrão TISS\)\. Não escreva diagnóstico/u,
  427 |   );
  428 |   if (SHOTS)
  429 |     await s.page.screenshot({ path: `${SHOTS}/states-01b-formulario-teclado.png`, fullPage: true });
  430 |   expect(await axe(s.page, '[data-testid="consulta-fields"]', 'painel-aberto')).toEqual([]);
  431 | 
  432 |   // "Voltar" pelo teclado devolve o foco ao botão que abriu (nada foi salvo).
  433 |   await s.page.keyboard.press('Enter');
  434 |   await expect(form(s.page)).toHaveCount(0);
  435 |   await expect(open).toBeFocused();
  436 |   await expect(region.locator('[data-adjusted="true"]')).toHaveCount(0);
  437 | 
  438 |   // A página inteira da guia (conteúdo principal): qualquer violação reprova, MENOS o contraste, que
  439 |   // fica registrado na evidência. Em 15/11 o único achado é o selo âmbar do design system (`Badge`,
  440 |   // text-warning-700 sobre bg-warning-50: 4,44:1, mínimo 4,5:1), token da UI que a repaginação já
  441 |   // troca (handoff-ui.md §9.6). O painel do TISS (acima) exige zero violações, contraste incluído.
  442 |   // Depois do rebase com a UI, esta linha volta a exigir zero violações sem exceção.
  443 |   const main = await axe(s.page, 'main', 'pagina-guia');
  444 |   console.log(
  445 |     `axe pagina-guia (registro): ${JSON.stringify(main.map((v) => [v.id, v.nodes.map((n) => n.summary.split('\n').pop()?.trim())]))}`,
  446 |   );
  447 |   expect(
  448 |     main.filter((v) => v.id !== 'color-contrast'),
  449 |     JSON.stringify(main, null, 1),
  450 |   ).toEqual([]);
  451 |   expect(s.errors).toEqual([]);
  452 |   await s.context.close();
  453 | 
  454 |   // Celular: sem rolagem lateral, formulário aberto e o mesmo axe.
  455 |   const m = await login(browser, 'gestor', MOBILE);
  456 |   expect(await visit(m, g1())).toBe(200);
  457 |   await panel(m.page).getByRole('button', { name: 'Ajustar dados da consulta' }).click();
  458 |   await expect(form(m.page).getByLabel('Regime de atendimento')).toBeFocused();
  459 |   const overflow = await m.page.evaluate(
  460 |     () => document.documentElement.scrollWidth - window.innerWidth,
  461 |   );
  462 |   expect(overflow).toBeLessThanOrEqual(1);
  463 |   if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/states-01c-celular.png`, fullPage: true });
  464 |   expect(await axe(m.page, '[data-testid="consulta-fields"]', 'painel-celular')).toEqual([]);
  465 |   expect(m.errors).toEqual([]);
  466 |   await m.context.close();
  467 | });
  468 | 
  469 | test('trial no meio da sessão: o formulário já aberto não contorna o servidor; recarregada, a tela não oferece o ajuste', async ({
  470 |   browser,
  471 | }) => {
  472 |   test.setTimeout(360_000);
  473 |   const s = await login(browser, 'gestor');
  474 |   expect(await visit(s, g1())).toBe(200);
  475 |   captureConsultaAction(s.page, fx!.guides.ready1.id);
  476 |   await openAndPick(s.page);
  477 |   try {
  478 |     expect(setClinicState('trial').denial).toBe('trial');
  479 |     await saveButton(s.page).click();
  480 |     await expectRefusal(s.page, TRIAL_MSG);
  481 |     expect(await visit(s, g1(), 'states-02-trial')).toBe(200);
  482 |     await expect(s.page.getByTestId('convenios-commercial-notice')).toHaveAttribute(
  483 |       'data-denial',
  484 |       'trial',
  485 |     );
  486 |     await expect(
  487 |       panel(s.page).getByRole('button', { name: 'Ajustar dados da consulta' }),
  488 |     ).toHaveCount(0);
  489 |     await expect(s.page.getByRole('button', { name: 'Marcar como conferida' })).toHaveCount(0);
  490 |     await expect(panel(s.page).locator('[data-adjusted="true"]')).toHaveCount(0);
  491 |   } finally {
  492 |     expect(setClinicState('paid').denial).toBeNull();
  493 |   }
  494 |   expect(captured, 'a tela não chamou a server action do ajuste').not.toBeNull();
> 495 |   expect(s.errors).toEqual([]);
      |                    ^ Error: expect(received).toEqual(expected) // deep equality
  496 |   await s.context.close();
  497 | });
  498 | 
  499 | test('clínica suspensa no meio da sessão: recusa legível; recarregada, só consulta (cancelar continua disponível)', async ({
  500 |   browser,
  501 | }) => {
  502 |   test.setTimeout(360_000);
  503 |   const s = await login(browser, 'gestor');
  504 |   expect(await visit(s, g1())).toBe(200);
  505 |   await openAndPick(s.page);
  506 |   try {
  507 |     expect(setClinicState('suspended').denial).toBe('clinic_suspended');
  508 |     await saveButton(s.page).click();
  509 |     await expectRefusal(s.page, SUSPENDED_MSG);
  510 |     expect(await visit(s, g1(), 'states-03-suspensa')).toBe(200);
  511 |     await expect(s.page.getByTestId('convenios-commercial-notice')).toHaveAttribute(
  512 |       'data-denial',
  513 |       'clinic_suspended',
  514 |     );
  515 |     for (const name of ['Ajustar dados da consulta', 'Marcar como conferida', 'Aprovar e emitir'])
  516 |       await expect(s.page.getByRole('button', { name })).toHaveCount(0);
  517 |     await expect(s.page.getByRole('button', { name: 'Cancelar guia' })).toBeVisible();
  518 |   } finally {
  519 |     expect(setClinicState('paid').denial).toBeNull();
  520 |   }
  521 |   expect(s.errors).toEqual([]);
  522 |   await s.context.close();
  523 | });
  524 | 
  525 | test('sessão expirada com o formulário aberto: nada é salvo e a pessoa é levada a entrar de novo', async ({
  526 |   browser,
  527 | }) => {
  528 |   test.setTimeout(180_000);
  529 |   const s = await login(browser, 'gestor');
  530 |   expect(await visit(s, g1())).toBe(200);
  531 |   await openAndPick(s.page);
  532 |   await s.context.clearCookies();
  533 |   await saveButton(s.page).click();
  534 |   // Dois desfechos corretos: o servidor responde "sessão terminou" ou o proxy leva ao login.
  535 |   await expect
  536 |     .poll(
  537 |       async () => {
  538 |         if (new URL(s.page.url()).pathname.startsWith('/login')) return 'login';
  539 |         const alert = await form(s.page)
  540 |           .getByRole('alert')
  541 |           .textContent({ timeout: 500 })
  542 |           .catch(() => null);
  543 |         return alert ?? 'aguardando';
  544 |       },
  545 |       { timeout: 45_000 },
  546 |     )
  547 |     .toMatch(new RegExp(`^(login|${SESSION_MSG.replace(/[.]/gu, '\\.')})$`, 'u'));
  548 |   console.log(
  549 |     `sessão expirada: desfecho = ${new URL(s.page.url()).pathname.startsWith('/login') ? 'redirecionada ao login' : 'mensagem no formulário'}`,
  550 |   );
  551 |   await expect(s.page.getByText('Dados da consulta salvos')).toHaveCount(0);
  552 |   if (SHOTS)
  553 |     await s.page.screenshot({ path: `${SHOTS}/states-04-sessao-expirada.png`, fullPage: true });
  554 |   expect(s.errors).toEqual([]);
  555 |   await s.context.close(); // sem cookie "sb-": o cache da conta continua com a sessão anterior
  556 | });
  557 | 
  558 | test('código fora da terminologia por requisição adulterada: recusa legível, sem detalhe do banco', async ({
  559 |   browser,
  560 | }) => {
  561 |   test.setTimeout(180_000);
  562 |   const s = await login(browser, 'gestor');
  563 |   expect(await visit(s, g1())).toBe(200);
  564 |   let tampered = false;
  565 |   await s.page.route(`**${g1()}`, async (route) => {
  566 |     const req = route.request();
  567 |     const body = req.postData() ?? '';
  568 |     if (
  569 |       req.method() === 'POST' &&
  570 |       req.headers()['next-action'] &&
  571 |       body.includes('"tipoConsulta":"4"')
  572 |     ) {
  573 |       tampered = true;
  574 |       await route.continue({ postData: body.replace('"tipoConsulta":"4"', '"tipoConsulta":"44"') });
  575 |       return;
  576 |     }
  577 |     await route.continue();
  578 |   });
  579 |   await openAndPick(s.page);
  580 |   await saveButton(s.page).click();
  581 |   const alert = form(s.page).getByRole('alert');
  582 |   await expect(alert).toBeVisible({ timeout: 45_000 });
  583 |   expect(tampered, 'a requisição não foi adulterada (formato do corpo mudou?)').toBe(true);
  584 |   const text = (await alert.textContent()) ?? '';
  585 |   console.log(`código adulterado: "${text}"`);
  586 |   expect(text).toBe(
  587 |     'Tipo de consulta: código fora da terminologia da ANS. Escolha uma opção da lista.',
  588 |   );
  589 |   expect(text).not.toMatch(INTERNAL);
  590 |   await expect(s.page.getByText('Dados da consulta salvos')).toHaveCount(0);
  591 |   await s.page.unroute(`**${g1()}`);
  592 |   expect(await visit(s, g1())).toBe(200);
  593 |   await expect(panel(s.page).locator('[data-adjusted="true"]')).toHaveCount(0);
  594 |   expect(s.errors).toEqual([]);
  595 |   await s.context.close();
```