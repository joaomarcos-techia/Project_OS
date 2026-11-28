import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { PUBLIC_ENV_REGISTRY } from './public-env-registry';

export type Surface = {
  id: string;
  file: string;
  line: number;
  name: string;
  kind: 'action' | 'inline-action' | 'route';
  guard: string;
  evidence: string[];
};
export type Inventory = {
  surfaces: Surface[];
  props: { file: string; line: number; prop: string; actions: string[] }[];
  environment: { file: string; line: number; name: string; access: string }[];
  publicEnvironment: string[];
};

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const normalize = (value: string) => value.replaceAll('\\', '/');

function filesUnder(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesUnder(file);
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [file] : [];
  });
}

function hasServerDirective(statements: ts.NodeArray<ts.Statement>): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === 'use server') return true;
  }
  return false;
}

function bodyOf(node: ts.Node): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return node.body;
  }
  if (ts.isMethodDeclaration(node)) return node.body;
  if (ts.isVariableDeclaration(node)) return node.initializer;
  return undefined;
}

/** Static reachability is evidence for review, not proof that a guard dominates every path. */
export function collectInventory(root: string): Inventory {
  const rootFiles = filesUnder(path.join(root, 'src'))
    .filter((file) => !/\.(test|spec)\.[jt]sx?$/.test(file))
    .sort();
  const program = ts.createProgram(rootFiles, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    allowJs: true,
    skipLibCheck: true,
    baseUrl: root,
    paths: { '@/*': ['src/*'] },
  });
  const checker = program.getTypeChecker();
  const relative = (node: ts.Node) => normalize(path.relative(root, node.getSourceFile().fileName));
  const location = (node: ts.Node) => ({
    file: relative(node),
    line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
  });
  const resolveSymbol = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => {
    return symbol && symbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };
  const declarationOf = (node: ts.Node): ts.Declaration | undefined => {
    const symbol = resolveSymbol(checker.getSymbolAtLocation(node));
    return (
      symbol?.valueDeclaration ?? symbol?.declarations?.find((declaration) => bodyOf(declaration))
    );
  };
  const callCache = new Map<ts.Node, ts.CallExpression[]>();
  const callsOf = (node: ts.Node): ts.CallExpression[] => {
    const cached = callCache.get(node);
    if (cached) return cached;
    const calls: ts.CallExpression[] = [];
    const visit = (child: ts.Node) => {
      if (ts.isCallExpression(child)) calls.push(child);
      ts.forEachChild(child, visit);
    };
    const body = bodyOf(node);
    if (body) visit(body);
    callCache.set(node, calls);
    return calls;
  };
  const declarationName = (node: ts.Node): string => {
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isVariableDeclaration(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      return node.name.text;
    return `<inline:${location(node).line}>`;
  };
  const label = (node: ts.Node) =>
    `${relative(node)}:${location(node).line}#${declarationName(node)}`;
  const knownGuard = (node: ts.Node): string | undefined => {
    const file = relative(node);
    const name = declarationName(node);
    if (file === 'src/lib/auth/tenant-context.ts' && name === 'requireUser') return 'session';
    if (file === 'src/lib/auth/page-guard.ts' && name === 'resourceGate')
      return 'session-resource-gate';
    if (file === 'src/lib/http/cron-auth.ts' && name === 'assertCronAuth') return 'cron-token';
    if (file === 'src/lib/http/health-auth.ts' && name === 'healthAuthLevel')
      return 'health-token-or-admin';
    if (file === 'src/contexts/onboarding/internal/invites.ts' && name === 'resolveOpenInvite') {
      return 'invite-token';
    }
    return undefined;
  };
  const guardOf = (declaration: ts.Node): { guard: string; evidence: string[] } => {
    const queue: { node: ts.Node; chain: string[] }[] = [{ node: declaration, chain: [] }];
    const scheduled = new Set<ts.Node>([declaration]);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (!current) continue;
      const kind = knownGuard(current.node);
      if (kind) return { guard: kind, evidence: [...current.chain, label(current.node)] };
      for (const call of callsOf(current.node)) {
        const target = declarationOf(call.expression);
        if (target && relative(target).startsWith('src/') && !scheduled.has(target)) {
          scheduled.add(target);
          queue.push({ node: target, chain: [...current.chain, label(current.node)] });
        }
      }
    }
    return { guard: 'REVIEW_REQUIRED', evidence: [] };
  };

  const surfaces: Surface[] = [];
  const surfaceDeclarations = new Map<string, ts.Node>();
  const actionDeclarations = new Map<ts.Node, string[]>();
  const sources = rootFiles
    .map((file) => program.getSourceFile(file))
    .filter((file) => file !== undefined);
  for (const source of sources) {
    const serverModule = hasServerDirective(source.statements);
    const routeModule = /(?:^|\/)route\.[jt]s$/.test(normalize(source.fileName));
    if (serverModule || routeModule) {
      const moduleSymbol = checker.getSymbolAtLocation(source);
      for (const exported of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
        const symbol = resolveSymbol(exported);
        if (!symbol || !(symbol.flags & ts.SymbolFlags.Value)) continue;
        const declaration =
          symbol.valueDeclaration ?? symbol.declarations?.find((node) => bodyOf(node));
        if (!declaration || !bodyOf(declaration)) continue;
        if (routeModule && !METHODS.has(exported.name)) continue;
        const file = normalize(path.relative(root, source.fileName));
        const id = `${file}#${exported.name}`;
        surfaces.push({
          id,
          file,
          line: location(declaration).line,
          name: exported.name,
          kind: routeModule ? 'route' : 'action',
          ...guardOf(declaration),
        });
        surfaceDeclarations.set(id, declaration);
        if (serverModule)
          actionDeclarations.set(declaration, [...(actionDeclarations.get(declaration) ?? []), id]);
      }
    }
    const visit = (node: ts.Node) => {
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node)) &&
        node.body &&
        ts.isBlock(node.body) &&
        hasServerDirective(node.body.statements)
      ) {
        if (!actionDeclarations.has(node)) {
          const name = declarationName(node);
          const id = `${relative(node)}#${name}@${location(node).line}`;
          surfaces.push({ id, ...location(node), name, kind: 'inline-action', ...guardOf(node) });
          surfaceDeclarations.set(id, node);
          actionDeclarations.set(node, [id]);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // These are reviewed entrypoints with another trust boundary; none authorizes tenant CRUD.
  const publicPolicies: Record<string, { guard: string; call: string }> = {
    'src/app/(app)/(shell)/_painel/handoff-actions.ts#fetchOpenHandoffs': {
      guard: 'optional-session-read',
      call: 'getCurrentUser',
    },
    'src/app/(app)/login/actions.ts#loginAction': {
      guard: 'public-login',
      call: 'supabase.auth.signInWithPassword',
    },
    'src/app/(app)/login/actions.ts#forgotPasswordAction': {
      guard: 'public-recovery-request',
      call: 'assertPasswordResetAllowed',
    },
    'src/app/(app)/convite/actions.ts#acceptInviteAction': {
      guard: 'supabase-invite-session',
      call: 'supabase.auth.getUser',
    },
    'src/app/(app)/reset-password/actions.ts#resetPasswordAction': {
      guard: 'supabase-session-and-recovery-grant',
      call: 'readRecoveryGrant',
    },
    'src/app/(app)/login/mfa/actions.ts#verifyMfaAction': {
      guard: 'supabase-session-and-mfa',
      call: 'supabase.auth.getUser',
    },
    'src/app/(app)/login/mfa/actions.ts#switchAccountAction': {
      guard: 'public-local-session-clear',
      call: 'supabase.auth.signOut',
    },
    // S2 (requisito 83): renova só o registro de atividade da PRÓPRIA sessão, depois da porta única (sessão
    // bloqueada continua bloqueada); não lê nem escreve dado de clínica.
    'src/app/(app)/_lib/session-activity-actions.ts#registerSessionActivityAction': {
      guard: 'authenticate-own-session-activity-cookie',
      call: 'authenticate',
    },
    // S2: encerra a sessão local depois do bloqueio por inatividade (mesmo contrato do switchAccountAction).
    'src/app/(app)/_lib/session-activity-actions.ts#lockSessionAction': {
      guard: 'public-local-session-clear',
      call: 'supabase.auth.signOut',
    },
    'src/app/(app)/auth/confirm/route.ts#GET': {
      guard: 'public-static-confirmation-bridge',
      call: 'bridgeHtml',
    },
    'src/app/(app)/auth/confirm/route.ts#POST': {
      guard: 'same-origin-form-and-supabase-otp',
      call: 'supabase.auth.verifyOtp',
    },
    'src/app/(app)/cadastro/retomar/route.ts#GET': {
      guard: 'public-static-recovery-bridge-no-get-consumption-csp-hashes',
      call: 'signupRecoveryBridgeResponse',
    },
    'src/app/api/signup/recovery/consume/route.ts#POST': {
      guard: 'origin-limit-single-use-mail-proof-http-only-continuation',
      call: 'consumeSignupRecovery',
    },
    'src/app/api/signup/recovery/request/route.ts#POST': {
      guard: 'origin-resend-limit-obfuscated-existing-account-only',
      call: 'requestSignupRecovery',
    },
    'src/app/api/signup/sessions/destination/route.ts#GET': {
      guard: 'same-origin-limit-uniform-gone-no-account-read',
      call: 'assertSignupReadAllowed',
    },
    'src/app/api/signup/sessions/verify/route.ts#POST': {
      guard: 'origin-limit-cookie-email-code-expiry-attempts-cas',
      call: 'confirmSignupEmailCode',
    },
    // Pre-tenant admission is not requireUser(): the email/code proof happens
    // before a tenant exists. Route rejection tests and the real Auth/SQL
    // harness verify these exact services; never grant a generic signup bypass.
    'src/app/api/signup/pilot/route.ts#POST': {
      guard: 'private-flag-origin-limit-invitation-expiry-and-single-browser-session',
      call: 'bootstrapPilotSignup',
    },
    'src/app/api/signup/pilot/provision/route.ts#POST': {
      guard: 'private-flag-origin-limit-cookie-verified-auth-bound-identity-and-transaction',
      call: 'provisionPilotSignup',
    },
    'src/app/api/webhooks/resend/route.ts#POST': {
      guard: 'svix-hmac-expiry-body-cap-and-event-deduplication',
      call: 'verifyResendWebhook',
    },
    'src/app/(app)/auth/session-refresh/route.ts#GET': {
      guard: 'supabase-session-refresh',
      call: 'supabase.auth.getUser',
    },
    'src/app/(app)/logout/route.ts#POST': {
      guard: 'optional-session-logout',
      call: 'getCurrentUser',
    },
    'src/app/api/signup/sessions/route.ts#POST': {
      guard: 'public-signup-rate-limit-risk-and-cap',
      call: 'createSignupSession',
    },
    'src/app/api/signup/verificacao/route.ts#POST': {
      guard: 'closed-signup-expiry-origin-rate-limit-provider-proof-no-session',
      call: 'verifySignupTurnstileProbe',
    },
    'src/app/api/signup/sessions/me/route.ts#GET': {
      guard: 'signup-cookie-and-read-rate-limit',
      call: 'readSignupSession',
    },
    'src/app/api/signup/sessions/answers/route.ts#POST': {
      guard: 'signup-cookie-cas-and-read-rate-limit',
      call: 'recordSignupAnswers',
    },
    'src/app/api/signup/sessions/identity/route.ts#POST': {
      guard: 'SIGNUP_IDENTITY_ENABLED-origin-limit-cookie-cas',
      call: 'recordSignupIdentity',
    },
    'src/app/api/signup/sessions/email/route.ts#POST': {
      guard: 'origin-identity-limit-live-cookie-current-email-cas-unverified-idle-only',
      call: 'correctSignupEmail',
    },
    'src/app/api/signup/sessions/auth/route.ts#POST': {
      guard: 'SIGNUP_AUTH_ENABLED-origin-limit-cookie-cas',
      call: 'reserveSignupAuthAttempt',
    },
    'src/app/api/signup/sessions/resend/route.ts#POST': {
      guard: 'SIGNUP_AUTH_ENABLED-origin-resend-limit-cooldown-cas',
      call: 'reserveSignupResendAttempt',
    },
    'src/app/api/signup/sessions/continue/route.ts#POST': {
      guard: 'SIGNUP_AUTH_ENABLED-origin-cookie-identity-limit-code-cas',
      call: 'assertSignupContinuationAllowed',
    },
    'src/app/api/signup/password/route.ts#POST': {
      guard: 'origin-verified-pretenant-owner-hmac-limit-strict-password-epoch-cas',
      call: 'advanceSignupCredentialEpoch',
    },
    'src/app/api/signup/runtime-fingerprint/route.ts#POST': {
      guard: 'non-production-e2e-hmac-and-fresh-nonce',
      call: 'safeEqual',
    },
    'src/app/api/signup/draft/route.ts#GET': {
      guard: 'verified-pretenant-user-hmac-read-limit',
      call: 'readSignupDraft',
    },
    'src/app/api/signup/draft/route.ts#POST': {
      guard: 'origin-verified-pretenant-user-hmac-write-limit-cas',
      call: 'writeSignupDraft',
    },
    'src/app/api/signup/checkout/route.ts#POST': {
      guard: 'origin-verified-pretenant-user-hmac-write-limit-empty-body-cas',
      call: 'startSignupHostedCheckout',
    },
    'src/app/api/signup/checkout/status/route.ts#POST': {
      guard: 'origin-verified-pretenant-user-hmac-read-limit-provider-readback-cas',
      call: 'completeSignupHostedCheckout',
    },
    'src/app/api/signup/checkout/cancel/route.ts#POST': {
      guard: 'origin-verified-pretenant-user-hmac-write-limit-strict-body-provider-cancel-cas',
      call: 'abandonSignupHostedCheckout',
    },
    'src/app/api/signup/plan/route.ts#GET': {
      guard: 'verified-pretenant-user-hmac-read-limit',
      call: 'readSignupPlan',
    },
    'src/app/api/signup/plan/route.ts#PUT': {
      guard: 'origin-verified-pretenant-user-hmac-write-limit-cas',
      call: 'writeSignupPlan',
    },
    'src/app/api/webhooks/meta/route.ts#GET': { guard: 'meta-handshake-token', call: 'safeEqual' },
    'src/app/api/webhooks/meta/route.ts#POST': {
      guard: 'meta-hmac',
      call: 'provider.validateSignature',
    },
    'src/app/api/webhooks/asaas/route.ts#POST': {
      guard: 'asaas-shared-token',
      call: 'asaasProvider.validateWebhookToken',
    },
    'src/app/api/webhooks/abacatepay/route.ts#POST': {
      guard: 'abacatepay-secret-hmac-durable-inbox',
      call: 'createAbacatePayWebhookHandler',
    },
    'src/app/api/webhooks/asaas/patient/[ref]/route.ts#POST': {
      guard: 'asaas-tenant-token',
      call: 'safeEqual',
    },
  };
  for (const surface of surfaces) {
    const policy = publicPolicies[surface.id];
    if (!policy) continue;
    const declaration = surfaceDeclarations.get(surface.id);
    if (!declaration) continue;
    const matches: ts.CallExpression[] = [];
    const pending = [declaration];
    const visited = new Set<ts.Node>();
    while (pending.length) {
      const node = pending.shift();
      if (!node || visited.has(node)) continue;
      visited.add(node);
      for (const call of callsOf(node)) {
        if (call.expression.getText() === policy.call) matches.push(call);
        const target = declarationOf(call.expression);
        if (target && relative(target).startsWith('src/')) pending.push(target);
      }
    }
    if (matches.length) {
      surface.guard = policy.guard;
      surface.evidence = matches.map(
        (node) => `${location(node).file}:${location(node).line}#${policy.call}`,
      );
    }
  }

  const props: Inventory['props'] = [];
  const environment: Inventory['environment'] = [];
  const publicEnvironment = new Set<string>();
  const configurationFiles = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name) && !/\.test\./.test(entry.name),
    )
    .map((entry) => path.join(root, entry.name));
  const scripts = path.join(root, 'scripts');
  if (fs.existsSync(scripts)) configurationFiles.push(...filesUnder(scripts));
  const configurationSources = configurationFiles
    .sort()
    .map((file) =>
      ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true),
    );
  for (const source of [...sources, ...configurationSources]) {
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && /^NEXT_PUBLIC_[A-Z0-9_]+$/.test(node.text))
        publicEnvironment.add(node.text);
      if (ts.isStringLiteral(node) && /^NEXT_PUBLIC_[A-Z0-9_]+$/.test(node.text))
        publicEnvironment.add(node.text);
      if (
        (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
        node.expression.getText(source) === 'process.env'
      ) {
        const name = ts.isPropertyAccessExpression(node)
          ? node.name.text
          : node.argumentExpression && ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text
            : '<dynamic>';
        environment.push({ ...location(node), name, access: node.getText(source) });
      } else if (
        ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        node.initializer?.getText(source) === 'process.env'
      ) {
        for (const entry of node.name.elements) {
          environment.push({
            ...location(entry),
            name: (entry.propertyName ?? entry.name).getText(source),
            access: 'destructure process.env',
          });
        }
      } else if (
        ts.isPropertyAccessExpression(node) &&
        node.getText(source) === 'process.env' &&
        !ts.isPropertyAccessExpression(node.parent) &&
        !ts.isElementAccessExpression(node.parent) &&
        !(ts.isVariableDeclaration(node.parent) && ts.isObjectBindingPattern(node.parent.name))
      ) {
        environment.push({ ...location(node), name: '<object>', access: 'process.env' });
      }
      if (
        sources.includes(source) &&
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer)
      ) {
        const referenced = new Set<string>();
        const findActions = (child: ts.Node) => {
          const declaration = declarationOf(child);
          if (declaration)
            for (const id of actionDeclarations.get(declaration) ?? []) referenced.add(id);
          for (const id of actionDeclarations.get(child) ?? []) referenced.add(id);
          ts.forEachChild(child, findActions);
        };
        findActions(node.initializer);
        if (referenced.size)
          props.push({
            ...location(node),
            prop: node.name.getText(source),
            actions: [...referenced].sort(),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return {
    surfaces: surfaces.sort((a, b) => a.id.localeCompare(b.id)),
    props,
    environment,
    publicEnvironment: [...publicEnvironment].sort(),
  };
}

export function renderInventory(current: Inventory, before: Inventory): string {
  const old = new Map(before.surfaces.map((surface) => [surface.id, surface]));
  const actions = current.surfaces.filter((surface) => surface.kind !== 'route');
  const routes = current.surfaces.filter((surface) => surface.kind === 'route');
  const table = (items: Surface[]) =>
    [
      '| Arquivo:linha / export | Antes | Depois | Evidência estática |',
      '| --- | --- | --- | --- |',
      ...items.map(
        (surface) =>
          `| \`${surface.file}:${surface.line}#${surface.name}\` | ${old.get(surface.id)?.guard ?? 'NEW'} | ${surface.guard} | ${surface.evidence.map((entry) => `\`${entry}\``).join(' → ')} |`,
      ),
    ].join('\n');
  const removed = before.surfaces.filter(
    (surface) => !current.surfaces.some((entry) => entry.id === surface.id),
  );
  return [
    '# Inventário vivo de Server Actions, handlers e ambiente',
    '',
    'Gerado por `pnpm exec tsx scripts/security/inventory.ts --write`; validar com `--check`.',
    '',
    'Escopo: AST de arquivos JS/TS de runtime sob `src` (test/spec excluídos); leituras de ambiente também em `scripts` e arquivos JS/TS da raiz. Exports somente de valor; tipos não são endpoints. Métodos HTTP exportados; diretivas inline; referências de actions em props JSX resolvidas pelo TypeScript. Não lê nenhum arquivo `.env` nem imprime valores de ambiente.',
    '',
    '**Limite da evidência:** `session` significa caminho de chamadas resolvido até `requireUser`, não prova de que esse guard precede todo efeito em todo ramo. Exceções públicas listam a chamada revisada; presença não substitui teste de rejeição. Props indiretas por estado/spread, dispatch dinâmico e chamadas por reflexão exigem teste de runtime. `REVIEW_REQUIRED` bloqueia o check; não equivale automaticamente a vulnerabilidade.',
    '',
    `Contagem: ${actions.length} actions (${actions.filter((entry) => entry.kind === 'inline-action').length} inline); ${routes.length} métodos em ${new Set(routes.map((entry) => entry.file)).size} handlers; ${current.props.length} props com referência de action; ${current.environment.length} acessos diretos a process.env; ${current.publicEnvironment.length} nomes NEXT_PUBLIC.`,
    '',
    'O snapshot `inventory-before.json` registra o estado bruto inicial desta subfase. Não é regravado por `--write`. Correções de outras subfases podem preceder essa captura; não é apresentado como snapshot do HEAD original.',
    '',
    '## Server Actions',
    '',
    table(actions),
    '',
    '## Route handlers',
    '',
    table(routes),
    '',
    '## Superfícies removidas',
    '',
    ...removed.map((entry) => `- \`${entry.id}\`: ${entry.guard} → removida.`),
    '',
    '## Actions passadas por props',
    '',
    '| Arquivo:linha | Prop | Actions |',
    '| --- | --- | --- |',
    ...current.props.map(
      (entry) =>
        `| \`${entry.file}:${entry.line}\` | \`${entry.prop}\` | ${entry.actions.map((id) => `\`${id}\``).join(', ')} |`,
    ),
    '',
    '## Registro NEXT_PUBLIC',
    '',
    'Tudo aqui é inlinado no bundle do cliente. A coluna de justificativa vem de `scripts/security/public-env-registry.ts`; nome sem entrada (ou entrada sem nome no código) reprova `pnpm security:inventory`.',
    '',
    '| Nome | Dono | Uso | Exposição | Por quê |',
    '| --- | --- | --- | --- | --- |',
    ...current.publicEnvironment.map((name) => {
      const entry = PUBLIC_ENV_REGISTRY[name];
      if (!entry) return `| \`${name}\` | — | — | **SEM REGISTRO** | — |`;
      return `| \`${name}\` | ${entry.owner} | ${entry.purpose} | ${entry.exposure} | ${entry.rationale} |`;
    }),
    '',
    '## Acessos process.env (nomes, sem valores)',
    '',
    '| Arquivo:linha | Nome | Forma |',
    '| --- | --- | --- |',
    ...current.environment.map(
      (entry) =>
        `| \`${entry.file}:${entry.line}\` | \`${entry.name}\` | \`${entry.access.replaceAll('|', '\\|')}\` |`,
    ),
    '',
  ].join('\n');
}

/**
 * Deriva do inventário o desvio entre o que o código expõe no bundle e o que o
 * registro declara. Duas direções, porque as duas quebram a garantia:
 *   - `unregistered`: nasceu um NEXT_PUBLIC_ sem dono e sem justificativa;
 *   - `stale`: o registro afirma algo que o código não faz mais.
 */
export function publicEnvironmentDrift(current: Inventory): {
  unregistered: string[];
  stale: string[];
  restricted: string[];
} {
  const declared = Object.keys(PUBLIC_ENV_REGISTRY);
  return {
    unregistered: current.publicEnvironment.filter((name) => !PUBLIC_ENV_REGISTRY[name]),
    stale: declared.filter((name) => !current.publicEnvironment.includes(name)),
    // Uma entrada assinada como 'restricted' é um achado aberto, não um aceite.
    restricted: declared.filter(
      (name) =>
        PUBLIC_ENV_REGISTRY[name]?.exposure === 'restricted' &&
        current.publicEnvironment.includes(name),
    ),
  };
}

/**
 * Gate de catraca para handlers HTTP (Fase 3 — "rota nova sem teste").
 *
 * Por que catraca e não regra retroativa: das 32 rotas existentes, 9 têm teste
 * co-locado. Exigir teste das 32 hoje produziria ou 23 testes escritos às
 * pressas, ou uma allowlist de 23 linhas — que é o mesmo que não ter gate.
 * A regra que muda o futuro sem falsificar o passado tem duas direções:
 *
 *   - `missingForNew`: rota que NÃO existia no snapshot inicial precisa nascer
 *     com `route.test.ts` ao lado. É onde o próximo IDOR entraria.
 *   - `regressed`: rota que JÁ tinha teste não pode perdê-lo. Sem isto, apagar
 *     o teste é o caminho mais curto para escapar da primeira regra.
 *
 * O gate confere a EXISTÊNCIA do teste, não o que ele afirma. Um arquivo vazio
 * passa. Isso é dito de propósito: é uma catraca de processo, não prova de
 * isolamento — essa é do `pnpm security:tenant`.
 */
export function routeTestDrift(
  root: string,
  current: Inventory,
  before: Inventory,
): { missingForNew: string[]; regressed: string[] } {
  const baselineFiles = new Set(
    before.surfaces.filter((entry) => entry.kind === 'route').map((entry) => entry.file),
  );
  const currentFiles = [
    ...new Set(
      current.surfaces.filter((entry) => entry.kind === 'route').map((entry) => entry.file),
    ),
  ].sort();

  const hasTest = (file: string): boolean =>
    fs.existsSync(path.join(root, file.replace(/route\.[jt]s$/, 'route.test.ts')));

  return {
    missingForNew: currentFiles.filter((file) => !baselineFiles.has(file) && !hasTest(file)),
    regressed: currentFiles.filter(
      (file) => baselineFiles.has(file) && ROUTES_WITH_TESTS.has(file) && !hasTest(file),
    ),
  };
}

/**
 * Rotas que já tinham teste co-locado em 2026-09-10. Lista fechada: entrar nela
 * é opcional, sair não é.
 */
const ROUTES_WITH_TESTS = new Set([
  'src/app/(admin)/admin/clinicas/[id]/audit/export/route.ts',
  'src/app/(app)/(shell)/relatorios/contabilidade.csv/route.ts',
  'src/app/(app)/logout/route.ts',
  'src/app/api/cron/billing-reconcile/route.ts',
  'src/app/api/cron/financial-reconcile/route.ts',
  'src/app/api/cron/proactive-followup/route.ts',
  'src/app/api/webhooks/asaas/patient/[ref]/route.ts',
  'src/app/api/webhooks/asaas/route.ts',
  'src/app/api/webhooks/meta/route.ts',
]);
