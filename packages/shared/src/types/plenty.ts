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
  variationStock?: PlentyVariationStock[];
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
  warehouseId: number;
  stockPhysical: number;
  reservedStock: number;
  reservedEbay: number;
  reorderLevel: number;
  stockNet: number;
  warehousePriority: number;
  updatedAt: string;
}

export interface PlentyVariationAttributeValue {
  variationId: number;
  attributeId: number;
  attributeValueId: number;
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
  linklist: boolean;
  right: string;
  sitemap: boolean;
  hasChildren: boolean;
  details?: PlentyCategoryDetail[];
}

export interface PlentyCategoryDetail {
  categoryId: number;
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
  position: number;
  updatedAt: string;
  updatedBy: string;
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
  attributeValues?: PlentyAttributeValue[];
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
// API REQUEST PARAMETERS
// ============================================

export interface PlentyVariationQueryParams {
  page?: number;
  itemsPerPage?: number;
  with?: string; // Comma-separated: variationSalesPrices,variationBarcodes,variationStock
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
