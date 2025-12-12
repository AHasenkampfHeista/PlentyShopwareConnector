import { IShopwareClient, ShopwareClientConfig, MockShopwareClientConfig } from './interfaces';
import { MockShopwareClient } from './MockShopwareClient';
import { ShopwareClient } from './ShopwareClient';
import { createLogger } from '../utils/logger';

const log = createLogger({ component: 'ShopwareClientFactory' });

/**
 * Configuration for creating Shopware clients
 */
export interface ShopwareClientFactoryConfig {
  tenantId: string;
  useMock?: boolean;
  shopwareConfig?: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    timeout?: number;
  };
}

/**
 * Factory function to create the appropriate Shopware client
 * based on configuration
 */
export function createShopwareClient(config: ShopwareClientFactoryConfig): IShopwareClient {
  // Check environment variable if useMock is not explicitly set
  const useMock = config.useMock ?? process.env.USE_MOCK_SHOPWARE !== 'false';

  if (useMock) {
    log.info('Creating MockShopwareClient', { tenantId: config.tenantId });
    const mockConfig: MockShopwareClientConfig = {
      tenantId: config.tenantId,
    };
    return new MockShopwareClient(mockConfig);
  }

  // Use real Shopware client
  // Get config from parameter or environment variables
  const baseUrl = config.shopwareConfig?.baseUrl || process.env.SHOPWARE_API_URL;
  const clientId = config.shopwareConfig?.clientId || process.env.SHOPWARE_CLIENT_ID;
  const clientSecret = config.shopwareConfig?.clientSecret || process.env.SHOPWARE_CLIENT_SECRET;

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error(
      'Shopware configuration missing. Set SHOPWARE_API_URL, SHOPWARE_CLIENT_ID, and SHOPWARE_CLIENT_SECRET ' +
        'environment variables or provide shopwareConfig parameter.'
    );
  }

  log.info('Creating ShopwareClient', { tenantId: config.tenantId, baseUrl });

  const shopwareConfig: ShopwareClientConfig = {
    baseUrl,
    credentials: {
      clientId,
      clientSecret,
    },
    timeout: config.shopwareConfig?.timeout,
  };

  return new ShopwareClient(shopwareConfig);
}

/**
 * Check if mock Shopware client should be used
 */
export function shouldUseMockShopware(): boolean {
  return process.env.USE_MOCK_SHOPWARE !== 'false';
}
