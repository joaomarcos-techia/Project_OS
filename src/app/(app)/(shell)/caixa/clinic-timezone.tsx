'use client';

import { createContext, useContext, type ReactNode } from 'react';

const ClinicTimeZone = createContext('America/Sao_Paulo');

/** Leva o fuso da clínica aos cartões sem atravessar a fila inteira por props. */
export function ClinicTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string;
  children: ReactNode;
}) {
  return <ClinicTimeZone.Provider value={timeZone}>{children}</ClinicTimeZone.Provider>;
}

export function useClinicTimeZone(): string {
  return useContext(ClinicTimeZone);
}

/** Hoje em `YYYY-MM-DD` no fuso da clínica, para comparar com `dueDate`. */
export function todayYmd(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}
