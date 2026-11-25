import type { UserRole } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError } from '../../shared/http/app-error';
import type { TokenService } from '../../modules/auth/token.service';

export function registerAuthPlugin(app: FastifyInstance, tokens: TokenService): void {
  app.decorateRequest('authContext', null);

  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedError();
    }

    const token = authorization.slice('Bearer '.length).trim();
    const claims = await tokens.verifyAccessToken(token);
    request.authContext = {
      userId: claims.userId,
      accountId: claims.accountId,
      role: claims.role,
    };
  });

  app.decorate(
    'requireRoles',
    (roles: readonly UserRole[]) => async (request: FastifyRequest, _reply: FastifyReply) => {
      await app.authenticate(request, _reply);
      if (!request.authContext || !roles.includes(request.authContext.role)) {
        throw new ForbiddenError();
      }
    },
  );
}
