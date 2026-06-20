import { createHash } from 'node:crypto';

import stringify from 'safe-stable-stringify';
import { describe, expect, it, vi } from 'vitest';

import type { AuditEntryDTO } from '../dto';

const ROWS: AuditEntryDTO[] = [
  {
    id: 'a1',
    timestamp: '2026-06-01T10:00:00.000Z',
    userId: null,
    action: 'update_clinic',
    clinicId: 'c1',
    resourceType: 'clinic',
    resourceId: 'c1',
    ip: '1.2.3.4',
    result: 'ok',
  },
];

vi.mock('@react-pdf/renderer', () => ({
  Document: (p: { children?: unknown }) => p.children,
  Page: (p: { children?: unknown }) => p.children,
  Text: (p: { children?: unknown }) => p.children,
  View: (p: { children?: unknown }) => p.children,
  Image: () => null,
  StyleSheet: { create: (s: unknown) => s },
  renderToBuffer: async () => Buffer.from('%PDF-mock'),
}));

vi.mock('@/lib/storage/admin-exports', () => ({
  ADMIN_EXPORT_TTL_SECONDS: 604_800,
  uploadAdminExport: vi.fn(async () => {}),
  createSignedAdminExportUrl: vi.fn(async () => 'https://signed.example/admin-exports/x.pdf'),
}));

vi.mock('../repositories/audit.repo', () => ({
  AUDIT_EXPORT_MAX_ROWS: 5000,
  auditRepository: { findByClinicRange: async () => ROWS },
}));

vi.mock('@/lib/db', () => ({
  dbAdmin: {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ nome: 'Clínica X' }] }) }),
    }),
  },
}));

import { auditExportService } from './audit-export.service';

describe('AuditExportService (C15, AC-9) — SHA256 + signed URL', () => {
  it('gera hash determinístico sobre o conteúdo canônico e signed URL de 7 dias', async () => {
    const from = '2026-06-01T00:00:00.000Z';
    const to = '2026-06-30T23:59:59.999Z';

    const result = await auditExportService.run({ clinicId: 'c1', from, to });

    const expected = createHash('sha256')
      .update(stringify({ clinicId: 'c1', from, to, rows: ROWS }) ?? '')
      .digest('hex');

    expect(result.sha256).toBe(expected);
    expect(result.signedUrl).toBe('https://signed.example/admin-exports/x.pdf');
    expect(result.expiresInDays).toBe(7);
    expect(result.rowCount).toBe(1);
  });
});
