// Side-effect import: validates env vars at the very start of any build/dev.
// If env is invalid, build fails with a clear Zod message before Next does anything.
import './src/lib/env';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Promoted from `experimental.typedRoutes` in Next 15.5 (no longer experimental).
  typedRoutes: true,
  // p-limit (usado pelo outbox worker) declara o subpath import Node `#async_hooks`
  // no seu package.json `imports`, que o webpack do Next NÃO resolve
  // ("Can't resolve '#async_hooks'") — quebrava `next build` e a rota
  // /api/cron/outbox em dev. Externalizar faz o Next usar require nativo do Node,
  // que resolve o subpath. Não altera lógica de C4 — só estratégia de bundling.
  serverExternalPackages: ['p-limit'],
};

export default nextConfig;
