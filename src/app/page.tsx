import { redirect } from 'next/navigation';

/**
 * Raiz (`/`) — não há landing pública; o ponto de entrada do produto é o login.
 * (A antiga tela "Camada 0" foi removida.) Usuário já autenticado: o /login
 * resolve o destino real (super_admin → /admin, demais → /dashboard).
 */
export default function HomePage() {
  redirect('/login');
}
