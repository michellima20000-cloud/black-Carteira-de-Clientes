import type { UserRole } from '@prisma/client';

export interface AuthContext {
  userId: string;
  accountId: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    authContext: AuthContext | null;
  }

  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRoles: (
      roles: readonly UserRole[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
