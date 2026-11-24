interface BrandProps {
  compact?: boolean;
  inverse?: boolean;
}

export function Brand({ compact = false, inverse = false }: BrandProps) {
  return (
    <div className={`brand ${inverse ? 'brand--inverse' : ''}`} aria-label="Carteira de Clientes">
      <svg className="brand__mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <rect width="48" height="48" rx="14" fill="currentColor" />
        <path
          d="M12.5 16.5A4.5 4.5 0 0 1 17 12h15.5A3.5 3.5 0 0 1 36 15.5V33a4 4 0 0 1-4 4H16a3.5 3.5 0 0 1-3.5-3.5v-17Z"
          fill="var(--brand-wallet)"
        />
        <path d="M12.5 21h23.5v7H12.5z" fill="var(--brand-paper)" />
        <circle cx="29.5" cy="24.5" r="2" fill="currentColor" />
        <path d="M16.5 32h8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      {!compact && (
        <span className="brand__text">
          <strong>Carteira</strong>
          <span>de Clientes</span>
        </span>
      )}
    </div>
  );
}
