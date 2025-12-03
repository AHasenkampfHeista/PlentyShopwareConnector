#!/usr/bin/env tsx
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { encryptJSON } from '../packages/shared/src/utils/encryption';

const prisma = new PrismaClient();

async function main() {
  const tenantId = '00000000-0000-0000-0000-000000000001';

  const plentyCredentials = encryptJSON({
    username: 'devToolAlex',
    password: '#AKz$id9Ai&db&Ga',
  });

  const shopwareCredentials = encryptJSON({
    clientId: 'mock-client-id',
    clientSecret: 'mock-client-secret',
  });

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      plentyUrl: 'https://p18857.my.plentysystems.com',
      plentyCredentials,
      shopwareUrl: 'https://mock-shopware.local',
      shopwareCredentials,
    },
  });

  console.log('Tenant credentials updated successfully!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
