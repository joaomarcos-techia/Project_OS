import fs from 'node:fs';
import path from 'node:path';
import { format } from 'prettier';
import {
  collectInventory,
  publicEnvironmentDrift,
  renderInventory,
  routeTestDrift,
  type Inventory,
} from './inventory-lib';

const root = process.cwd();
const current = collectInventory(root);
const directory = path.join(root, 'docs/security');
const snapshotPath = path.join(directory, 'inventory-before.json');
const documentPath = path.join(directory, 'acoes.md');
if (process.argv.includes('--snapshot-before')) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(snapshotPath, `${JSON.stringify(current, null, 2)}\n`, { flag: 'wx' });
}
if (!fs.existsSync(snapshotPath))
  throw new Error('Capture o snapshot bruto primeiro: --snapshot-before');
const before: Inventory = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const document = await format(renderInventory(current, before), { parser: 'markdown' });
if (process.argv.includes('--write')) fs.writeFileSync(documentPath, document);
const unresolved = current.surfaces.filter((entry) => entry.guard === 'REVIEW_REQUIRED');
const publicEnv = publicEnvironmentDrift(current);
const routeTests = routeTestDrift(root, current, before);
console.info(
  JSON.stringify(
    {
      actions: current.surfaces.filter((entry) => entry.kind !== 'route').length,
      routeMethods: current.surfaces.filter((entry) => entry.kind === 'route').length,
      props: current.props.length,
      processEnv: current.environment.length,
      nextPublic: current.publicEnvironment.length,
      unresolved: unresolved.map((entry) => entry.id),
      publicEnv,
      routeTests,
    },
    null,
    2,
  ),
);
if (process.argv.includes('--check')) {
  if (
    !fs.existsSync(documentPath) ||
    fs.readFileSync(documentPath, 'utf8').replaceAll('\r\n', '\n') !== document
  ) {
    throw new Error('Inventário desatualizado. Revise o diff e rode inventory.ts --write.');
  }
  if (unresolved.length)
    throw new Error(`${unresolved.length} superfícies exigem revisão de guard.`);
  // Fase 3 — nasceu NEXT_PUBLIC_ sem dono, ou o registro descreve algo que o
  // código não faz mais. As duas direções reprovam: registro que envelhece
  // deixa de ser evidência e vira decoração.
  if (publicEnv.unregistered.length) {
    throw new Error(
      `NEXT_PUBLIC_ sem entrada em public-env-registry.ts: ${publicEnv.unregistered.join(', ')}`,
    );
  }
  if (publicEnv.stale.length) {
    throw new Error(
      `public-env-registry.ts declara nomes ausentes do código: ${publicEnv.stale.join(', ')}`,
    );
  }
  if (publicEnv.restricted.length) {
    throw new Error(
      `NEXT_PUBLIC_ marcado como 'restricted' continua no bundle: ${publicEnv.restricted.join(', ')}`,
    );
  }
  // Fase 3 — catraca de handler HTTP. Rota nova nasce com teste; rota que já
  // tinha não perde. Ver routeTestDrift para por que a regra não é retroativa.
  if (routeTests.missingForNew.length) {
    throw new Error(`Rota nova sem route.test.ts ao lado: ${routeTests.missingForNew.join(', ')}`);
  }
  if (routeTests.regressed.length) {
    throw new Error(`Rota perdeu o teste que já tinha: ${routeTests.regressed.join(', ')}`);
  }
}
