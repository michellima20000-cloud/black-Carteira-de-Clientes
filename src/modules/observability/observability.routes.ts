import process from 'node:process';
import type { FastifyInstance } from 'fastify';

export function registerObservabilityRoutes(app: FastifyInstance): void {
  app.get(
    '/system/metrics',
    { preHandler: app.requireRoles(['OWNER', 'ADMIN']) },
    () => {
      const memory = process.memoryUsage();
      const cpu = process.cpuUsage();

      return {
        data: {
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          memory: {
            heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 100) / 100,
            heapTotalMb: Math.round((memory.heapTotal / 1024 / 1024) * 100) / 100,
            rssMb: Math.round((memory.rss / 1024 / 1024) * 100) / 100,
            externalMb: Math.round((memory.external / 1024 / 1024) * 100) / 100,
          },
          cpu: {
            userMicroseconds: cpu.user,
            systemMicroseconds: cpu.system,
          },
          timestamp: new Date().toISOString(),
        },
      };
    },
  );
}
