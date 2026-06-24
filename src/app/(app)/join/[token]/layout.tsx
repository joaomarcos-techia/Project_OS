import type { ReactNode } from 'react';

// Base DS (.btn/.input/.field/.badge/.eyebrow…) + estilos do fluxo de ativação.
// Carregados só sob /join — não vazam para o resto do app. ds.css antes do flow
// para o flow poder sobrescrever (.flow-panel etc.).
import '../../(shell)/_painel/ds.css';
import './onboarding-flow.css';

export default function JoinLayout({ children }: { children: ReactNode }) {
  return children;
}
