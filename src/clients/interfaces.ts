import {
  ShopwareProduct,
  ShopwareCategory,
  ShopwarePropertyGroup,
  ShopwarePropertyOption,
  ShopwareStockUpdate,
  ShopwareSyncResult,
  ShopwareBulkProduct,
  ShopwareBulkSyncResult,
  ShopwareManufacturer,
  ShopwareUnit,
} from '../types/shopware';

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
   * Update an existing product by ID
   */
  updateProduct(id: string, product: Partial<ShopwareProduct>): Promise<ShopwareSyncResult>;

  /**
   * Update an existing product by SKU
   */
  updateProductBySku(sku: string, product: Partial<ShopwareProduct>): Promise<ShopwareSyncResult>;

  /**
   * Get product by SKU
   */
  getProductBySku(sku: string): Promise<ShopwareProduct | null>;

  /**
   * Check if product exists by SKU
   */
  productExists(sku: string): Promise<boolean>;

  /**
   * Bulk sync products (create or update in batch)
   * Uses Shopware's upsert pattern - no need to check existence
   */
  bulkSyncProducts(products: ShopwareBulkProduct[]): Promise<ShopwareBulkSyncResult>;

  /**
   * Update stock for a product
   */
  updateStock(sku: string, stock: number): Promise<ShopwareSyncResult>;

  /**
   * Batch update stock
   */
  batchUpdateStock(updates: ShopwareStockUpdate[]): Promise<ShopwareSyncResult[]>;

  /**
   * Create a new category
   */
  createCategory(category: ShopwareCategory): Promise<ShopwareSyncResult>;

  /**
   * Update an existing category by ID
   */
  updateCategory(id: string, category: Partial<ShopwareCategory>): Promise<ShopwareSyncResult>;

  /**
   * Get category by ID
   */
  getCategoryById(id: string): Promise<ShopwareCategory | null>;

  /**
   * Check if category exists by ID
   */
  categoryExists(id: string): Promise<boolean>;

  /**
   * Bulk sync categories (create or update in batch)
   */
  bulkSyncCategories(categories: ShopwareCategory[]): Promise<ShopwareBulkSyncResult>;

  /**
   * Create a property group
   */
  createPropertyGroup(group: ShopwarePropertyGroup): Promise<ShopwareSyncResult>;

  /**
   * Update a property group by ID
   */
  updatePropertyGroup(id: string, group: Partial<ShopwarePropertyGroup>): Promise<ShopwareSyncResult>;

  /**
   * Get property group by ID
   */
  getPropertyGroupById(id: string): Promise<ShopwarePropertyGroup | null>;

  /**
   * Check if property group exists
   */
  propertyGroupExists(id: string): Promise<boolean>;

  /**
   * Create a property option
   */
  createPropertyOption(option: ShopwarePropertyOption): Promise<ShopwareSyncResult>;

  /**
   * Update a property option by ID
   */
  updatePropertyOption(id: string, option: Partial<ShopwarePropertyOption>): Promise<ShopwareSyncResult>;

  /**
   * Get property option by ID
   */
  getPropertyOptionById(id: string): Promise<ShopwarePropertyOption | null>;

  /**
   * Check if property option exists
   */
  propertyOptionExists(id: string): Promise<boolean>;

  /**
   * Bulk sync property groups
   */
  bulkSyncPropertyGroups(groups: ShopwarePropertyGroup[]): Promise<ShopwareBulkSyncResult>;

  /**
   * Bulk sync property options
   */
  bulkSyncPropertyOptions(options: ShopwarePropertyOption[]): Promise<ShopwareBulkSyncResult>;

  /**
   * Create a new price
   */
  createPrice(price: {
    name: string;
    type?: string;
    isGross?: boolean;
    plentySalesPriceId?: number;
    translations?: Record<string, string>;
  }): Promise<ShopwareSyncResult>;

  /**
   * Update an existing price by ID
   */
  updatePrice(
    id: string,
    price: {
      name?: string;
      type?: string;
      isGross?: boolean;
      translations?: Record<string, string>;
    }
  ): Promise<ShopwareSyncResult>;

  /**
   * Get price by ID
   */
  getPriceById(id: string): Promise<{ id: string; name: string; type: string } | null>;

  /**
   * Check if price exists by ID
   */
  priceExists(id: string): Promise<boolean>;

  /**
   * Create a new manufacturer
   */
  createManufacturer(manufacturer: ShopwareManufacturer): Promise<ShopwareSyncResult>;

  /**
   * Update an existing manufacturer by ID
   */
  updateManufacturer(id: string, manufacturer: Partial<ShopwareManufacturer>): Promise<ShopwareSyncResult>;

  /**
   * Get manufacturer by ID
   */
  getManufacturerById(id: string): Promise<ShopwareManufacturer | null>;

  /**
   * Check if manufacturer exists by ID
   */
  manufacturerExists(id: string): Promise<boolean>;

  /**
   * Bulk sync manufacturers (create or update in batch)
   */
  bulkSyncManufacturers(manufacturers: ShopwareManufacturer[]): Promise<ShopwareBulkSyncResult>;

  /**
   * Create a new unit
   */
  createUnit(unit: ShopwareUnit): Promise<ShopwareSyncResult>;

  /**
   * Update an existing unit by ID
   */
  updateUnit(id: string, unit: Partial<ShopwareUnit>): Promise<ShopwareSyncResult>;

  /**
   * Get unit by ID
   */
  getUnitById(id: string): Promise<ShopwareUnit | null>;

  /**
   * Check if unit exists by ID
   */
  unitExists(id: string): Promise<boolean>;

  /**
   * Bulk sync units (create or update in batch)
   */
  bulkSyncUnits(units: ShopwareUnit[]): Promise<ShopwareBulkSyncResult>;

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
