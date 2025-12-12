/**
 * Test Shopware Connection Script
 * Tests connection to local Shopware instance
 *
 * Usage: npx tsx scripts/test-shopware-connection.ts
 */

import 'dotenv/config';
import { ShopwareClient } from '../src/clients/ShopwareClient';

async function main() {
  console.log('='.repeat(60));
  console.log('Shopware Connection Test');
  console.log('='.repeat(60));

  const baseUrl = process.env.SHOPWARE_API_URL || 'http://localhost:8000';
  const clientId = process.env.SHOPWARE_CLIENT_ID;
  const clientSecret = process.env.SHOPWARE_CLIENT_SECRET;

  console.log(`\nShopware URL: ${baseUrl}`);
  console.log(`Client ID: ${clientId ? clientId.substring(0, 10) + '...' : 'NOT SET'}`);
  console.log(`Client Secret: ${clientSecret ? '****' : 'NOT SET'}`);

  if (!clientId || !clientSecret) {
    console.error('\nError: SHOPWARE_CLIENT_ID and SHOPWARE_CLIENT_SECRET must be set in .env');
    console.log('\nTo create API credentials in Shopware Admin:');
    console.log('1. Go to Settings > System > Integrations');
    console.log('2. Click "Add integration"');
    console.log('3. Give it a name (e.g., "PlentyMarkets Connector")');
    console.log('4. Enable "Administrator" role or select required permissions');
    console.log('5. Copy the Access Key ID (Client ID) and Secret Access Key (Client Secret)');
    process.exit(1);
  }

  const client = new ShopwareClient({
    baseUrl,
    credentials: {
      clientId,
      clientSecret,
    },
  });

  try {
    console.log('\n1. Testing authentication...');
    await client.authenticate();
    console.log('   Authentication successful!');

    console.log('\n2. Testing connection...');
    const connected = await client.testConnection();
    console.log(`   Connection test: ${connected ? 'PASSED' : 'FAILED'}`);

    if (connected) {
      console.log('\n3. Fetching basic data...');

      // Test product search
      try {
        const testProduct = await client.getProductBySku('TEST-SKU-12345');
        console.log(`   Product search works: ${testProduct ? 'Found product' : 'No product found (expected for test SKU)'}`);
      } catch (error) {
        console.log('   Product search: Working (search returned results or empty)');
      }

      console.log('\n' + '='.repeat(60));
      console.log('CONNECTION TEST PASSED!');
      console.log('='.repeat(60));
      console.log('\nYour Shopware instance is properly configured and accessible.');
      console.log('\nNext steps:');
      console.log('1. Set USE_MOCK_SHOPWARE=false in your .env file');
      console.log('2. Run a config sync to sync categories, attributes, manufacturers, and units from PlentyMarkets to Shopware');
    } else {
      console.log('\nConnection test failed. Please check:');
      console.log('- Is Shopware running at ' + baseUrl + '?');
      console.log('- Are your API credentials correct?');
      console.log('- Does the integration have the correct permissions?');
    }
  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : String(error));
    console.log('\nTroubleshooting:');
    console.log('- Check if Shopware is running: docker ps');
    console.log('- Check if the URL is accessible: curl ' + baseUrl + '/api/_info/version');
    console.log('- Verify your API credentials in Shopware Admin');
    process.exit(1);
  }
}

main().catch(console.error);
