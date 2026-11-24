const REFRESH_TOKEN_STORAGE_KEY = 'carteira-clientes.refresh-token';

let accessToken: string | null = null;

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Armazenamento temporário da sessão.
 *
 * O access token permanece somente na memória do módulo. Enquanto a API
 * continuar devolvendo o refresh token no corpo da resposta, ele fica no
 * sessionStorage para permitir a renovação ao recarregar a página. Quando o
 * backend passar a enviá-lo em um cookie HttpOnly, este método deve ser
 * removido e a API deve usar apenas o cookie.
 */
export const tokenStore = {
  getAccessToken(): string | null {
    return accessToken;
  },

  getRefreshToken(): string | null {
    try {
      return getSessionStorage()?.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  },

  saveTokens(tokens: { accessToken: string; refreshToken: string }): void {
    accessToken = tokens.accessToken;

    try {
      getSessionStorage()?.setItem(REFRESH_TOKEN_STORAGE_KEY, tokens.refreshToken);
    } catch {
      // A aplicação continua funcionando sem persistência entre recargas.
    }
  },

  clear(): void {
    accessToken = null;

    try {
      getSessionStorage()?.removeItem(REFRESH_TOKEN_STORAGE_KEY);
    } catch {
      // Nada a fazer: não há armazenamento disponível.
    }
  },
};
