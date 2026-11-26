/**
 * Verificação local do fluxo de QR Code do WhatsApp Web.
 *
 * Usa um banco "fake" (sem Postgres) para validar que:
 *  1. a sessão inicia sem erro;
 *  2. o QR Code é gerado;
 *  3. o QR permanece válido (a sessão não é reiniciada sozinha);
 *  4. o estado final é exposto corretamente.
 */
import { WhatsappSessionManager } from '../src/modules/whatsapp/qr-session.manager';
import type { DatabaseClient } from '../src/shared/db/prisma';

const fakeDatabase = {
  $queryRawUnsafe: async () => [],
  $executeRawUnsafe: async () => 0,
} as unknown as DatabaseClient;

async function main(): Promise<void> {
  const manager = new WhatsappSessionManager({
    database: fakeDatabase,
    encryptionKey: 'chave-de-teste-local-1234567890',
    logger: {
      info: (payload, message) => console.log('[info]', message ?? '', payload),
      warn: (payload, message) => console.log('[warn]', message ?? '', payload),
      error: (payload, message) => console.log('[error]', message ?? '', payload),
    },
  });

  const accountId = '00000000-0000-0000-0000-000000000001';

  console.log('1) iniciando a sessão...');
  const initial = await manager.start(accountId);
  console.log('   estado inicial:', initial.status);

  let qr: string | null = null;
  const started = Date.now();

  while (Date.now() - started < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const state = manager.getState(accountId);
    if (state.qr) {
      qr = state.qr;
      console.log('2) QR Code gerado:', qr.slice(0, 50), '...');
      break;
    }
    if (state.status === 'ERROR') {
      throw new Error(`Sessão em erro: ${state.error}`);
    }
  }

  if (!qr) {
    throw new Error('Timeout: o QR Code não foi gerado em 30s');
  }

  console.log('3) aguardando 8s para garantir que o QR não seja invalidado...');
  await new Promise((resolve) => setTimeout(resolve, 8_000));
  const stable = manager.getState(accountId);

  console.log('   estado:', stable.status, '| mesmo QR:', stable.qr === qr);

  if (stable.qr !== qr) {
    throw new Error('O QR Code foi invalidado sem solicitação (sessão reiniciando sozinha)');
  }

  console.log('4) desconectando...');
  await manager.disconnect(accountId);
  console.log('   estado final:', manager.getState(accountId).status);

  console.log('\nOK: fluxo de QR validado localmente.');
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('\nFALHOU:', error);
  process.exit(1);
});
