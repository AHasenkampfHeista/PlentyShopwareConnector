#!/usr/bin/env tsx
/**
 * Manage category mappings between PlentyMarkets and Shopware
 *
 * Usage:
 *   npm run manage-category-mappings list <tenant-id>                          # List all mappings
 *   npm run manage-category-mappings add <tenant-id> <plenty-id> <shopware-id> # Add manual mapping
 *   npm run manage-category-mappings delete <tenant-id> <plenty-id>            # Delete mapping
 *   npm run manage-category-mappings unmapped <tenant-id>                      # Show unmapped categories
 *   npm run manage-category-mappings stats <tenant-id>                         # Show statistics
 */

import 'dotenv/config';
import { PrismaClient, MappingType } from '@prisma/client';
import { MockShopwareClient } from '../src/clients/MockShopwareClient';

const prisma = new PrismaClient();

/**
 * List all category mappings for a tenant
 */
async function listMappings(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const mappings = await prisma.categoryMapping.findMany({
    where: { tenantId },
    orderBy: [{ mappingType: 'desc' }, { plentyCategoryId: 'asc' }],
    include: {
      tenant: {
        select: {
          name: true,
        },
      },
    },
  });

  console.log(`\n📋 Category Mappings for ${tenant.name}`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Total mappings: ${mappings.length}\n`);

  if (mappings.length === 0) {
    console.log('   No mappings found.\n');
    return;
  }

  // Group by mapping type
  const manual = mappings.filter((m) => m.mappingType === MappingType.MANUAL);
  const auto = mappings.filter((m) => m.mappingType === MappingType.AUTO);

  if (manual.length > 0) {
    console.log('🔧 Manual Mappings:');
    for (const mapping of manual) {
      console.log(`   Plenty ${mapping.plentyCategoryId} → Shopware ${mapping.shopwareCategoryId}`);
      console.log(`      Last synced: ${mapping.lastSyncedAt.toLocaleString()}`);
      console.log(`      Action: ${mapping.lastSyncAction}\n`);
    }
  }

  if (auto.length > 0) {
    console.log('🤖 Auto-created Mappings:');
    for (const mapping of auto) {
      console.log(`   Plenty ${mapping.plentyCategoryId} → Shopware ${mapping.shopwareCategoryId}`);
      console.log(`      Last synced: ${mapping.lastSyncedAt.toLocaleString()}`);
      console.log(`      Action: ${mapping.lastSyncAction}\n`);
    }
  }
}

/**
 * Add a manual mapping
 */
async function addMapping(
  tenantId: string,
  plentyCategoryId: number,
  shopwareCategoryId: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  // Verify Plenty category exists
  const plentyCategory = await prisma.plentyCategory.findUnique({
    where: {
      tenantId_id: {
        tenantId,
        id: plentyCategoryId,
      },
    },
  });

  if (!plentyCategory) {
    console.error(`❌ Plenty category not found: ${plentyCategoryId}`);
    console.error(`   Make sure to run config sync first to populate categories.`);
    process.exit(1);
  }

  // Verify Shopware category exists
  const shopware = new MockShopwareClient({ tenantId });
  await shopware.authenticate();

  const categoryExists = await shopware.categoryExists(shopwareCategoryId);
  if (!categoryExists) {
    console.error(`❌ Shopware category not found: ${shopwareCategoryId}`);
    console.error(`   Create the category in Shopware first, or let auto-sync create it.`);
    process.exit(1);
  }

  // Create mapping
  const mapping = await prisma.categoryMapping.upsert({
    where: {
      tenantId_plentyCategoryId: {
        tenantId,
        plentyCategoryId,
      },
    },
    create: {
      tenantId,
      plentyCategoryId,
      shopwareCategoryId,
      mappingType: MappingType.MANUAL,
      lastSyncedAt: new Date(),
      lastSyncAction: 'create',
    },
    update: {
      shopwareCategoryId,
      mappingType: MappingType.MANUAL,
      lastSyncedAt: new Date(),
      lastSyncAction: 'update',
    },
  });

  const categoryNames = plentyCategory.names as Record<string, string> | null;
  const categoryName = categoryNames?.de || categoryNames?.en || 'Unknown';

  console.log(`\n✅ Manual mapping created successfully!`);
  console.log(`   Plenty Category: ${plentyCategoryId} (${categoryName})`);
  console.log(`   Shopware Category: ${shopwareCategoryId}`);
  console.log(`   Type: ${mapping.mappingType}\n`);
}

/**
 * Delete a mapping
 */
async function deleteMapping(tenantId: string, plentyCategoryId: number): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const result = await prisma.categoryMapping.deleteMany({
    where: {
      tenantId,
      plentyCategoryId,
    },
  });

  if (result.count === 0) {
    console.log(`\n⚠️  No mapping found for Plenty category ${plentyCategoryId}\n`);
  } else {
    console.log(`\n✅ Deleted mapping for Plenty category ${plentyCategoryId}\n`);
  }
}

/**
 * Show unmapped categories
 */
async function showUnmapped(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  // Get all Plenty categories
  const allCategories = await prisma.plentyCategory.findMany({
    where: { tenantId },
    orderBy: { id: 'asc' },
  });

  // Get all mappings
  const mappings = await prisma.categoryMapping.findMany({
    where: { tenantId },
    select: { plentyCategoryId: true },
  });

  const mappedIds = new Set(mappings.map((m) => m.plentyCategoryId));
  const unmapped = allCategories.filter((c) => !mappedIds.has(c.id));

  console.log(`\n📊 Unmapped Categories for ${tenant.name}`);
  console.log(`   Total categories: ${allCategories.length}`);
  console.log(`   Mapped: ${mappedIds.size}`);
  console.log(`   Unmapped: ${unmapped.length}\n`);

  if (unmapped.length === 0) {
    console.log('   All categories are mapped!\n');
    return;
  }

  console.log('Categories without Shopware mapping:');
  for (const category of unmapped.slice(0, 20)) {
    // Show first 20
    const names = category.names as Record<string, string> | null;
    const name = names?.de || names?.en || 'Unnamed';
    console.log(`   ${category.id}: ${name} (Level ${category.level})`);
  }

  if (unmapped.length > 20) {
    console.log(`   ... and ${unmapped.length - 20} more\n`);
  } else {
    console.log('');
  }
}

/**
 * Show mapping statistics
 */
async function showStats(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const totalMappings = await prisma.categoryMapping.count({
    where: { tenantId },
  });

  const manualMappings = await prisma.categoryMapping.count({
    where: { tenantId, mappingType: MappingType.MANUAL },
  });

  const autoMappings = await prisma.categoryMapping.count({
    where: { tenantId, mappingType: MappingType.AUTO },
  });

  const totalCategories = await prisma.plentyCategory.count({
    where: { tenantId },
  });

  const unmapped = totalCategories - totalMappings;
  const mappedPercentage = totalCategories > 0 ? ((totalMappings / totalCategories) * 100).toFixed(1) : '0';

  console.log(`\n📊 Category Mapping Statistics for ${tenant.name}`);
  console.log(`   Tenant ID: ${tenantId}\n`);
  console.log(`   Total Plenty Categories: ${totalCategories}`);
  console.log(`   Total Mappings: ${totalMappings} (${mappedPercentage}%)`);
  console.log(`   Manual Mappings: ${manualMappings}`);
  console.log(`   Auto-created Mappings: ${autoMappings}`);
  console.log(`   Unmapped: ${unmapped}\n`);
}

/**
 * Main CLI handler
 */
async function main() {
  const command = process.argv[2];
  const tenantId = process.argv[3];

  if (!command) {
    console.error('Usage: npm run manage-category-mappings <command> [args]');
    console.error('\nCommands:');
    console.error('  list <tenant-id>                          - List all mappings');
    console.error('  add <tenant-id> <plenty-id> <shopware-id> - Add manual mapping');
    console.error('  delete <tenant-id> <plenty-id>            - Delete mapping');
    console.error('  unmapped <tenant-id>                      - Show unmapped categories');
    console.error('  stats <tenant-id>                         - Show statistics');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list':
        if (!tenantId) {
          console.error('Error: tenant-id required');
          process.exit(1);
        }
        await listMappings(tenantId);
        break;

      case 'add': {
        const plentyCategoryId = parseInt(process.argv[4], 10);
        const shopwareCategoryId = process.argv[5];

        if (!tenantId || !plentyCategoryId || !shopwareCategoryId) {
          console.error('Error: tenant-id, plenty-id, and shopware-id required');
          process.exit(1);
        }

        await addMapping(tenantId, plentyCategoryId, shopwareCategoryId);
        break;
      }

      case 'delete': {
        const plentyCategoryId = parseInt(process.argv[4], 10);

        if (!tenantId || !plentyCategoryId) {
          console.error('Error: tenant-id and plenty-id required');
          process.exit(1);
        }

        await deleteMapping(tenantId, plentyCategoryId);
        break;
      }

      case 'unmapped':
        if (!tenantId) {
          console.error('Error: tenant-id required');
          process.exit(1);
        }
        await showUnmapped(tenantId);
        break;

      case 'stats':
        if (!tenantId) {
          console.error('Error: tenant-id required');
          process.exit(1);
        }
        await showStats(tenantId);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
