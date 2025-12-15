# TODO: Bulk Sync Refactoring

Refactor all config sync methods in `ConfigSyncProcessor` to use Shopware's bulk sync endpoint (`/api/_action/sync`) instead of individual API calls.

## Completed

- [x] **Manufacturers** - Implemented bulk sync with logo upload handling
  - Bulk upsert to local cache (Prisma transaction)
  - Batch fetch existing mappings
  - Sequential logo uploads (media API doesn't support bulk)
  - Single bulk API call to Shopware
  - Bulk mapping updates

- [x] **Categories** - Implemented bulk sync with hierarchical processing
  - Bulk upsert to local cache (Prisma transaction)
  - Batch fetch existing mappings
  - Level-by-level processing (parents before children)
  - Parent ID resolution using tracking map
  - Single bulk API call per level to Shopware
  - Bulk mapping updates
  - Handle translations

- [x] **Attributes** - Implemented bulk sync with two-phase approach
  - Bulk upsert to local cache (Prisma transaction)
  - Batch fetch existing attribute + value mappings
  - Two-phase sync: property groups first, then property options
  - Track generated Shopware group IDs for option groupId
  - Single bulk API call for groups, single call for options
  - Bulk mapping updates for both
  - Handle translations with position included per language (Shopware stores position in `property_group_option_translation` table)
  - Map `typeOfSelectionInOnlineStore` to Shopware `displayType`:
    - "image" → "media"
    - "dropdown" → "select"
    - default → "text"
  - Upload attribute value images for media-type property groups
  - Image URL from TenantConfig (`plentyFrontendUrl`)

- [x] **Sales Prices** - Cache locally only (no Shopware sync)
  - Sales prices define price types (default, RRP, etc.) - not synced to Shopware
  - Bulk upsert to local cache (Prisma transaction)
  - Logs available price types for configuration reference
  - Price values applied during product sync using `defaultSalesPriceId` and `rrpSalesPriceId` from TenantConfig

- [x] **TenantConfig** - Added flexible tenant configuration system
  - New `tenant_configs` table with key-value storage (JSON values)
  - `TenantConfigService` with type-safe getters
  - Supports strings, numbers, booleans, mappings, and arrays
  - Well-known keys: `plentyFrontendUrl`, `defaultSalesPriceId`, `rrpSalesPriceId`, `taxMappings`

- [x] **Units** - Implemented bulk sync
  - Bulk upsert to local cache (Prisma transaction)
  - Batch fetch existing mappings
  - Single bulk API call to Shopware
  - Bulk mapping updates
  - Handle translations

## All Config Sync Methods Refactored!

All config sync methods now use bulk operations for improved performance.

## Pattern Used

Each bulk sync should follow this pattern (see `syncManufacturers` for reference):

1. Fetch all entities from PlentyMarkets
2. Bulk upsert to local cache (Prisma transaction)
3. Batch fetch all existing mappings
4. Handle any media uploads (if applicable)
5. Prepare bulk payload with Shopware IDs (existing) or generated UUIDs (new)
6. Single bulk API call to Shopware using `bulkSync*` method
7. Bulk update mappings based on results

## Files to Modify

- `src/processors/ConfigSyncProcessor.ts` - Main sync logic
- `src/services/*MappingService.ts` - Ensure `getBatchMappings` method exists
- `src/clients/ShopwareClient.ts` - Bulk sync methods already exist
