/**
 * Plentymarkets API Types
 * Based on: https://developers.plentymarkets.com/en-gb/developers/main/rest-api-guides/item-data.html
 */

// ============================================
// AUTHENTICATION
// ============================================

export interface PlentyCredentials {
  username: string;
  password: string;
}

export interface PlentyAuthResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  refreshToken?: string;
}

// ============================================
// PAGINATION
// ============================================

export interface PlentyPaginatedResponse<T> {
  page: number;
  totalsCount: number;
  isLastPage: boolean;
  lastPageNumber: number;
  firstOnPage: number;
  lastOnPage: number;
  itemsPerPage: number;
  entries: T[];
}

// ============================================
// VARIATIONS (Main product entity we work with)
// ============================================

export interface PlentyVariation {
  id: number;
  itemId: number;
  mainVariationId: number | null;
  number: string; // SKU
  model: string;
  externalId: string;
  position: number;
  isMain: boolean;
  isActive: boolean;
  availability: number;
  categoryVariationId: number;
  marketVariationId: number;
  clientVariationId: number;
  salesPriceVariationId: number;
  supplierVariationId: number;
  warehouseVariationId: number;
  propertyVariationId: number;
  createdAt: string;
  updatedAt: string;

  // Included when using ?with=
  item?: PlentyItem;
  variationSalesPrices?: PlentyVariationSalesPrice[];
  variationBarcodes?: PlentyVariationBarcode[];
  stock?: PlentyVariationStock[];
  variationAttributeValues?: PlentyVariationAttributeValue[];
  variationCategories?: PlentyVariationCategory[];
  variationClients?: PlentyVariationClient[];
  variationMarkets?: PlentyVariationMarket[];
  variationDefaultCategory?: PlentyVariationDefaultCategory;
  variationProperties?: PlentyVariationProperty[];
  variationImages?: PlentyVariationImage[];
  variationTexts?: PlentyVariationText[];
  unit?: PlentyVariationUnit;
}

export interface PlentyVariationSalesPrice {
  variationId: number;
  salesPriceId: number;
  price: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlentyVariationBarcode {
  variationId: number;
  barcodeId: number;
  code: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlentyVariationStock {
  variationId: number;
  itemId: number;
  warehouseId: number;
  reservedListing: number;
  reservedBundles: number;
  valueOfGoods: number;
  purchasePrice: number;
  physicalStock: number;
  reservedStock: number;
  netStock: number;
  reorderLevel: number;
  deltaReorderLevel: number;
}

export interface PlentyVariationAttributeValue {
  variationId?: number; // Legacy field
  attributeValueSetId?: number; // API returns this
  attributeId: number;
  valueId?: number; // API returns this field
  attributeValueId?: number; // Legacy field name
  isLinkableToImage?: boolean;
  attribute?: unknown;
  attributeValue?: unknown;
}

export interface PlentyVariationCategory {
  variationId: number;
  categoryId: number;
  position: number;
  isNeckermannPrimary: boolean;
}

export interface PlentyVariationClient {
  variationId: number;
  plentyId: number;
}

export interface PlentyVariationMarket {
  variationId: number;
  marketId: number;
}

export interface PlentyVariationDefaultCategory {
  variationId: number;
  branchId: number;
  plentyId: number;
  manually: boolean;
}

export interface PlentyVariationProperty {
  id: number;
  variationId: number;
  propertyId: number;
  propertySelectionId: number | null;
  valueInt: number | null;
  valueFloat: number | null;
  valueFile: string | null;
  surcharge: number;
}

export interface PlentyVariationImage {
  variationId: number;
  imageId: number;
  type: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlentyVariationText {
  variationId: number;
  lang: string;
  urlPath: string;
  name: string;
  name2: string;
  name3: string;
  description: string;
  shortDescription: string;
  technicalData: string;
  metaDescription: string;
  metaKeywords: string;
}

export interface PlentyVariationUnit {
  variationId: number;
  unitId: number;
  content: number;
}

// ============================================
// ITEMS (Parent container for variations)
// ============================================

export interface PlentyItem {
  id: number;
  position: number;
  manufacturerId: number;
  stockType: number;
  storeSpecial: number | null;
  condition: number;
  amazonFbaPlatform: number;
  ebayPresetId: number | null;
  ebayCategory: number | null;
  ebayCategory2: number | null;
  ebayStoreCategory: number | null;
  ebayStoreCategory2: number | null;
  amazonProductType: number | null;
  amazonFedas: string | null;
  feedback: number;
  isSubscribable: boolean;
  rakutenCategoryId: number | null;
  isShippingPackage: boolean;
  conditionApi: number;
  isSerialNumber: boolean;
  isShippableByAmazon: boolean;
  ownerId: number | null;
  itemType: string;
  mainVariationId: number;
  createdAt: string;
  updatedAt: string;
  variations?: PlentyVariation[];
  itemTexts?: PlentyItemText[];
}

export interface PlentyItemText {
  id: number;
  itemId: number;
  lang: string;
  urlPath: string;
  name: string;
  name2: string;
  name3: string;
  shortDescription: string;
  metaDescription: string;
  metaKeywords: string;
  technicalData: string;
  description: string;
  keywords: string;
}

// ============================================
// CONFIGURATION ENTITIES
// ============================================

export interface PlentyCategory {
  id: number;
  parentCategoryId: number | null;
  level: number;
  type: string;
  linklist: boolean | 'Y' | 'N'; // API returns "Y"/"N" strings
  right: string;
  sitemap: boolean | 'Y' | 'N'; // API returns "Y"/"N" strings
  hasChildren: boolean;
  details?: PlentyCategoryDetail[];
}

export interface PlentyCategoryDetail {
  categoryId: string; // API returns string, e.g. "16"
  lang: string;
  name: string;
  description: string;
  description2: string;
  shortDescription: string;
  metaDescription: string;
  metaKeywords: string;
  metaTitle: string;
  nameUrl: string;
  canonicalLink: string;
  previewUrl: string;
  position: string; // API returns string, e.g. "0"
  updatedAt: string;
  updatedBy: string;
  itemListView?: string;
  singleItemView?: string;
  pageView?: string;
  fulltext?: 'Y' | 'N'; // API returns "Y"/"N" strings
  metaRobots?: string;
  image?: string | null;
  imagePath?: string | null;
  image2?: string | null;
  image2Path?: string | null;
  plentyId?: number;
}

export interface PlentyAttribute {
  id: number;
  backendName: string;
  position: number;
  isSurchargePercental: boolean;
  isLinkableToImage: boolean;
  amazonAttribute: string | null;
  fruugoAttribute: string | null;
  pixmaniaAttribute: number | null;
  ottAttributeGroup: string | null;
  googleShoppingAttribute: string | null;
  neckermannAtEpAttribute: string | null;
  laRedouteAttribute: number | null;
  tracdelightAttribute: string | null;
  typeOfSelectionInOnlineStore: string;
  attributeNames?: PlentyAttributeName[];
  values?: PlentyAttributeValue[]; // API returns this field
  attributeValues?: PlentyAttributeValue[]; // Legacy field name (not used by API)
}

export interface PlentyAttributeName {
  attributeId: number;
  lang: string;
  name: string;
}

export interface PlentyAttributeValue {
  id: number;
  attributeId: number;
  backendName: string;
  position: number;
  image: string | null;
  comment: string | null;
  amazonValue: string | null;
  ottValue: string | null;
  neckermannAtEpValue: string | null;
  laRedouteValue: string | null;
  tracdelightValue: string | null;
  percentageDistribution: number;
  valueNames?: PlentyAttributeValueName[];
}

export interface PlentyAttributeValueName {
  valueId: number;
  lang: string;
  name: string;
}

export interface PlentySalesPrice {
  id: number;
  position: number;
  minimumOrderQuantity: number;
  type: string;
  isCustomerPrice: boolean;
  isDisplayedByDefault: boolean;
  isLiveConversion: boolean;
  createdAt: string;
  updatedAt: string;
  names?: PlentySalesPriceName[];
  accounts?: PlentySalesPriceAccount[];
  countries?: PlentySalesPriceCountry[];
  currencies?: PlentySalesPriceCurrency[];
  customerClasses?: PlentySalesPriceCustomerClass[];
  referrers?: PlentySalesPriceReferrer[];
  clients?: PlentySalesPriceClient[];
}

export interface PlentySalesPriceName {
  salesPriceId: number;
  lang: string;
  nameInternal: string;
  nameExternal: string;
}

export interface PlentySalesPriceAccount {
  salesPriceId: number;
  accountId: number;
  accountType: string;
}

export interface PlentySalesPriceCountry {
  salesPriceId: number;
  countryId: number;
}

export interface PlentySalesPriceCurrency {
  salesPriceId: number;
  currency: string;
}

export interface PlentySalesPriceCustomerClass {
  salesPriceId: number;
  customerClassId: number;
}

export interface PlentySalesPriceReferrer {
  salesPriceId: number;
  referrerId: number;
}

export interface PlentySalesPriceClient {
  salesPriceId: number;
  plentyId: number;
}

export interface PlentyManufacturer {
  id: number;
  name: string;
  externalName: string | null;
  logo: string | null;
  url: string | null;
  street: string | null;
  houseNo: string | null;
  postcode: string | null;
  town: string | null;
  phoneNumber: string | null;
  faxNumber: string | null;
  email: string | null;
  countryId: number | null;
  pixmaniaBrandId: number | null;
  neckermannBrandId: number | null;
  position: number;
  comment: string | null;
  updatedAt: string;
  laRedouteBrandId: number | null;
}

export interface PlentyUnit {
  id: number;
  position: number;
  unitOfMeasurement: string;
  isDecimalPlacesAllowed: boolean;
  names?: PlentyUnitName[];
}

export interface PlentyUnitName {
  unitId: number;
  lang: string;
  name: string;
}

// ============================================
// PROPERTIES (Eigenschaften)
// ============================================

export interface PlentyProperty {
  id: number;
  propertyId: number;
  cast: 'shortText' | 'selection' | 'multiSelection' | 'int' | 'float' | 'file' | 'longText' | 'empty' | 'string';
  typeIdentifier: string; // 'item', 'contact', etc.
  position: number;
  propertyGroupId: number | null;
  names?: PlentyPropertyName[];
  options?: PlentyPropertyOption[];
  groups?: PlentyPropertyGroup[];
  selections?: PlentyPropertySelection[];
  amazons?: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface PlentyPropertyName {
  propertyId: number;
  lang: string;
  name: string;
  description: string;
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlentyPropertyOption {
  propertyId: number;
  typeOptionIdentifier: 'display' | 'clients' | 'referrers' | 'displayOrder' | 'markup' | 'units' | 'vatId';
  id: number;
  createdAt: string;
  updatedAt: string;
  propertyOptionValues?: PlentyPropertyOptionValue[];
}

export interface PlentyPropertyOptionValue {
  optionId: number;
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlentyPropertyGroup {
  id: number;
  position: number;
  names?: PlentyPropertyGroupName[];
  createdAt: string;
  updatedAt: string;
  groupRelation?: {
    propertyId: number;
    propertyGroupId: number;
  };
}

export interface PlentyPropertyGroupName {
  propertyGroupId: number;
  lang: string;
  name: string;
  description: string;
  id: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlentyPropertySelection {
  propertyId: number;
  position: number;
  id: number;
  createdAt: string;
  updatedAt: string;
  relation?: PlentyPropertySelectionRelation;
}

export interface PlentyPropertySelectionRelation {
  propertyId: number;
  selectionRelationId: number;
  groupId: number | null;
  markup: number | null;
  relationTargetId: number | null;
  relationTypeIdentifier: string | null;
  createdAt: string;
  updatedAt: string;
  id: number;
  relationValues?: PlentyPropertySelectionValue[];
}

export interface PlentyPropertySelectionValue {
  propertyRelationId: number;
  lang: string;
  value: string;
  description: string;
  id: number;
  createdAt: string;
  updatedAt: string;
}

// ============================================
// API REQUEST PARAMETERS
// ============================================

export interface PlentyVariationQueryParams {
  page?: number;
  itemsPerPage?: number;
  with?: string; // Comma-separated: variationSalesPrices,variationBarcodes,stock
  updatedBetween?: string; // Unix timestamp or ISO 8601. Format: "from" or "from,to". Example: "1451606400" or "1451606400,1456790400"
  isActive?: boolean;
  isMain?: boolean;
  itemId?: number;
  flagOne?: number;
  flagTwo?: number;
  lang?: string;
}

export interface PlentyCategoryQueryParams {
  page?: number;
  itemsPerPage?: number;
  parentId?: number;
  type?: string;
  with?: string;
  updatedBetween?: string; // Unix timestamp or ISO 8601. Format: "from" or "from,to". Example: "1451606400" or "1451606400,1456790400"
  lang?: string;
}

// ============================================
// STOCK SPECIFIC
// ============================================

export interface PlentyStockEntry {
  warehouseId: number;
  variationId: number;
  stockPhysical: number;
  reservedStock: number;
  stockNet: number;
  reorderLevel: number;
  deltaStockPhysical: number;
  deltaStockReserved: number;
}

// Stock Management API response (from /rest/stockmanagement/stock)
export interface PlentyStockManagementEntry {
  itemId: number;
  warehouseId: number;
  stockPhysical: number;
  reservedStock: number;
  reservedEbay: number;
  reorderDelta: number;
  stockNet: number;
  storehouse_type: string;
  reordered: number;
  reservedBundle: number;
  averagePurchasePrice: number;
  warehousePriority: string;
  updatedAt: string;
  variationId: number;
}
