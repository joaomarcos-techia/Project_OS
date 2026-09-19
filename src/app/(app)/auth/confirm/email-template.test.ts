import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const template = readFileSync(
  resolve(process.cwd(), 'design_system/email-confirmar-cadastro.html'),
  'utf8',
);
const serverSideConfirmation =
  '{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=signup&amp;next=%2Fcadastro%2Fcontinuar';

describe('template de confirmação do cadastro', () => {
  it('troca o TokenHash no servidor e fixa o destino do O-3b', () => {
    expect(template.split(serverSideConfirmation)).toHaveLength(4);
    expect(template).not.toContain('{{ .ConfirmationURL }}');
  });
});
