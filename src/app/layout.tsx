import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Hanken_Grotesk, IBM_Plex_Mono, Inter } from 'next/font/google';

import './globals.css';

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

// IBM Plex Mono não é variable font — pesos explícitos obrigatórios.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Qoro',
  description: 'O sistema operacional anti-vazamento da sua clínica.',
};

// Aplica o tema salvo antes da pintura — evita flash. Light é o default (ADR-031).
// Chave 'clinicaos-theme' = a mesma que os shells gravam; data-theme cobre o CSS legado.
const THEME_INIT = `try{if(localStorage.getItem('clinicaos-theme')==='dark'){var e=document.documentElement;e.classList.add('dark');e.setAttribute('data-theme','dark')}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${hanken.variable} ${inter.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
