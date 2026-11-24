import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '../api/authApi';
import { tokenStore } from '../api/tokenStore';

const refreshData = {
  accessToken: 'new-access-token',
  refreshToken: 'new-refresh-token',
  expiresIn: 900,
  user: {
    id: 'user-1',
    name: 'Ana Lima',
    email: 'ana@example.com',
    role: 'member',
    account: {
      id: 'account-1',
      name: 'Empresa Exemplo',
      plan: 'Essencial',
      timezone: 'America/Sao_Paulo',
    },
  },
  account: {
    id: 'account-1',
    name: 'Empresa Exemplo',
    plan: 'Essencial',
    timezone: 'America/Sao_Paulo',
  },
};

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ data }),
    text: async () => JSON.stringify({ data }),
  } as Response;
}

describe('cliente de autenticação', () => {
  beforeEach(() => {
    tokenStore.clear();
    window.sessionStorage.clear();
  });

  it('mantém o refresh token isolado no corpo de POST /auth/refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(refreshData));
    vi.stubGlobal('fetch', fetchMock);

    await expect(authApi.refresh('refresh-secreto')).resolves.toEqual(refreshData);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/auth/refresh');
    expect(request.method).toBe('POST');
    expect(request.credentials).toBe('include');
    expect(JSON.parse(request.body as string)).toEqual({ refreshToken: 'refresh-secreto' });
  });

  it('não persiste o access token em localStorage ou sessionStorage', () => {
    tokenStore.saveTokens({
      accessToken: 'access-secreto',
      refreshToken: 'refresh-secreto',
    });

    expect(tokenStore.getAccessToken()).toBe('access-secreto');
    expect(window.localStorage?.getItem('carteira-clientes.refresh-token') ?? null).toBeNull();
    expect(window.localStorage?.getItem('access-secreto') ?? null).toBeNull();
    expect(window.sessionStorage.getItem('access-secreto')).toBeNull();
    expect(window.sessionStorage.getItem('carteira-clientes.refresh-token')).toBe(
      'refresh-secreto',
    );
  });
});
