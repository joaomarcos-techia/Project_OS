/**
 * Leitor PREGUIÇOSO do rastro TISS da clínica para a política de senha do perfil TISS (S3). O módulo do
 * Convênios só carrega quando a política está ligada e há clínica — os fluxos de senha não pagam o import do
 * banco à toa (e os testes deles continuam sem banco).
 */
export async function readTissFootprintLazy(
  clinicId: string,
): Promise<{ moduleEnabled: boolean; hasTissData: boolean }> {
  const { readClinicTissFootprint } =
    await import('@/contexts/health-insurance/security-footprint');
  return readClinicTissFootprint(clinicId);
}
