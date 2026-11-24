import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/AuthContext';

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function DashboardPage() {
  const { session } = useAuth();
  const user = session?.user;
  const account = session?.account;

  return (
    <AppShell>
      <header className="page-heading">
        <div>
          <p className="eyebrow">Visão geral</p>
          <h1>Olá, {firstName(user?.name ?? 'usuário')}.</h1>
          <p>Seu ambiente está pronto. Revise os dados da sessão abaixo.</p>
        </div>
        <span className="status-pill">
          <span aria-hidden="true" />
          Sessão ativa
        </span>
      </header>

      <section className="dashboard-grid" aria-label="Resumo da sessão">
        <article className="summary-card summary-card--accent">
          <span className="summary-card__label">Conta atual</span>
          <strong className="summary-card__value">{account?.name ?? 'Não selecionada'}</strong>
          <span className="summary-card__meta">Plano {account?.plan ?? '—'}</span>
          <span className="summary-card__illustration" aria-hidden="true">
            <svg viewBox="0 0 120 100">
              <path d="M18 28 88 10l14 52-70 20z" />
              <path d="m18 28 14 54 28-14 42-6" />
              <circle cx="57" cy="47" r="8" />
            </svg>
          </span>
        </article>

        <article className="summary-card">
          <span className="summary-card__label">Usuário conectado</span>
          <strong className="summary-card__value">{user?.name ?? '—'}</strong>
          <span className="summary-card__meta">{user?.email ?? '—'}</span>
        </article>

        <article className="summary-card">
          <span className="summary-card__label">Perfil de acesso</span>
          <strong className="summary-card__value">{user?.role ?? '—'}</strong>
          <span className="summary-card__meta">Autenticação ativa</span>
        </article>
      </section>

      <section className="welcome-card">
        <div className="welcome-card__copy">
          <span className="welcome-card__badge">Fase 1 concluída</span>
          <h2>Fundação segura e pronta para crescer.</h2>
          <p>
            Login, seleção de conta, renovação de sessão e área protegida já estão conectados à API.
            Os módulos de negócio entram nas próximas fases.
          </p>
        </div>
        <div className="welcome-card__checks" aria-label="Recursos disponíveis">
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
            Acesso protegido
          </span>
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
            Sessão persistente
          </span>
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m5 12 4 4L19 6" />
            </svg>
            Layout responsivo
          </span>
        </div>
      </section>
    </AppShell>
  );
}
