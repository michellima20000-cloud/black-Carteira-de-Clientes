import { describe, expect, it } from 'vitest';
import { TokenService } from '../../src/modules/auth/token.service';

const options = {
  issuer: 'test-issuer',
  audience: 'test-audience',
  accessSecret: 'a'.repeat(48),
  refreshSecret: 'b'.repeat(48),
  accessTtlSeconds: 900,
  refreshTtlDays: 7,
};

describe('TokenService', () => {
  it('assina e valida um access token com a conta do usuário', async () => {
    const service = new TokenService(options);
    const userId = '11111111-1111-4111-8111-111111111111';
    const accountId = '22222222-2222-4222-8222-222222222222';

    const token = await service.issueAccessToken(userId, accountId, 'OWNER');
    const claims = await service.verifyAccessToken(token);

    expect(claims).toEqual({ userId, accountId, role: 'OWNER' });
  });

  it('rejeita token adulterado', async () => {
    const service = new TokenService(options);
    const token = await service.issueAccessToken(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'OWNER',
    );

    await expect(service.verifyAccessToken(`${token}x`)).rejects.toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('não aceita refresh token como access token', async () => {
    const service = new TokenService(options);
    const refreshToken = await service.issueRefreshToken(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    );

    await expect(service.verifyAccessToken(refreshToken)).rejects.toMatchObject({
      statusCode: 401,
    });
  });
});
