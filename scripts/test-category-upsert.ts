#!/usr/bin/env tsx
import 'dotenv/config';
import { getPrismaClient } from '../src/database/client';

const prisma = getPrismaClient();

async function main() {
  const tenantId = '00000000-0000-0000-0000-000000000001';

  // Test upserting a simple category
  const testCategory = {
    id: 1,
    tenantId,
    parentId: null,
    level: 1,
    type: 'item',
    linklist: true,
    right: 'all',
    sitemap: true,
    hasChildren: false,
    names: { en: 'Test Category', de: 'Test Kategorie' },
    rawData: { test: true },
    syncedAt: new Date(),
  };

  try {
    console.log('Testing category upsert with data:', JSON.stringify(testCategory, null, 2));

    const result = await prisma.plentyCategory.upsert({
      where: {
        tenantId_id: {
          tenantId,
          id: 1,
        },
      },
      create: testCategory,
      update: testCategory,
    });

    console.log('✅ Category upserted successfully!', result);
  } catch (error) {
    console.error('❌ Failed to upsert category:');
    console.error('Error:', error);
    if (error instanceof Error) {
      console.error('Message:', error.message);
      console.error('Stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
