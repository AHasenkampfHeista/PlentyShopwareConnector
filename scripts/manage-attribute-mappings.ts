#!/usr/bin/env tsx
/**
 * Manage attribute mappings between PlentyMarkets and Shopware
 * Handles both:
 * - Attribute (Property Group) mappings
 * - Attribute Value (Property Option) mappings
 *
 * Usage:
 *   # Property Groups (Attributes)
 *   npm run manage-attribute-mappings list-groups <tenant-id>
 *   npm run manage-attribute-mappings add-group <tenant-id> <plenty-attr-id> <shopware-group-id>
 *   npm run manage-attribute-mappings delete-group <tenant-id> <plenty-attr-id>
 *
 *   # Property Options (Attribute Values)
 *   npm run manage-attribute-mappings list-values <tenant-id>
 *   npm run manage-attribute-mappings add-value <tenant-id> <plenty-value-id> <plenty-attr-id> <shopware-group-id> <shopware-option-id>
 *   npm run manage-attribute-mappings delete-value <tenant-id> <plenty-value-id>
 *
 *   # Statistics
 *   npm run manage-attribute-mappings stats <tenant-id>
 */

import 'dotenv/config';
import { PrismaClient, MappingType } from '@prisma/client';
import { createShopwareClient } from '../src/clients/ShopwareClientFactory';

const prisma = new PrismaClient();

/**
 * List all attribute (property group) mappings for a tenant
 */
async function listAttributeMappings(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const mappings = await prisma.attributeMapping.findMany({
    where: { tenantId },
    orderBy: [{ mappingType: 'desc' }, { plentyAttributeId: 'asc' }],
    include: {
      tenant: {
        select: {
          name: true,
        },
      },
    },
  });

  console.log(`\n📋 Attribute (Property Group) Mappings for ${tenant.name}`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Total mappings: ${mappings.length}\n`);

  if (mappings.length === 0) {
    console.log('   No attribute mappings found.\n');
    return;
  }

  // Group by mapping type
  const manual = mappings.filter((m) => m.mappingType === MappingType.MANUAL);
  const auto = mappings.filter((m) => m.mappingType === MappingType.AUTO);

  if (manual.length > 0) {
    console.log('🔧 Manual Mappings:');
    for (const mapping of manual) {
      console.log(`   Plenty Attr ${mapping.plentyAttributeId} → Shopware Group ${mapping.shopwarePropertyGroupId}`);
      console.log(`      Last synced: ${mapping.lastSyncedAt.toLocaleString()}`);
      console.log(`      Action: ${mapping.lastSyncAction}\n`);
    }
  }

  if (auto.length > 0) {
    console.log('🤖 Auto-created Mappings:');
    for (const mapping of auto) {
      console.log(`   Plenty Attr ${mapping.plentyAttributeId} → Shopware Group ${mapping.shopwarePropertyGroupId}`);
      console.log(`      Last synced: ${mapping.lastSyncedAt.toLocaleString()}`);
      console.log(`      Action: ${mapping.lastSyncAction}\n`);
    }
  }
}

/**
 * List all attribute value (property option) mappings for a tenant
 */
async function listAttributeValueMappings(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const mappings = await prisma.attributeValueMapping.findMany({
    where: { tenantId },
    orderBy: [{ mappingType: 'desc' }, { plentyAttributeValueId: 'asc' }],
    include: {
      tenant: {
        select: {
          name: true,
        },
      },
    },
  });

  console.log(`\n📋 Attribute Value (Property Option) Mappings for ${tenant.name}`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Total mappings: ${mappings.length}\n`);

  if (mappings.length === 0) {
    console.log('   No attribute value mappings found.\n');
    return;
  }

  // Group by mapping type
  const manual = mappings.filter((m) => m.mappingType === MappingType.MANUAL);
  const auto = mappings.filter((m) => m.mappingType === MappingType.AUTO);

  if (manual.length > 0) {
    console.log('🔧 Manual Mappings:');
    for (const mapping of manual) {
      console.log(`   Plenty Value ${mapping.plentyAttributeValueId} (Attr ${mapping.plentyAttributeId})`);
      console.log(`      → Shopware Option ${mapping.shopwarePropertyOptionId} (Group ${mapping.shopwarePropertyGroupId})`);
      console.log(`      Last synced: ${mapping.lastSyncedAt.toLocaleString()}`);
      console.log(`      Action: ${mapping.lastSyncAction}\n`);
    }
  }

  if (auto.length > 0) {
    console.log('🤖 Auto-created Mappings:');
    for (const mapping of auto) {
      console.log(`   Plenty Value ${mapping.plentyAttributeValueId} (Attr ${mapping.plentyAttributeId})`);
      console.log(`      → Shopware Option ${mapping.shopwarePropertyOptionId} (Group ${mapping.shopwarePropertyGroupId})`);
      console.log(`      Last synced: ${mapping.lastSyncedAt.toLocaleString()}`);
      console.log(`      Action: ${mapping.lastSyncAction}\n`);
    }
  }
}

/**
 * Add a manual attribute (property group) mapping
 */
async function addAttributeMapping(
  tenantId: string,
  plentyAttributeId: number,
  shopwarePropertyGroupId: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  // Verify Plenty attribute exists
  const plentyAttribute = await prisma.plentyAttribute.findUnique({
    where: {
      tenantId_id: {
        tenantId,
        id: plentyAttributeId,
      },
    },
  });

  if (!plentyAttribute) {
    console.error(`❌ Plenty attribute not found: ${plentyAttributeId}`);
    console.error(`   Make sure to run config sync first to populate attributes.`);
    process.exit(1);
  }

  // Verify Shopware property group exists
  const shopware = createShopwareClient({ tenantId });
  await shopware.authenticate();

  const groupExists = await shopware.propertyGroupExists(shopwarePropertyGroupId);
  if (!groupExists) {
    console.error(`❌ Shopware property group not found: ${shopwarePropertyGroupId}`);
    console.error(`   Create the property group in Shopware first, or let auto-sync create it.`);
    process.exit(1);
  }

  // Create mapping
  const mapping = await prisma.attributeMapping.upsert({
    where: {
      tenantId_plentyAttributeId: {
        tenantId,
        plentyAttributeId,
      },
    },
    create: {
      tenantId,
      plentyAttributeId,
      shopwarePropertyGroupId,
      mappingType: MappingType.MANUAL,
      lastSyncedAt: new Date(),
      lastSyncAction: 'create',
    },
    update: {
      shopwarePropertyGroupId,
      mappingType: MappingType.MANUAL,
      lastSyncedAt: new Date(),
      lastSyncAction: 'update',
    },
  });

  console.log(`\n✅ Manual attribute mapping created successfully!`);
  console.log(`   Plenty Attribute: ${plentyAttributeId} (${plentyAttribute.backendName})`);
  console.log(`   Shopware Property Group: ${shopwarePropertyGroupId}`);
  console.log(`   Type: ${mapping.mappingType}\n`);
}

/**
 * Add a manual attribute value (property option) mapping
 */
async function addAttributeValueMapping(
  tenantId: string,
  plentyAttributeValueId: number,
  plentyAttributeId: number,
  shopwarePropertyGroupId: string,
  shopwarePropertyOptionId: string
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  // Verify Plenty attribute exists
  const plentyAttribute = await prisma.plentyAttribute.findUnique({
    where: {
      tenantId_id: {
        tenantId,
        id: plentyAttributeId,
      },
    },
  });

  if (!plentyAttribute) {
    console.error(`❌ Plenty attribute not found: ${plentyAttributeId}`);
    console.error(`   Make sure to run config sync first to populate attributes.`);
    process.exit(1);
  }

  // Verify Shopware property group exists
  const shopware = createShopwareClient({ tenantId });
  await shopware.authenticate();

  const groupExists = await shopware.propertyGroupExists(shopwarePropertyGroupId);
  if (!groupExists) {
    console.error(`❌ Shopware property group not found: ${shopwarePropertyGroupId}`);
    process.exit(1);
  }

  const optionExists = await shopware.propertyOptionExists(shopwarePropertyOptionId);
  if (!optionExists) {
    console.error(`❌ Shopware property option not found: ${shopwarePropertyOptionId}`);
    process.exit(1);
  }

  // Create mapping
  const mapping = await prisma.attributeValueMapping.upsert({
    where: {
      tenantId_plentyAttributeValueId: {
        tenantId,
        plentyAttributeValueId,
      },
    },
    create: {
      tenantId,
      plentyAttributeId,
      plentyAttributeValueId,
      shopwarePropertyGroupId,
      shopwarePropertyOptionId,
      mappingType: MappingType.MANUAL,
      lastSyncedAt: new Date(),
      lastSyncAction: 'create',
    },
    update: {
      shopwarePropertyGroupId,
      shopwarePropertyOptionId,
      mappingType: MappingType.MANUAL,
      lastSyncedAt: new Date(),
      lastSyncAction: 'update',
    },
  });

  console.log(`\n✅ Manual attribute value mapping created successfully!`);
  console.log(`   Plenty Attribute Value: ${plentyAttributeValueId} (Attr: ${plentyAttributeId})`);
  console.log(`   Shopware Property Option: ${shopwarePropertyOptionId} (Group: ${shopwarePropertyGroupId})`);
  console.log(`   Type: ${mapping.mappingType}\n`);
}

/**
 * Delete an attribute (property group) mapping
 */
async function deleteAttributeMapping(tenantId: string, plentyAttributeId: number): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const result = await prisma.attributeMapping.deleteMany({
    where: {
      tenantId,
      plentyAttributeId,
    },
  });

  if (result.count === 0) {
    console.log(`\n⚠️  No mapping found for Plenty attribute ${plentyAttributeId}\n`);
  } else {
    console.log(`\n✅ Deleted mapping for Plenty attribute ${plentyAttributeId}\n`);
  }
}

/**
 * Delete an attribute value (property option) mapping
 */
async function deleteAttributeValueMapping(
  tenantId: string,
  plentyAttributeValueId: number
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    console.error(`❌ Tenant not found: ${tenantId}`);
    process.exit(1);
  }

  const result = await prisma.attributeValueMapping.deleteMany({
    where: {
      tenantId,
      plentyAttributeValueId,
    },
  });

  if (result.count === 0) {
    console.log(`\n⚠️  No mapping found for Plenty attribute value ${plentyAttributeValueId}\n`);
  } else {
    console.log(`\n✅ Deleted mapping for Plenty attribute value ${plentyAttributeValueId}\n`);
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

  // Attribute (Property Group) statistics
  const totalAttributeMappings = await prisma.attributeMapping.count({
    where: { tenantId },
  });

  const manualAttributeMappings = await prisma.attributeMapping.count({
    where: { tenantId, mappingType: MappingType.MANUAL },
  });

  const autoAttributeMappings = await prisma.attributeMapping.count({
    where: { tenantId, mappingType: MappingType.AUTO },
  });

  const totalAttributes = await prisma.plentyAttribute.count({
    where: { tenantId },
  });

  const unmappedAttributes = totalAttributes - totalAttributeMappings;
  const attributeMappedPercentage =
    totalAttributes > 0 ? ((totalAttributeMappings / totalAttributes) * 100).toFixed(1) : '0';

  // Attribute Value (Property Option) statistics
  const totalValueMappings = await prisma.attributeValueMapping.count({
    where: { tenantId },
  });

  const manualValueMappings = await prisma.attributeValueMapping.count({
    where: { tenantId, mappingType: MappingType.MANUAL },
  });

  const autoValueMappings = await prisma.attributeValueMapping.count({
    where: { tenantId, mappingType: MappingType.AUTO },
  });

  console.log(`\n📊 Attribute Mapping Statistics for ${tenant.name}`);
  console.log(`   Tenant ID: ${tenantId}\n`);

  console.log(`   === Property Groups (Attributes) ===`);
  console.log(`   Total Plenty Attributes: ${totalAttributes}`);
  console.log(`   Total Mappings: ${totalAttributeMappings} (${attributeMappedPercentage}%)`);
  console.log(`   Manual Mappings: ${manualAttributeMappings}`);
  console.log(`   Auto-created Mappings: ${autoAttributeMappings}`);
  console.log(`   Unmapped: ${unmappedAttributes}\n`);

  console.log(`   === Property Options (Attribute Values) ===`);
  console.log(`   Total Mappings: ${totalValueMappings}`);
  console.log(`   Manual Mappings: ${manualValueMappings}`);
  console.log(`   Auto-created Mappings: ${autoValueMappings}\n`);
}

/**
 * Main CLI handler
 */
async function main() {
  const command = process.argv[2];
  const tenantId = process.argv[3];

  if (!command) {
    console.error('Usage: npm run manage-attribute-mappings <command> [args]\n');
    console.error('Commands:');
    console.error('  Property Groups (Attributes):');
    console.error('    list-groups <tenant-id>                                        - List attribute mappings');
    console.error('    add-group <tenant-id> <plenty-attr-id> <shopware-group-id>    - Add manual attribute mapping');
    console.error('    delete-group <tenant-id> <plenty-attr-id>                     - Delete attribute mapping\n');
    console.error('  Property Options (Attribute Values):');
    console.error('    list-values <tenant-id>                                        - List attribute value mappings');
    console.error(
      '    add-value <tenant-id> <plenty-value-id> <plenty-attr-id> <shopware-group-id> <shopware-option-id>'
    );
    console.error('                                                                   - Add manual value mapping');
    console.error('    delete-value <tenant-id> <plenty-value-id>                    - Delete value mapping\n');
    console.error('  Statistics:');
    console.error('    stats <tenant-id>                                              - Show statistics');
    process.exit(1);
  }

  try {
    switch (command) {
      case 'list-groups':
        if (!tenantId) {
          console.error('Error: tenant-id required');
          process.exit(1);
        }
        await listAttributeMappings(tenantId);
        break;

      case 'list-values':
        if (!tenantId) {
          console.error('Error: tenant-id required');
          process.exit(1);
        }
        await listAttributeValueMappings(tenantId);
        break;

      case 'add-group': {
        const plentyAttributeId = parseInt(process.argv[4], 10);
        const shopwarePropertyGroupId = process.argv[5];

        if (!tenantId || !plentyAttributeId || !shopwarePropertyGroupId) {
          console.error('Error: tenant-id, plenty-attr-id, and shopware-group-id required');
          process.exit(1);
        }

        await addAttributeMapping(tenantId, plentyAttributeId, shopwarePropertyGroupId);
        break;
      }

      case 'add-value': {
        const plentyAttributeValueId = parseInt(process.argv[4], 10);
        const plentyAttributeId = parseInt(process.argv[5], 10);
        const shopwarePropertyGroupId = process.argv[6];
        const shopwarePropertyOptionId = process.argv[7];

        if (
          !tenantId ||
          !plentyAttributeValueId ||
          !plentyAttributeId ||
          !shopwarePropertyGroupId ||
          !shopwarePropertyOptionId
        ) {
          console.error(
            'Error: tenant-id, plenty-value-id, plenty-attr-id, shopware-group-id, and shopware-option-id required'
          );
          process.exit(1);
        }

        await addAttributeValueMapping(
          tenantId,
          plentyAttributeValueId,
          plentyAttributeId,
          shopwarePropertyGroupId,
          shopwarePropertyOptionId
        );
        break;
      }

      case 'delete-group': {
        const plentyAttributeId = parseInt(process.argv[4], 10);

        if (!tenantId || !plentyAttributeId) {
          console.error('Error: tenant-id and plenty-attr-id required');
          process.exit(1);
        }

        await deleteAttributeMapping(tenantId, plentyAttributeId);
        break;
      }

      case 'delete-value': {
        const plentyAttributeValueId = parseInt(process.argv[4], 10);

        if (!tenantId || !plentyAttributeValueId) {
          console.error('Error: tenant-id and plenty-value-id required');
          process.exit(1);
        }

        await deleteAttributeValueMapping(tenantId, plentyAttributeValueId);
        break;
      }

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
