import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { authApi, type AuthData, type AuthUser, type LoginCredentials } from '../api/authApi';
import { setUnauthorizedHandler } from '../api/http';
import { tokenStore } from '../api/tokenStore';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface AuthSession {
  user: AuthUser;
  account: AuthData['account'];
  accounts: NonNullable<AuthData['accounts']>;
}

interface AuthContextValue {
  status: AuthStatus;
  session: AuthSession | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeSession(data: AuthData): AuthSession {
  const primaryAccount = data.account ?? data.user.account ?? null;
  const accounts = data.accounts?.length ? data.accounts : primaryAccount ? [primaryAccount] : [];

  return {
    user: {
      ...data.user,
      account: data.user.account ?? primaryAccount,
    },
    account: primaryAccount,
    accounts,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const refreshInFlight = useRef<Promise<boolean> | null>(null);

  const requestRefresh = useCallback(async (): Promise<boolean> => {
    const refreshToken = tokenStore.getRefreshToken();

    if (!refreshToken) {
      setStatus('anonymous');
      setSession(null);
      return false;
    }

    try {
      const data = await authApi.refresh(refreshToken);
      tokenStore.saveTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      });
      setSession(normalizeSession(data));
      setStatus('authenticated');
      return true;
    } catch {
      tokenStore.clear();
      setSession(null);
      setStatus('anonymous');
      return false;
    }
  }, []);

  const refreshSession = useCallback((): Promise<boolean> => {
    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const pending = requestRefresh().finally(() => {
      if (refreshInFlight.current === pending) {
        refreshInFlight.current = null;
      }
    });

    refreshInFlight.current = pending;
    return pending;
  }, [requestRefresh]);

  useEffect(() => {
    if (!tokenStore.getRefreshToken()) {
      setStatus('anonymous');
      return;
    }

    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    setUnauthorizedHandler(() => refreshSession());

    return () => {
      setUnauthorizedHandler(null);
    };
  }, [refreshSession]);

  const login = useCallback(async (credentials: LoginCredentials): Promise<void> => {
    const data = await authApi.login(credentials);

    tokenStore.saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });

    try {
      const user = await authApi.me();
      const normalized = normalizeSession(data);
      setSession({
        ...normalized,
        user: {
          ...user,
          account: user.account ?? normalized.account,
        },
      });
      setStatus('authenticated');
    } catch (error) {
      tokenStore.clear();
      throw error;
    }
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = tokenStore.getRefreshToken();

    try {
      if (refreshToken) {
        await authApi.logout(refreshToken);
      }
    } finally {
      tokenStore.clear();
      setSession(null);
      setStatus('anonymous');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      login,
      logout,
      refreshSession,
    }),
    [login, logout, refreshSession, session, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider.');
  }

  return context;
}
