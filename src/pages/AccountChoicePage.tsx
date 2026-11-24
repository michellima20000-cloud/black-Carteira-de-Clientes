import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Brand } from '../components/Brand';
import { ErrorNotice } from '../components/ErrorNotice';

function accountInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

export function AccountChoicePage() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const accounts = session?.accounts ?? [];
  const [selectedAccountId, setSelectedAccountId] = useState(
    session?.account?.id ?? accounts[0]?.id ?? '',
  );
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAccount =
    accounts.find((account) => account.id === selectedAccountId) ?? accounts[0] ?? null;

  async function handleLogout() {
    setError(null);
    setIsSigningOut(true);

    try {
      await logout();
    } catch {
      setError('A sessão local foi encerrada, mas o servidor não confirmou a saída.');
    } finally {
      setIsSigningOut(false);
    }
  }

  function handleContinue() {
    if (selectedAccount) {
      void navigate('/app', { replace: true });
    }
  }

  return (
    <main className="account-page">
      <header className="account-page__header">
        <Brand />
        <button
          className="button button--quiet button--small"
          type="button"
          onClick={() => void handleLogout()}
          disabled={isSigningOut}
        >
          {isSigningOut ? 'Saindo...' : 'Sair'}
        </button>
      </header>

      <section className="account-card" aria-labelledby="account-choice-title">
        <div className="account-card__intro">
          <p className="eyebrow">Sessão iniciada</p>
          <h1 id="account-choice-title">Escolha sua conta</h1>
          <p>
            Olá, <strong>{session?.user.name}</strong>. Confirme a conta que deseja usar nesta
            sessão.
          </p>
        </div>

        {error && <ErrorNotice title="Saída concluída localmente" message={error} />}

        {accounts.length > 0 ? (
          <>
            <div className="account-list" role="radiogroup" aria-label="Contas disponíveis">
              {accounts.map((account) => {
                const isSelected = selectedAccount?.id === account.id;

                return (
                  <button
                    className={`account-option ${isSelected ? 'account-option--selected' : ''}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    key={account.id}
                    onClick={() => setSelectedAccountId(account.id)}
                  >
                    <span className="account-option__avatar" aria-hidden="true">
                      {accountInitials(account.name)}
                    </span>
                    <span className="account-option__content">
                      <strong>{account.name}</strong>
                      <span>Plano {account.plan}</span>
                    </span>
                    <span className="account-option__radio" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            {selectedAccount && (
              <dl className="account-details">
                <div>
                  <dt>Identificador</dt>
                  <dd>{selectedAccount.id}</dd>
                </div>
                <div>
                  <dt>Fuso horário</dt>
                  <dd>{selectedAccount.timezone}</dd>
                </div>
                <div>
                  <dt>Seu perfil</dt>
                  <dd>{session?.user.role}</dd>
                </div>
              </dl>
            )}

            <button
              className="button button--primary button--full"
              type="button"
              onClick={handleContinue}
              disabled={!selectedAccount}
            >
              Confirmar conta e continuar
              <span aria-hidden="true">→</span>
            </button>
          </>
        ) : (
          <div className="empty-state" role="status">
            <span className="empty-state__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 20v-1.5A3.5 3.5 0 0 1 7.5 15h9a3.5 3.5 0 0 1 3.5 3.5V20" />
                <circle cx="12" cy="8" r="4" />
              </svg>
            </span>
            <h2>Nenhuma conta disponível</h2>
            <p>
              Sua autenticação foi validada, mas não há uma conta vinculada a esta sessão. Fale com
              o administrador para liberar o acesso.
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void handleLogout()}
            >
              Encerrar sessão
            </button>
          </div>
        )}
      </section>

      <p className="account-page__security">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="10" width="14" height="10" rx="2" />
          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        </svg>
        Sua sessão é protegida e os tokens não são mantidos no armazenamento permanente.
      </p>
    </main>
  );
}
