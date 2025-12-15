/**
 * Manage Tenant Configuration Script
 * Manage key-value configuration for tenants
 *
 * Usage:
 *   npx ts-node scripts/manage-tenant-config.ts list <tenantId>
 *   npx ts-node scripts/manage-tenant-config.ts get <tenantId> <key>
 *   npx ts-node scripts/manage-tenant-config.ts set <tenantId> <key> <value> [description]
 *   npx ts-node scripts/manage-tenant-config.ts delete <tenantId> <key>
 *   npx ts-node scripts/manage-tenant-config.ts init <tenantId>  # Set up recommended defaults
 *
 * Well-known config keys:
 *   - plentyFrontendUrl: Plenty frontend URL for images (e.g., https://your-shop.plentymarkets.de)
 *   - defaultSalesPriceId: Sales price ID to use for Shopware's main price
 *   - rrpSalesPriceId: Sales price ID to use for RRP (list price)
 *   - taxMappings: JSON object mapping Plenty tax IDs to Shopware tax IDs
 *
 * Examples:
 *   npx ts-node scripts/manage-tenant-config.ts set abc123 plentyFrontendUrl "https://shop.plentymarkets.de"
 *   npx ts-node scripts/manage-tenant-config.ts set abc123 defaultSalesPriceId 1
 *   npx ts-node scripts/manage-tenant-config.ts set abc123 taxMappings '{"0":"sw-tax-19","1":"sw-tax-7"}'
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Well-known configuration keys with descriptions
const KNOWN_KEYS: Record<string, string> = {
  plentyFrontendUrl: 'Plenty frontend URL for image URLs (e.g., https://your-shop.plentymarkets.de)',
  defaultSalesPriceId: 'Sales price ID to use for Shopware main price (number)',
  rrpSalesPriceId: 'Sales price ID to use for RRP/list price (number)',
  taxMappings: 'JSON object mapping Plenty tax IDs to Shopware tax IDs',
};

async function listConfigs(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  console.log(`\nConfiguration for tenant: ${tenant.name} (${tenantId})\n`);

  const configs = await prisma.tenantConfig.findMany({
    where: { tenantId },
    orderBy: { key: 'asc' },
  });

  if (configs.length === 0) {
    console.log('No configurations set.\n');
    console.log('Recommended keys to configure:');
    for (const [key, desc] of Object.entries(KNOWN_KEYS)) {
      console.log(`  - ${key}: ${desc}`);
    }
    console.log('\nRun with "init" command to set up interactive defaults.');
    return;
  }

  console.log('Current configuration:');
  console.log('-'.repeat(80));

  for (const config of configs) {
    const valueStr = typeof config.value === 'object'
      ? JSON.stringify(config.value)
      : String(config.value);
    const truncatedValue = valueStr.length > 50 ? valueStr.substring(0, 47) + '...' : valueStr;

    console.log(`  ${config.key}:`);
    console.log(`    Value: ${truncatedValue}`);
    if (config.description) {
      console.log(`    Description: ${config.description}`);
    }
    console.log(`    Updated: ${config.updatedAt.toISOString()}`);
    console.log('');
  }

  // Show unconfigured recommended keys
  const configuredKeys = new Set(configs.map(c => c.key));
  const unconfigured = Object.entries(KNOWN_KEYS).filter(([key]) => !configuredKeys.has(key));

  if (unconfigured.length > 0) {
    console.log('\nRecommended keys not yet configured:');
    for (const [key, desc] of unconfigured) {
      console.log(`  - ${key}: ${desc}`);
    }
  }
}

async function getConfig(tenantId: string, key: string) {
  const config = await prisma.tenantConfig.findUnique({
    where: {
      tenantId_key: { tenantId, key },
    },
  });

  if (!config) {
    console.error(`Configuration not found: ${key}`);
    process.exit(1);
  }

  console.log(`\nKey: ${config.key}`);
  console.log(`Value: ${JSON.stringify(config.value, null, 2)}`);
  if (config.description) {
    console.log(`Description: ${config.description}`);
  }
  console.log(`Updated: ${config.updatedAt.toISOString()}`);
}

async function setConfig(tenantId: string, key: string, valueStr: string, description?: string) {
  // Verify tenant exists
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  // Parse value - try JSON first, then number, then string
  let value: unknown;
  try {
    value = JSON.parse(valueStr);
  } catch {
    // Not JSON, try number
    const num = Number(valueStr);
    if (!isNaN(num) && valueStr.trim() !== '') {
      value = num;
    } else {
      // Use as string
      value = valueStr;
    }
  }

  // Use known key description if not provided
  const desc = description || KNOWN_KEYS[key];

  const config = await prisma.tenantConfig.upsert({
    where: {
      tenantId_key: { tenantId, key },
    },
    create: {
      tenantId,
      key,
      value: value as object,
      description: desc,
    },
    update: {
      value: value as object,
      ...(desc && { description: desc }),
    },
  });

  console.log(`\nConfiguration set successfully!`);
  console.log(`  Key: ${config.key}`);
  console.log(`  Value: ${JSON.stringify(config.value)}`);
  console.log(`  Type: ${typeof value}`);
  if (config.description) {
    console.log(`  Description: ${config.description}`);
  }
}

async function deleteConfig(tenantId: string, key: string) {
  try {
    await prisma.tenantConfig.delete({
      where: {
        tenantId_key: { tenantId, key },
      },
    });
    console.log(`\nConfiguration deleted: ${key}`);
  } catch {
    console.error(`Configuration not found: ${key}`);
    process.exit(1);
  }
}

async function initDefaults(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) {
    console.error(`Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  console.log(`\nInitializing configuration for tenant: ${tenant.name}\n`);

  // Check existing configs
  const existing = await prisma.tenantConfig.findMany({
    where: { tenantId },
  });
  const existingKeys = new Set(existing.map(c => c.key));

  // Get cached sales prices to help with configuration
  const salesPrices = await prisma.plentySalesPrice.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' },
  });

  if (salesPrices.length > 0) {
    console.log('Available sales prices from Plenty:');
    console.log('-'.repeat(60));
    for (const sp of salesPrices) {
      const names = sp.names as Record<string, string> || {};
      const name = names['de'] || names['en'] || Object.values(names)[0] || 'Unknown';
      console.log(`  ID: ${sp.id} | Type: ${sp.type.padEnd(10)} | Name: ${name}`);
    }
    console.log('');
  } else {
    console.log('No sales prices cached yet. Run a CONFIG sync first to see available prices.\n');
  }

  // Show what would be configured
  console.log('Recommended configuration to set:');
  console.log('-'.repeat(60));

  for (const [key, desc] of Object.entries(KNOWN_KEYS)) {
    const status = existingKeys.has(key) ? '[ALREADY SET]' : '[NOT SET]';
    console.log(`  ${key} ${status}`);
    console.log(`    ${desc}`);
    console.log('');
  }

  console.log('\nTo set a configuration value, run:');
  console.log(`  npx ts-node scripts/manage-tenant-config.ts set ${tenantId} <key> <value>`);
  console.log('\nExamples:');
  console.log(`  npx ts-node scripts/manage-tenant-config.ts set ${tenantId} plentyFrontendUrl "https://your-shop.plentymarkets.de"`);

  if (salesPrices.length > 0) {
    const defaultPrice = salesPrices.find(sp => sp.type === 'default') || salesPrices[0];
    const rrpPrice = salesPrices.find(sp => sp.type === 'rrp');

    console.log(`  npx ts-node scripts/manage-tenant-config.ts set ${tenantId} defaultSalesPriceId ${defaultPrice.id}`);
    if (rrpPrice) {
      console.log(`  npx ts-node scripts/manage-tenant-config.ts set ${tenantId} rrpSalesPriceId ${rrpPrice.id}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage:');
    console.log('  npx ts-node scripts/manage-tenant-config.ts list <tenantId>');
    console.log('  npx ts-node scripts/manage-tenant-config.ts get <tenantId> <key>');
    console.log('  npx ts-node scripts/manage-tenant-config.ts set <tenantId> <key> <value> [description]');
    console.log('  npx ts-node scripts/manage-tenant-config.ts delete <tenantId> <key>');
    console.log('  npx ts-node scripts/manage-tenant-config.ts init <tenantId>');
    console.log('');
    console.log('Well-known keys:');
    for (const [key, desc] of Object.entries(KNOWN_KEYS)) {
      console.log(`  - ${key}: ${desc}`);
    }
    process.exit(1);
  }

  const command = args[0];
  const tenantId = args[1];

  if (!tenantId && command !== 'help') {
    console.error('Tenant ID is required');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list':
        await listConfigs(tenantId);
        break;

      case 'get':
        if (!args[2]) {
          console.error('Key is required for get command');
          process.exit(1);
        }
        await getConfig(tenantId, args[2]);
        break;

      case 'set':
        if (!args[2] || !args[3]) {
          console.error('Key and value are required for set command');
          process.exit(1);
        }
        await setConfig(tenantId, args[2], args[3], args[4]);
        break;

      case 'delete':
        if (!args[2]) {
          console.error('Key is required for delete command');
          process.exit(1);
        }
        await deleteConfig(tenantId, args[2]);
        break;

      case 'init':
        await initDefaults(tenantId);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
