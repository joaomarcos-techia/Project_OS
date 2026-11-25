// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({ exportAuditAction: vi.fn() }));

import { AuditExportForm } from './audit-export-form';

afterEach(cleanup);

describe('AuditExportForm', () => {
  it('usa as datas calculadas no fuso da clínica e não deixa escolher o futuro', () => {
    render(<AuditExportForm defaultFrom="2026-07-17" today="2026-08-16" />);
    const from = screen.getByLabelText('De') as HTMLInputElement;
    const to = screen.getByLabelText('Até') as HTMLInputElement;
    expect(from.value).toBe('2026-07-17');
    expect(to.value).toBe('2026-08-16');
    expect(from.max).toBe('2026-08-16');
    expect(to.max).toBe('2026-08-16');
  });
});
