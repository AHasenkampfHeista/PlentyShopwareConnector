/**
 * Shopware 6 API Types
 * Based on: https://shopware.stoplight.io/
 */

// ============================================
// PRODUCTS
// ============================================

export interface ShopwareProduct {
  id?: string;
  parentId?: string;
  versionId?: string;
  manufacturerId?: string;
  productNumber: string;
  stock: number;
  availableStock?: number;
  available?: boolean;
  deliveryTimeId?: string;
  restockTime?: number;
  active: boolean;
  price: ShopwarePrice[];
  purchasePrices?: ShopwarePrice[];
  productMediaId?: string;
  taxId?: string;
  unitId?: string;
  isCloseout?: boolean;
  purchaseSteps?: number;
  maxPurchase?: number;
  minPurchase?: number;
  purchaseUnit?: number;
  referenceUnit?: number;
  shippingFree?: boolean;
  markAsTopseller?: boolean;
  weight?: number;
  width?: number;
  height?: number;
  length?: number;
  releaseDate?: string;
  categoryTree?: string[];
  categories?: ShopwareCategory[];
  properties?: ShopwarePropertyOption[];
  options?: ShopwarePropertyOption[];
  tags?: ShopwareTag[];
  media?: ShopwareProductMedia[];
  visibilities?: ShopwareProductVisibility[];
  createdAt?: string;
  updatedAt?: string;

  // Translated fields
  name?: string;
  description?: string;
  metaDescription?: string;
  metaTitle?: string;
  keywords?: string;
  customFields?: Record<string, unknown>;

  // Translation object
  translations?: Record<string, ShopwareProductTranslation>;

  // Reference to original Plenty data (for internal use)
  _plentyItemId?: number;
  _plentyVariationId?: number;
}

/**
 * Product visibility in sales channels
 * visibility: 10 = search only, 20 = listing only, 30 = both (default)
 */
export interface ShopwareProductVisibility {
  id?: string;
  salesChannelId: string;
  visibility: number;
}

export interface ShopwareProductTranslation {
  name: string;
  description?: string;
  metaDescription?: string;
  metaTitle?: string;
  keywords?: string;
  customFields?: Record<string, unknown>;
}

export interface ShopwarePrice {
  currencyId: string;
  net: number;
  gross: number;
  linked: boolean;
  listPrice?: {
    net: number;
    gross: number;
    linked: boolean;
  } | null;
  regulationPrice?: {
    net: number;
    gross: number;
  } | null;
}

export interface ShopwareCategory {
  id: string;
  versionId?: string;
  parentId?: string;
  afterCategoryId?: string;
  name?: string;
  displayNestedProducts?: boolean;
  active?: boolean;
  visible?: boolean;
  level?: number;
  path?: string;
  childCount?: number;
  productAssignmentType?: string;
  type?: string;
  cmsPageId?: string; // CMS page for product listing (required for products to display)
  translations?: Record<string, ShopwareCategoryTranslation>;

  // Plenty reference (internal use)
  _plentyCategoryId?: number;
}

export interface ShopwareCategoryTranslation {
  name: string;
  description?: string;
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string;
}

export interface ShopwarePropertyGroup {
  id: string;
  name?: string;
  displayType?: string; // 'text', 'color', 'image'
  sortingType?: string; // 'alphanumeric', 'numeric', 'position'
  position?: number;
  translations?: Record<string, { name: string; description?: string }>;

  // Custom fields for metadata (synced to Shopware)
  customFields?: {
    plentySourceType?: 'ATTRIBUTE' | 'PROPERTY'; // Distinguishes Plenty Attributes from Properties
    plentySourceId?: number; // Original ID in PlentyMarkets
    [key: string]: unknown;
  };

  // Plenty reference (internal use)
  _plentyAttributeId?: number;  // For Plenty Attributes
  _plentyPropertyId?: number;   // For Plenty Properties
}

export interface ShopwarePropertyOption {
  id: string;
  groupId?: string;
  name?: string;
  position?: number;
  colorHexCode?: string;
  mediaId?: string;
  translations?: Record<string, { name: string }>;

  // Plenty reference (internal use)
  _plentyAttributeId?: number;       // For Plenty Attributes
  _plentyAttributeValueId?: number;  // For Plenty Attribute Values
  _plentyPropertyId?: number;        // For Plenty Properties
  _plentyPropertySelectionId?: number; // For Plenty Property Selections
}

export interface ShopwareTag {
  id: string;
  name?: string;
}

export interface ShopwareProductMedia {
  id?: string;
  mediaId: string;
  position?: number;
  alt?: string;
  title?: string;
}

// ============================================
// STOCK
// ============================================

export interface ShopwareStockUpdate {
  id: string;
  productNumber?: string;
  stock: number;
}

export interface ShopwareInventory {
  id: string;
  productId: string;
  stock: number;
  available: boolean;
  updatedAt: string;
}

// ============================================
// TAX
// ============================================

export interface ShopwareTax {
  id: string;
  taxRate: number;
  name: string;
  position?: number;
}

// ============================================
// MANUFACTURER
// ============================================

export interface ShopwareManufacturer {
  id: string;
  versionId?: string;
  mediaId?: string | null;
  link?: string | null;
  name?: string;
  description?: string | null;
  translations?: Record<string, { name: string; description?: string }>;

  // Plenty reference (internal use)
  _plentyManufacturerId?: number;
}

// ============================================
// UNIT
// ============================================

export interface ShopwareUnit {
  id: string;
  shortCode: string;
  name?: string;
  translations?: Record<string, { shortCode: string; name?: string }>;

  // Plenty reference (internal use)
  _plentyUnitId?: number;
}

// ============================================
// CURRENCY
// ============================================

export interface ShopwareCurrency {
  id: string;
  isoCode: string;
  factor: number;
  symbol: string;
  shortName: string;
  name: string;
  position: number;
  isSystemDefault: boolean;
}

// ============================================
// API RESPONSES
// ============================================

export interface ShopwareApiResponse<T> {
  data: T;
  included?: unknown[];
  links?: ShopwareLinks;
  meta?: ShopwareMeta;
}

export interface ShopwareListResponse<T> {
  data: T[];
  total: number;
  aggregations?: unknown[];
  links?: ShopwareLinks;
  meta?: ShopwareMeta;
}

export interface ShopwareLinks {
  first?: string;
  last?: string;
  next?: string;
  prev?: string;
  self?: string;
}

export interface ShopwareMeta {
  totalCountMode?: number;
  total?: number;
}

export interface ShopwareSearchCriteria {
  page?: number;
  limit?: number;
  term?: string;
  filter?: ShopwareFilter[];
  sort?: ShopwareSort[];
  associations?: Record<string, ShopwareSearchCriteria>;
  includes?: Record<string, string[]>;
  ids?: string[];
}

export interface ShopwareFilter {
  type: 'equals' | 'equalsAny' | 'contains' | 'range' | 'not' | 'multi' | 'prefix' | 'suffix';
  field: string;
  value: unknown;
}

export interface ShopwareSort {
  field: string;
  order: 'ASC' | 'DESC';
  naturalSorting?: boolean;
}

// ============================================
// SYNC OPERATION RESULTS
// ============================================

export interface ShopwareSyncResult {
  id: string;
  productNumber: string;
  action: 'create' | 'update' | 'skip' | 'error';
  success: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

// ============================================
// BULK SYNC
// ============================================

/**
 * Product for bulk sync operations
 * Includes optional ID - if provided, it's an update; if null/undefined, it's a create
 */
export interface ShopwareBulkProduct extends Partial<ShopwareProduct> {
  id?: string; // Shopware UUID (null/undefined = create, uuid = update)
  productNumber: string; // Required
  stock: number; // Required
  active: boolean; // Required
  price: ShopwarePrice[]; // Required
  _plentyItemId?: number; // Internal tracking only
  _plentyVariationId?: number; // Internal tracking only
}

/**
 * Result from bulk sync operation
 */
export interface ShopwareBulkSyncResult {
  success: boolean;
  results: ShopwareBulkItemResult[];
}

/**
 * Individual item result from bulk sync
 */
export interface ShopwareBulkItemResult {
  productNumber: string;
  shopwareId: string; // UUID returned by Shopware (created or updated)
  action: 'create' | 'update';
  success: boolean;
  error?: string;
}

// ============================================
// CUSTOM FIELDS
// ============================================

/**
 * Custom Field Set - container for custom fields
 */
export interface ShopwareCustomFieldSet {
  id: string;
  name: string; // Technical name, e.g. 'plenty_properties'
  config?: {
    label?: Record<string, string>; // Localized labels
    translated?: boolean;
  };
  active?: boolean;
  global?: boolean;
  position?: number;
  customFields?: ShopwareCustomField[];
  relations?: ShopwareCustomFieldSetRelation[];
}

/**
 * Custom Field definition
 */
export interface ShopwareCustomField {
  id: string;
  name: string; // Technical name, e.g. 'plenty_property_48'
  type: 'text' | 'int' | 'float' | 'bool' | 'datetime' | 'select' | 'html' | 'json';
  config?: {
    label?: Record<string, string>; // Localized labels
    helpText?: Record<string, string>;
    placeholder?: Record<string, string>;
    componentName?: string;
    customFieldType?: string;
    customFieldPosition?: number;
    options?: Array<{ value: string; label: Record<string, string> }>;
    [key: string]: unknown;
  };
  active?: boolean;
  customFieldSetId?: string;
}

/**
 * Relation between Custom Field Set and an entity
 */
export interface ShopwareCustomFieldSetRelation {
  id?: string;
  customFieldSetId?: string;
  entityName: string; // 'product', 'category', etc.
}

// ============================================
// AUTHENTICATION
// ============================================

export interface ShopwareCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ShopwareAuthResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
}

// ============================================
// DEFAULTS
// ============================================

export const DEFAULT_CURRENCY_ID = ''; // Will be set from Shopware config
export const DEFAULT_TAX_ID = ''; // Will be set from Shopware config
export const DEFAULT_LANGUAGE_ID = ''; // Will be set from Shopware config

// Common currency IDs (typically these UUIDs in Shopware)
export const CURRENCY_ISO_TO_ID: Record<string, string> = {
  EUR: 'b7d2554b0ce847cd82f3ac9bd1c0dfca', // Example, actual ID depends on installation
  USD: '', // Set from config
  GBP: '', // Set from config
};
