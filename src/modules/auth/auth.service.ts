import argon2 from 'argon2';
import type { Account, User, UserRole } from '@prisma/client';
import type { DatabaseClient } from '../../shared/db/prisma';
import { UnauthorizedError } from '../../shared/http/app-error';
import type { TokenService } from './token.service';

type UserWithAccount = User & { account: Account };

export interface AuthUserView {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  account: {
    id: string;
    name: string;
    plan: Account['plan'];
    timezone: string;
  };
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUserView;
}

export class AuthService {
  constructor(
    private readonly database: DatabaseClient,
    private readonly tokens: TokenService,
    private readonly accessTtlSeconds: number,
  ) {}

  async login(email: string, password: string): Promise<AuthSession> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.database.user.findUnique({
      where: { email: normalizedEmail },
      include: { account: true },
    });

    const passwordMatches = user
      ? await argon2.verify(user.passwordHash, password).catch(() => false)
      : false;

    if (!user || !passwordMatches || !user.active) {
      throw new UnauthorizedError('E-mail ou senha inválidos.');
    }

    return this.createSession(user);
  }

  async refresh(refreshToken: string): Promise<AuthSession> {
    const claims = await this.tokens.verifyRefreshToken(refreshToken);
    const tokenHash = this.tokens.hashToken(refreshToken);

    const storedToken = await this.database.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { account: true } } },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt <= new Date() ||
      storedToken.userId !== claims.userId ||
      storedToken.accountId !== claims.accountId ||
      !storedToken.user.active
    ) {
      throw new UnauthorizedError('Refresh token inválido ou expirado.');
    }

    const nextRefreshToken = await this.tokens.issueRefreshToken(
      storedToken.userId,
      storedToken.accountId,
    );

    const consumed = await this.database.$transaction(async (transaction) => {
      const update = await transaction.refreshToken.updateMany({
        where: { id: storedToken.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (update.count !== 1) return false;

      await transaction.refreshToken.create({
        data: {
          accountId: storedToken.accountId,
          userId: storedToken.userId,
          tokenHash: this.tokens.hashToken(nextRefreshToken),
          expiresAt: this.tokens.refreshExpiresAt(),
        },
      });
      return true;
    });

    if (!consumed) {
      throw new UnauthorizedError('Refresh token já foi utilizado.');
    }

    const accessToken = await this.tokens.issueAccessToken(
      storedToken.user.id,
      storedToken.accountId,
      storedToken.user.role,
    );

    return {
      accessToken,
      refreshToken: nextRefreshToken,
      expiresIn: this.accessTtlSeconds,
      user: this.toUserView(storedToken.user),
    };
  }

  async logout(accountId: string, refreshToken: string): Promise<void> {
    await this.database.refreshToken.updateMany({
      where: {
        accountId,
        tokenHash: this.tokens.hashToken(refreshToken),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  async getCurrentUser(userId: string, accountId: string): Promise<AuthUserView> {
    const user = await this.database.user.findFirst({
      where: { id: userId, accountId, active: true },
      include: { account: true },
    });
    if (!user) throw new UnauthorizedError();
    return this.toUserView(user);
  }

  private async createSession(user: UserWithAccount): Promise<AuthSession> {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.issueAccessToken(user.id, user.accountId, user.role),
      this.tokens.issueRefreshToken(user.id, user.accountId),
    ]);

    await this.database.refreshToken.create({
      data: {
        accountId: user.accountId,
        userId: user.id,
        tokenHash: this.tokens.hashToken(refreshToken),
        expiresAt: this.tokens.refreshExpiresAt(),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSeconds,
      user: this.toUserView(user),
    };
  }

  private toUserView(user: UserWithAccount): AuthUserView {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      account: {
        id: user.account.id,
        name: user.account.name,
        plan: user.account.plan,
        timezone: user.account.timezone,
      },
    };
  }
}
