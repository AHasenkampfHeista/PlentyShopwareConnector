/**
 * Create Tenant Script
 * Creates a new tenant with encrypted credentials from environment variables
 *
 * Required environment variables:
 * - TENANT_NAME: Name for the tenant
 * - PLENTY_API_URL: PlentyMarkets API URL (e.g., https://your-shop.plentymarkets-cloud01.com)
 * - PLENTY_USERNAME: PlentyMarkets username
 * - PLENTY_PASSWORD: PlentyMarkets password
 * - SHOPWARE_API_URL: Shopware API URL
 * - SHOPWARE_CLIENT_ID: Shopware integration client ID
 * - SHOPWARE_CLIENT_SECRET: Shopware integration client secret
 *
 * Usage:
 *   npx ts-node scripts/create-tenant.ts
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { encryptJSON } from '../src/utils/encryption';

async function main() {
  // Validate required environment variables
  const required = [
    'TENANT_NAME',
    'PLENTY_API_URL',
    'PLENTY_USERNAME',
    'PLENTY_PASSWORD',
    'SHOPWARE_API_URL',
    'SHOPWARE_CLIENT_ID',
    'SHOPWARE_CLIENT_SECRET',
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:');
    missing.forEach((key) => console.error(`  - ${key}`));
    console.error('\nPlease set these in your .env file or export them before running this script.');
    process.exit(1);
  }

  const tenantName = process.env.TENANT_NAME!;
  const plentyUrl = process.env.PLENTY_API_URL!;
  const plentyUsername = process.env.PLENTY_USERNAME!;
  const plentyPassword = process.env.PLENTY_PASSWORD!;
  const shopwareUrl = process.env.SHOPWARE_API_URL!;
  const shopwareClientId = process.env.SHOPWARE_CLIENT_ID!;
  const shopwareClientSecret = process.env.SHOPWARE_CLIENT_SECRET!;

  console.log('Creating tenant with the following configuration:');
  console.log(`  Name: ${tenantName}`);
  console.log(`  Plenty URL: ${plentyUrl}`);
  console.log(`  Plenty Username: ${plentyUsername}`);
  console.log(`  Shopware URL: ${shopwareUrl}`);
  console.log(`  Shopware Client ID: ${shopwareClientId}`);
  console.log('');

  // Encrypt credentials
  const plentyCredentials = encryptJSON({
    username: plentyUsername,
    password: plentyPassword,
  });

  const shopwareCredentials = encryptJSON({
    clientId: shopwareClientId,
    clientSecret: shopwareClientSecret,
  });

  // Create tenant
  const prisma = new PrismaClient();

  try {
    // Check if tenant with this name already exists
    const existing = await prisma.tenant.findFirst({
      where: { name: tenantName },
    });

    if (existing) {
      console.log(`Tenant "${tenantName}" already exists with ID: ${existing.id}`);
      console.log('Updating credentials...');

      const updated = await prisma.tenant.update({
        where: { id: existing.id },
        data: {
          plentyUrl,
          plentyCredentials,
          shopwareUrl,
          shopwareCredentials,
        },
      });

      console.log(`Tenant updated successfully!`);
      console.log(`  ID: ${updated.id}`);
    } else {
      const tenant = await prisma.tenant.create({
        data: {
          name: tenantName,
          plentyUrl,
          plentyCredentials,
          shopwareUrl,
          shopwareCredentials,
          status: 'ACTIVE',
        },
      });

      console.log('Tenant created successfully!');
      console.log(`  ID: ${tenant.id}`);
      console.log(`  Name: ${tenant.name}`);
      console.log(`  Status: ${tenant.status}`);
    }

    // Create default sync schedules
    const tenantId = existing?.id || (await prisma.tenant.findFirst({ where: { name: tenantName } }))!.id;

    const existingSchedules = await prisma.syncSchedule.findMany({
      where: { tenantId },
    });

    if (existingSchedules.length === 0) {
      console.log('\nCreating default sync schedules...');

      await prisma.syncSchedule.createMany({
        data: [
          {
            tenantId,
            syncType: 'CONFIG',
            cronSchedule: '0 * * * *', // Every hour at :00
            direction: 'PLENTY_TO_SHOPWARE',
            priority: 100,
            enabled: true,
          },
          {
            tenantId,
            syncType: 'PRODUCT_DELTA',
            cronSchedule: '15 * * * *', // Every hour at :15
            direction: 'PLENTY_TO_SHOPWARE',
            priority: 50,
            enabled: true,
          },
        ],
      });

      console.log('  - CONFIG sync: Every hour at :00');
      console.log('  - PRODUCT_DELTA sync: Every hour at :15');
    } else {
      console.log(`\nSync schedules already exist (${existingSchedules.length} schedules)`);
    }

    console.log('\nDone!');
  } catch (error) {
    console.error('Error creating tenant:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
