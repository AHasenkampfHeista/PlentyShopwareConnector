# TODO: Orphaned Entity Cleanup

Implement a configurable cleanup job that removes entities from Shopware when they no longer exist in PlentyMarkets.

## Requirements

- **Per-tenant configuration**: Some tenants want auto-delete, others don't
- **Separate job**: Not part of normal sync, runs independently
- **Per-entity-type settings**: May want to delete manufacturers but not categories

## Implementation Plan

### 1. Add Tenant Configuration

Add to `Tenant` model or create `TenantSettings` table:
```
cleanupConfig: {
  enabled: boolean
  manufacturers: 'delete' | 'deactivate' | 'skip'
  categories: 'delete' | 'deactivate' | 'skip'
  attributes: 'delete' | 'deactivate' | 'skip'
  units: 'delete' | 'deactivate' | 'skip'
  salesPrices: 'delete' | 'deactivate' | 'skip'
}
```

### 2. Create CleanupProcessor

New file: `src/processors/CleanupProcessor.ts`
- For each entity type:
  1. Get all IDs from Plenty
  2. Get all mappings from DB
  3. Find orphaned mappings (in DB but not in Plenty)
  4. Based on tenant config: delete from Shopware, deactivate, or skip
  5. Remove orphaned mappings from DB

### 3. Add Cleanup Sync Type

- Add `CLEANUP` to `SyncType` enum
- Create schedule for cleanup (e.g., daily at midnight)
- Add script: `scripts/trigger-cleanup.ts`

### 4. Add Delete Methods to ShopwareClient

- `deleteManufacturer(id: string)`
- `deleteCategory(id: string)`
- `deletePropertyGroup(id: string)`
- `deleteUnit(id: string)`
- Bulk delete variants using `_action/sync` with `delete` action

## Safety Considerations

- Log all deletions for audit trail
- Consider "dry run" mode that reports what would be deleted without doing it
- Maybe require manual confirmation for large deletions (> N items)
