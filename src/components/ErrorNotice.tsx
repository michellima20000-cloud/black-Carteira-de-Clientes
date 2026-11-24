interface ErrorNoticeProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorNotice({
  title = 'Não foi possível continuar',
  message,
  onRetry,
}: ErrorNoticeProps) {
  return (
    <div className="error-notice" role="alert">
      <span className="error-notice__icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button className="button button--quiet button--small" type="button" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
