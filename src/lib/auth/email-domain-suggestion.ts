const COMMON_EMAIL_DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'icloud.com'];

/** Narrow typo hints, never DNS gating or silently replacing a legitimate custom domain. */
export function suggestEmailDomain(address: string): string | null {
  const parts = address.trim().split('@');
  const local = parts[0];
  const domain = parts[1]?.toLowerCase();
  if (parts.length !== 2 || !local || !domain || COMMON_EMAIL_DOMAINS.includes(domain)) return null;
  const match = COMMON_EMAIL_DOMAINS.find(
    (known) => domain.startsWith(known) && domain.length === known.length + 1,
  );
  const knownTypos: Readonly<Record<string, string>> = {
    'gamil.com': 'gmail.com',
    'gmial.com': 'gmail.com',
    'gmail.con': 'gmail.com',
    'gmail.co': 'gmail.com',
    'hotmai.com': 'hotmail.com',
    'hotmail.con': 'hotmail.com',
    'outlok.com': 'outlook.com',
    'outlook.con': 'outlook.com',
  };
  const suggested = match ?? knownTypos[domain];
  return suggested ? `${local}@${suggested}` : null;
}
