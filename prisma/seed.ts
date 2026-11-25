import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const ALFA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const BETA_ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';

async function main(): Promise<void> {
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Defina SEED_PASSWORD com pelo menos 8 caracteres para executar o seed.');
  }

  const passwordHash = await argon2.hash(password);

  const alfa = await prisma.account.upsert({
    where: { id: ALFA_ACCOUNT_ID },
    update: { name: 'Conta Demo Alfa', timezone: 'America/Sao_Paulo' },
    create: {
      id: ALFA_ACCOUNT_ID,
      slug: 'conta-demo-alfa',
      name: 'Conta Demo Alfa',
      timezone: 'America/Sao_Paulo',
    },
  });

  const beta = await prisma.account.upsert({
    where: { id: BETA_ACCOUNT_ID },
    update: { name: 'Conta Demo Beta', timezone: 'America/Sao_Paulo' },
    create: {
      id: BETA_ACCOUNT_ID,
      slug: 'conta-demo-beta',
      name: 'Conta Demo Beta',
      timezone: 'America/Sao_Paulo',
    },
  });

  await prisma.user.upsert({
    where: { email: 'owner@demo.local' },
    update: { accountId: alfa.id, passwordHash, role: 'OWNER', active: true },
    create: {
      accountId: alfa.id,
      name: 'Marina Alfa',
      email: 'owner@demo.local',
      passwordHash,
      role: 'OWNER',
    },
  });

  await prisma.user.upsert({
    where: { email: 'owner2@demo.local' },
    update: { accountId: beta.id, passwordHash, role: 'OWNER', active: true },
    create: {
      accountId: beta.id,
      name: 'Bruno Beta',
      email: 'owner2@demo.local',
      passwordHash,
      role: 'OWNER',
    },
  });

  await prisma.customer.upsert({
    where: { accountId_phone: { accountId: alfa.id, phone: '5511999990001' } },
    update: { name: 'Cliente Alfa' },
    create: {
      accountId: alfa.id,
      name: 'Cliente Alfa',
      phone: '5511999990001',
      city: 'São Paulo',
    },
  });

  await prisma.customer.upsert({
    where: { accountId_phone: { accountId: beta.id, phone: '5511999990002' } },
    update: { name: 'Cliente Beta' },
    create: {
      accountId: beta.id,
      name: 'Cliente Beta',
      phone: '5511999990002',
      city: 'Campinas',
    },
  });

  console.info('Seed concluído: contas demo Alfa e Beta criadas.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
