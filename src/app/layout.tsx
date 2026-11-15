import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { DM_Sans, Hanken_Grotesk, IBM_Plex_Mono, Inter, Manrope } from 'next/font/google';

import { RAIL_INIT } from '@/components/painel/rail-preference';

import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  display: 'swap',
});

// A tipografia das referências é aplicada apenas ao shell da clínica.
// O admin e as telas públicas continuam usando DM Sans.
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
// App da clínica v5 (nov/2026): Manrope nos títulos e números grandes, Inter no
// resto. As demais famílias continuam para admin, telas públicas e cadastro.
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
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
  // UX-008 (`docs/otimização_ui_final.md`): cada tela define só o próprio nome e
  // a aba mostra "Agenda · Qoro" (WCAG 2.4.2). Sem título próprio, fica "Qoro".
  title: { default: 'Qoro', template: '%s · Qoro' },
  description: 'O sistema operacional anti-vazamento da sua clínica.',
};

// Aplica o tema salvo antes da pintura — evita flash. Light é o default (ADR-031).
// Chave 'clinicaos-theme' = a mesma que os shells gravam; data-theme cobre o CSS legado.
const THEME_INIT = `try{var t=localStorage.getItem('clinicaos-theme');var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.setAttribute('data-theme',d?'dark':'light')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${dmSans.variable} ${plexMono.variable} ${hanken.variable} ${inter.variable} ${manrope.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {/* Menu fixado aberto no app da clínica, também antes da pintura. */}
        <script dangerouslySetInnerHTML={{ __html: RAIL_INIT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
