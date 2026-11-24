import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';

export function NotFoundPage() {
  return (
    <main className="not-found">
      <Brand />
      <span className="not-found__code" aria-hidden="true">
        404
      </span>
      <h1>Página não encontrada</h1>
      <p>O endereço acessado não existe ou foi movido.</p>
      <Link className="button button--primary" to="/">
        Voltar ao início
      </Link>
    </main>
  );
}
