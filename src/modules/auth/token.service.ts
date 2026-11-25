import { createHash, randomUUID } from 'node:crypto';
import type { UserRole } from '@prisma/client';
import { jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { UnauthorizedError } from '../../shared/http/app-error';

const accessClaimsSchema = z.object({
  sub: z.string().uuid(),
  accountId: z.string().uuid(),
  role: z.enum(['OWNER', 'ADMIN', 'AGENT']),
  type: z.literal('access'),
});

const refreshClaimsSchema = z.object({
  sub: z.string().uuid(),
  accountId: z.string().uuid(),
  jti: z.string().uuid(),
  type: z.literal('refresh'),
});

export interface AccessClaims {
  userId: string;
  accountId: string;
  role: UserRole;
}

export interface RefreshClaims {
  userId: string;
  accountId: string;
  tokenId: string;
}

interface TokenOptions {
  issuer: string;
  audience: string;
  accessSecret: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
}

export class TokenService {
  private readonly accessKey: Uint8Array;
  private readonly refreshKey: Uint8Array;

  constructor(private readonly options: TokenOptions) {
    this.accessKey = new TextEncoder().encode(options.accessSecret);
    this.refreshKey = new TextEncoder().encode(options.refreshSecret);
  }

  async issueAccessToken(userId: string, accountId: string, role: UserRole): Promise<string> {
    return new SignJWT({ accountId, role, type: 'access' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1_000) + this.options.accessTtlSeconds)
      .sign(this.accessKey);
  }

  async issueRefreshToken(userId: string, accountId: string): Promise<string> {
    const tokenId = randomUUID();
    return new SignJWT({ accountId, type: 'refresh' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setJti(tokenId)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setIssuedAt()
      .setExpirationTime(
        Math.floor(Date.now() / 1_000) + this.options.refreshTtlDays * 24 * 60 * 60,
      )
      .sign(this.refreshKey);
  }

  async verifyAccessToken(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.accessKey, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['HS256'],
      });
      const claims = accessClaimsSchema.parse(payload);
      return { userId: claims.sub, accountId: claims.accountId, role: claims.role };
    } catch {
      throw new UnauthorizedError();
    }
  }

  async verifyRefreshToken(token: string): Promise<RefreshClaims> {
    try {
      const { payload } = await jwtVerify(token, this.refreshKey, {
        issuer: this.options.issuer,
        audience: this.options.audience,
        algorithms: ['HS256'],
      });
      const claims = refreshClaimsSchema.parse(payload);
      return { userId: claims.sub, accountId: claims.accountId, tokenId: claims.jti };
    } catch {
      throw new UnauthorizedError('Refresh token inválido ou expirado.');
    }
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  refreshExpiresAt(): Date {
    return new Date(Date.now() + this.options.refreshTtlDays * 24 * 60 * 60 * 1_000);
  }
}
