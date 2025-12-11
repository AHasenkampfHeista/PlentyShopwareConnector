#!/usr/bin/env tsx
import 'dotenv/config';
import { getPrismaClient } from '../src/database/client';
import { PlentyClient } from '../src/clients/PlentyClient';
import { decryptJSON } from '../src/utils/encryption';

const prisma = getPrismaClient();

async function main() {
  const tenantId = '00000000-0000-0000-0000-000000000001';

  // Get tenant
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new Error('Tenant not found');
  }

  // Decrypt credentials
  const plentyCredentials = decryptJSON(tenant.plentyCredentials);

  // Create Plenty client
  const plenty = new PlentyClient({
    baseUrl: tenant.plentyUrl,
    credentials: plentyCredentials,
  });

  await plenty.authenticate();

  // Fetch categories
  const categories = await plenty.getAllCategories();

  console.log(`Fetched ${categories.length} categories`);

  if (categories.length === 0) {
    console.log('No categories found');
    return;
  }

  // Try to upsert the FIRST category
  const category = categories[0];
  console.log('\nFirst category from Plenty API:');
  console.log(JSON.stringify(category, null, 2));

  // Extract localized names
  const names: Record<string, string> = {};
  if (category.details) {
    for (const detail of category.details) {
      names[detail.lang] = detail.name;
    }
  }

  console.log('\nExtracted names:', names);
  console.log('\nAttempting to upsert...');

  try {
    await prisma.plentyCategory.upsert({
      where: {
        tenantId_id: {
          tenantId,
          id: category.id,
        },
      },
      create: {
        id: category.id,
        tenantId,
        parentId: category.parentCategoryId,
        level: category.level,
        type: category.type,
        linklist: category.linklist,
        right: category.right,
        sitemap: category.sitemap,
        hasChildren: category.hasChildren,
        names,
        rawData: category as unknown as object,
        syncedAt: new Date(),
      },
      update: {
        parentId: category.parentCategoryId,
        level: category.level,
        type: category.type,
        linklist: category.linklist,
        right: category.right,
        sitemap: category.sitemap,
        hasChildren: category.hasChildren,
        names,
        rawData: category as unknown as object,
        syncedAt: new Date(),
      },
    });

    console.log('✅ Category upserted successfully!');
  } catch (error) {
    console.error('\n❌ Failed to upsert category:');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('\nMessage:', error.message);
      console.error('\nStack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
