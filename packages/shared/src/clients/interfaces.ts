import { ShopwareProduct, ShopwareStockUpdate, ShopwareSyncResult } from '../types/shopware';

/**
 * Interface for Shopware clients (Mock and Real)
 * Both implementations must follow this interface for easy swapping
 */
export interface IShopwareClient {
  /**
   * Authenticate with the Shopware API
   */
  authenticate(): Promise<void>;

  /**
   * Create a new product
   */
  createProduct(product: ShopwareProduct): Promise<ShopwareSyncResult>;

  /**
   * Update an existing product
   */
  updateProduct(id: string, product: Partial<ShopwareProduct>): Promise<ShopwareSyncResult>;

  /**
   * Get product by SKU
   */
  getProductBySku(sku: string): Promise<ShopwareProduct | null>;

  /**
   * Check if product exists by SKU
   */
  productExists(sku: string): Promise<boolean>;

  /**
   * Update stock for a product
   */
  updateStock(sku: string, stock: number): Promise<ShopwareSyncResult>;

  /**
   * Batch update stock
   */
  batchUpdateStock(updates: ShopwareStockUpdate[]): Promise<ShopwareSyncResult[]>;

  /**
   * Test connection to Shopware API
   */
  testConnection(): Promise<boolean>;

  /**
   * Check if client is authenticated
   */
  isAuthenticated(): boolean;
}

/**
 * Configuration for Shopware client
 */
export interface ShopwareClientConfig {
  baseUrl: string;
  credentials: {
    clientId: string;
    clientSecret: string;
  };
  timeout?: number;
}

/**
 * Configuration for Mock Shopware client
 */
export interface MockShopwareClientConfig {
  tenantId: string;
}
