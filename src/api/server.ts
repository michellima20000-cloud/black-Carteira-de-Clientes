import { buildApp } from './app';
import { loadConfig } from '../shared/config/env';

async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp({ config });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Encerrando API');
    await app.close();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: config.host, port: config.port });
}

start().catch((error: unknown) => {
  console.error('Não foi possível iniciar a API.', error);
  process.exit(1);
});
