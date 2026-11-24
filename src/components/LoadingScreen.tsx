export function LoadingScreen({ message = 'Preparando sua sessão...' }: { message?: string }) {
  return (
    <main className="loading-screen" aria-busy="true" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <p>{message}</p>
    </main>
  );
}
