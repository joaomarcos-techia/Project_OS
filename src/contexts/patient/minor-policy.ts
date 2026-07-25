const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Regra pura: menor até a véspera do 18º aniversário. */
export function isMinorOnDate(dateOfBirth: string, referenceDate: string): boolean {
  const birth = ISO_DATE.exec(dateOfBirth);
  const reference = ISO_DATE.exec(referenceDate);
  if (!birth || !reference) return false;

  const birthYear = Number(birth[1]);
  const birthMonth = Number(birth[2]);
  const birthDay = Number(birth[3]);
  const refYear = Number(reference[1]);
  const refMonth = Number(reference[2]);
  const refDay = Number(reference[3]);
  const age =
    refYear -
    birthYear -
    (refMonth < birthMonth || (refMonth === birthMonth && refDay < birthDay) ? 1 : 0);
  return age < 18;
}

export function currentIsoDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
