import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Brand } from './Brand';

interface AppShellProps {
  children: ReactNode;
}

function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function AppShell({ children }: AppShellProps) {
  const { session, logout } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const userName = session?.user.name ?? 'Usuário';
  const accountName = session?.account?.name ?? 'Sem conta';

  async function handleLogout() {
    setIsSigningOut(true);
    try {
      await logout();
    } catch {
      // O contexto já removeu os tokens locais, mesmo que a API tenha falhado.
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand inverse />

        <nav className="sidebar__nav" aria-label="Navegação principal">
          <p className="sidebar__label">Menu</p>
          <NavLink
            to="/app"
            className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1" />
              <rect x="14" y="4" width="6" height="6" rx="1" />
              <rect x="4" y="14" width="6" height="6" rx="1" />
              <rect x="14" y="14" width="6" height="6" rx="1" />
            </svg>
            Visão geral
          </NavLink>
          <NavLink
            to="/conta"
            className={({ isActive }) => `sidebar__link ${isActive ? 'sidebar__link--active' : ''}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20v-1.5A3.5 3.5 0 0 1 7.5 15h9a3.5 3.5 0 0 1 3.5 3.5V20" />
              <circle cx="12" cy="8" r="4" />
            </svg>
            Minha conta
          </NavLink>
        </nav>

        <div className="sidebar__account">
          <div className="avatar" aria-hidden="true">
            {initials(userName)}
          </div>
          <div className="sidebar__account-copy">
            <strong>{userName}</strong>
            <span>{accountName}</span>
          </div>
          <button
            className="icon-button icon-button--inverse"
            type="button"
            onClick={() => void handleLogout()}
            disabled={isSigningOut}
            aria-label="Sair da conta"
            title="Sair da conta"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 5H5v14h5" />
              <path d="M13 8l4 4-4 4M8 12h9" />
            </svg>
          </button>
        </div>
      </aside>

      <div className="app-shell__content">
        <header className="mobile-header">
          <Brand />
          <div className="avatar avatar--small" aria-label={`Usuário ${userName}`}>
            {initials(userName)}
          </div>
        </header>

        <nav className="mobile-nav" aria-label="Navegação móvel">
          <NavLink
            to="/app"
            className={({ isActive }) =>
              `mobile-nav__link ${isActive ? 'mobile-nav__link--active' : ''}`
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="4" y="4" width="6" height="6" rx="1" />
              <rect x="14" y="4" width="6" height="6" rx="1" />
              <rect x="4" y="14" width="6" height="6" rx="1" />
              <rect x="14" y="14" width="6" height="6" rx="1" />
            </svg>
            Painel
          </NavLink>
          <NavLink
            to="/conta"
            className={({ isActive }) =>
              `mobile-nav__link ${isActive ? 'mobile-nav__link--active' : ''}`
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20v-1.5A3.5 3.5 0 0 1 7.5 15h9a3.5 3.5 0 0 1 3.5 3.5V20" />
              <circle cx="12" cy="8" r="4" />
            </svg>
            Conta
          </NavLink>
          <button
            className="mobile-nav__link"
            type="button"
            onClick={() => void handleLogout()}
            disabled={isSigningOut}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 5H5v14h5" />
              <path d="M13 8l4 4-4 4M8 12h9" />
            </svg>
            Sair
          </button>
        </nav>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
