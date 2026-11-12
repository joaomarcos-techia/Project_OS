// Hook de resolução para harness que RENDERIZA PDF (@react-pdf) e também importa módulos com o
// marcador `server-only`. No Next, o @react-pdf é pacote EXTERNO (`serverExternalPackages`):
// roda com a resolução padrão do Node, sem a condição `react-server` — com ela, o `react`
// resolve para o build de servidor e o reconciliador do @react-pdf quebra. E a camada de servidor
// do Next resolve o marcador `server-only` para um módulo vazio. Este hook reproduz as duas
// coisas: só `server-only` vira módulo vazio; todo o resto resolve como no runtime.
//
//   NODE_OPTIONS="--import ./scripts/security/server-only-hook.mjs" npx tsx --tsconfig tsconfig.scripts.json <harness>
import { register } from 'node:module';

register(
  `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export%20%7B%7D', shortCircuit: true };
  return next(specifier, context);
}`)}`,
);
