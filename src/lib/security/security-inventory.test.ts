import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  collectInventory,
  renderInventory,
  type Inventory,
} from '../../../scripts/security/inventory-lib';

describe('security inventory AST', () => {
  let root: string;
  let inventory: Inventory;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'qoro-security-inventory-'));
    const fixture: Record<string, string> = {
      'src/lib/auth/tenant-context.ts':
        'export async function requireUser() { throw new Error("unauthenticated"); }',
      'src/actions.ts': `
        'use server';
        import { requireUser as resolveUser } from './lib/auth/tenant-context';
        export type State = { error: string };
        export async function protectedAction() { await resolveUser(); return 1; }
        const indirect = async () => protectedAction();
        export { indirect as aliasAction };
        export async function openAction() { return process.env.NEXT_PUBLIC_TEST; }
      `,
      'src/fake.ts': 'export async function requireUser() { return null; }',
      'src/unprotected.ts': `
        'use server';
        import { requireUser } from './fake';
        export async function deceptiveAction() { return requireUser(); }
      `,
      'src/app/test/route.ts': `
        import { protectedAction } from '../../actions';
        export const runtime = 'nodejs';
        export const GET = async () => protectedAction();
        export async function helper() { return 0; }
        export async function POST() { return 1; }
      `,
      'src/page.tsx': `
        import { aliasAction as action } from './actions';
        import { requireUser } from './lib/auth/tenant-context';
        export default function Page() {
          async function save() { 'use server'; await requireUser(); }
          return <div><form action={action.bind(null)} /><Button saveAction={save} /></div>;
        }
      `,
      'src/environment.ts': `
        const { DATABASE_URL: database, NEXT_PUBLIC_OTHER } = process.env;
        const key = 'name';
        const one = process.env['SECRET_NAME'];
        const two = process.env[key];
        const all = process.env;
      `,
    };
    for (const [file, content] of Object.entries(fixture)) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    inventory = collectInventory(root);
  });
  afterAll(() => {
    // Only this fixture directory, created by mkdtemp above, is removed.
    if (root && path.basename(root).startsWith('qoro-security-inventory-')) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes exported actions and aliases but not type exports', () => {
    expect(
      inventory.surfaces.filter((entry) => entry.kind === 'action').map((entry) => entry.name),
    ).toEqual(['aliasAction', 'openAction', 'protectedAction', 'deceptiveAction']);
  });
  it('resolves imported and indirect guards by declaration, not by name', () => {
    expect(inventory.surfaces.find((entry) => entry.name === 'aliasAction')?.guard).toBe('session');
    expect(inventory.surfaces.find((entry) => entry.name === 'protectedAction')?.guard).toBe(
      'session',
    );
    expect(inventory.surfaces.find((entry) => entry.name === 'deceptiveAction')?.guard).toBe(
      'REVIEW_REQUIRED',
    );
    expect(inventory.surfaces.find((entry) => entry.name === 'openAction')?.guard).toBe(
      'REVIEW_REQUIRED',
    );
  });
  it('detects inline component actions and actions passed through JSX props and bind', () => {
    expect(inventory.surfaces.filter((entry) => entry.kind === 'inline-action')).toMatchObject([
      { name: 'save', guard: 'session' },
    ]);
    expect(inventory.props.map((entry) => entry.prop)).toEqual(['action', 'saveAction']);
    expect(inventory.props[0]?.actions).toEqual(['src/actions.ts#aliasAction']);
  });
  it('lists only HTTP exports from route files, including arrow handlers', () => {
    expect(inventory.surfaces.filter((entry) => entry.kind === 'route')).toMatchObject([
      { name: 'GET', guard: 'session' },
      { name: 'POST', guard: 'REVIEW_REQUIRED' },
    ]);
  });
  it('records property, bracket, dynamic, destructuring and whole-object environment reads', () => {
    expect(inventory.environment.map((entry) => entry.name)).toEqual([
      'NEXT_PUBLIC_TEST',
      'DATABASE_URL',
      'NEXT_PUBLIC_OTHER',
      'SECRET_NAME',
      '<dynamic>',
      '<object>',
    ]);
    expect(inventory.publicEnvironment).toEqual(['NEXT_PUBLIC_OTHER', 'NEXT_PUBLIC_TEST']);
  });
  it('changes the live document when an action, route, guard or public env entry changes', () => {
    const document = renderInventory(inventory, inventory);
    expect(renderInventory({ ...inventory, surfaces: [] }, inventory)).not.toBe(document);
    expect(
      renderInventory(
        { ...inventory, publicEnvironment: [...inventory.publicEnvironment, 'NEXT_PUBLIC_NEW'] },
        inventory,
      ),
    ).not.toBe(document);
    expect(
      renderInventory(
        {
          ...inventory,
          surfaces: inventory.surfaces.map((entry) => ({ ...entry, guard: 'REVIEW_REQUIRED' })),
        },
        inventory,
      ),
    ).not.toBe(document);
  });
});

it('does not expose the unused audit export metadata helper as a Server Action', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/app/(app)/(shell)/configuracoes/auditoria/actions.ts'),
    'utf8',
  );
  expect(source).not.toMatch(/export\s+async\s+function\s+auditExportLimits\b/);
  expect(source).toMatch(/export\s+async\s+function\s+exportAuditAction\b/);
});
