import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock(import('node:child_process'), async (importOriginal) => ({
  ...(await importOriginal()),
  spawn: mocks.spawn,
}));
import {
  assertRestoreConfinement,
  RESTORE_IMAGE,
  streamIsolatedRestore,
} from '../../../scripts/security/gate-b-isolated-restore';

const name = 'qoro-gate-b1-012345abcdef';
function fixture() {
  return [
    {
      Name: '/' + name,
      State: { Running: true },
      Config: {
        Image: RESTORE_IMAGE,
        Labels: { 'qoro.recovery.scope': 'gate-b1' },
        Cmd: ['postgres', '-c', 'cron.launch_active_jobs=off'],
        Env: ['PGDATA=/var/lib/postgresql/data'],
      },
      Mounts: [],
      HostConfig: {
        Privileged: false,
        NetworkMode: 'none',
        PortBindings: {},
        LogConfig: { Type: 'none' },
        Tmpfs: { '/var/lib/postgresql/data': 'rw,size=1g', '/tmp': 'rw,size=128m' },
        Memory: 2_147_483_648,
        MemorySwap: 2_147_483_648,
      },
    },
  ];
}

describe('B1 isolated restore confinement', () => {
  it('accepts only the explicitly named private disposable container', () => {
    expect(() => assertRestoreConfinement(fixture(), name)).not.toThrow();
  });
  it.each([
    'network',
    'ports',
    'privileged',
    'logs',
    'data_mount',
    'tmp_mount',
    'swap',
    'label',
    'pgdata',
    'cron',
    'image',
    'name',
    'stopped',
    'duplicate',
    'invalid_name',
  ])('refuses unsafe or ambiguous confinement: %s', (kind) => {
    const containers = fixture();
    const value = containers[0]!;
    if (kind === 'network') value.HostConfig.NetworkMode = 'bridge';
    if (kind === 'ports') Object.assign(value.HostConfig.PortBindings, { '5432/tcp': [] });
    if (kind === 'privileged') value.HostConfig.Privileged = true;
    if (kind === 'logs') value.HostConfig.LogConfig.Type = 'json-file';
    if (kind === 'data_mount') value.HostConfig.Tmpfs['/var/lib/postgresql/data'] = '';
    if (kind === 'tmp_mount') value.HostConfig.Tmpfs['/tmp'] = '';
    if (kind === 'swap') value.HostConfig.MemorySwap += 1024;
    if (kind === 'label') value.Config.Labels['qoro.recovery.scope'] = 'other';
    if (kind === 'pgdata') value.Config.Env = ['PGDATA=/persistent'];
    if (kind === 'cron') value.Config.Cmd = ['postgres'];
    if (kind === 'image') value.Config.Image = 'postgres:17';
    if (kind === 'name') value.Name = '/another-container';
    if (kind === 'stopped') value.State.Running = false;
    if (kind === 'duplicate') containers.push(value);
    expect(() =>
      assertRestoreConfinement(containers, kind === 'invalid_name' ? 'prod' : name),
    ).toThrow();
  });
  it('refuses a persistent bind or volume even when tmpfs is also configured', () => {
    const containers = fixture();
    Object.assign(containers[0]!, { Mounts: [{ Type: 'volume' }] });
    expect(() => assertRestoreConfinement(containers, name)).toThrow();
  });
});

class ProcessDouble extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  kill = vi.fn(() => true);
  complete(code: number) {
    this.exitCode = code;
    this.emit('close', code);
  }
}
beforeEach(() => mocks.spawn.mockReset());

describe('encrypted restore binary pipe and exit codes (process doubles, not Docker proof)', () => {
  function pipeline(gpgCode: number, psqlCode: number) {
    const decrypt = new ProcessDouble(),
      restore = new ProcessDouble();
    const chunks: Buffer[] = [];
    const sql = Buffer.from('CREATE TABLE synthetic_note (label text);\n-- José 🚑\n', 'utf8');
    restore.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    restore.stdin.once('finish', () => restore.complete(psqlCode));
    decrypt.stdin.once('finish', () =>
      queueMicrotask(() => {
        decrypt.stderr.write('synthetic stderr must never be returned');
        decrypt.stdout.write(sql.subarray(0, sql.length - 3));
        decrypt.stdout.end(sql.subarray(sql.length - 3));
        decrypt.complete(gpgCode);
      }),
    );
    mocks.spawn.mockReturnValueOnce(decrypt).mockReturnValueOnce(restore);
    return { decrypt, restore, chunks, sql };
  }
  it('preserves UTF8 bytes across chunks without putting the passphrase in argv', async () => {
    const state = pipeline(0, 0);
    const passphrase = 'synthetic-passphrase-unit-only';
    expect(await streamIsolatedRestore('synthetic.sql.gpg', passphrase, name)).toEqual({
      gpg: 0,
      psql: 0,
    });
    expect(Buffer.concat(state.chunks)).toEqual(state.sql);
    expect(JSON.stringify(mocks.spawn.mock.calls)).not.toContain(passphrase);
    expect(state.decrypt.kill).toHaveBeenCalled();
    expect(state.restore.kill).toHaveBeenCalled();
  });
  it.each([
    [2, 0],
    [0, 3],
  ])('rejects gpg=%s,psql=%s rather than reporting success', async (gpg, psql) => {
    pipeline(gpg, psql);
    await expect(
      streamIsolatedRestore('synthetic.sql.gpg', 'synthetic', name),
    ).rejects.toMatchObject({
      gpg,
      psql,
    });
  });
  it.each(['', 'line\nbreak'])(
    'rejects invalid passphrase before starting processes',
    async (passphrase) => {
      await expect(streamIsolatedRestore('synthetic.sql.gpg', passphrase, name)).rejects.toThrow();
      expect(mocks.spawn).not.toHaveBeenCalled();
    },
  );
});
