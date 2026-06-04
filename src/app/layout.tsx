import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';

import './globals.css';

export const metadata: Metadata = {
  title: 'ClinicaOS',
  description: 'O sistema operacional anti-vazamento da sua clínica.',
};

// Aplica o tema salvo antes da pintura — evita flash. Light é o default (DS / ADR-018).
const THEME_INIT = `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
