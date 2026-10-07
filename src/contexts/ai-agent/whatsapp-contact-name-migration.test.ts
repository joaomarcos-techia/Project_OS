import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0114_whatsapp_contact_name.sql'),
  'utf8',
);
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

describe('0114 — nome do perfil do contato do WhatsApp', () => {
  it('acrescenta só colunas cifradas, anuláveis e sem default', () => {
    expect(migration).toContain(
      'ALTER TABLE public.inbound_messages_raw\n  ADD COLUMN IF NOT EXISTS from_name_encrypted text;',
    );
    expect(migration).toContain(
      'ALTER TABLE public.ai_conversations\n  ADD COLUMN IF NOT EXISTS contact_name_encrypted text;',
    );
    // NOT NULL ou DEFAULT reescreveriam as linhas existentes; o nome nunca vai em claro.
    expect(migration).not.toMatch(/NOT NULL|DEFAULT/u);
    expect(migration).not.toMatch(/\bcontact_name\b(?!_encrypted)|\bfrom_name\b(?!_encrypted)/u);
  });

  it('registra o marcador e entra no journal depois da 0113', () => {
    expect(migration).toContain("VALUES ('0114-whatsapp-contact-name')");
    const previous = journal.entries.find((entry) => entry.idx === 113);
    const entry = journal.entries.find((candidate) => candidate.idx === 114);
    expect(entry?.tag).toBe('0114_whatsapp_contact_name');
    expect(entry && previous && entry.when > previous.when).toBe(true);
  });
});
