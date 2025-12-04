# Implementation Plan: Entity Mapping Table + Shopware Bulk Sync API

## Overview
Improve sync performance and architecture by:
1. Adding an entity mapping table to track PlentyMarkets ↔ Shopware ID relationships
2. Implementing Shopware's bulk sync API (`/api/_action/sync`) for efficient upserts
3. Batch processing instead of one-by-one syncing

## Current State Analysis

### Current Flow (One-by-one)
```
For each variation:
  1. Transform variation → Shopware product
  2. Check if product exists (productExists by SKU)
  3. If exists → updateProductBySku
     If not → createProduct
  4. Log result
```

**Problems:**
- One database query per product to check existence
- One API call per product (create or update)
- No persistent mapping between Plenty variation ID and Shopware product UUID
- Inefficient for large catalogs (1000s of products)

### Shopware Bulk Sync API

Shopware provides `/api/_action/sync` endpoint that:
- Accepts batches of operations (create/update/delete)
- Performs upserts automatically (no need to check if exists)
- Returns results for each operation
- Much faster than individual API calls

**Format:**
```json
{
  "write-product": {
    "entity": "product",
    "action": "upsert",
    "payload": [
      {
        "id": "uuid-or-null",  // null for create, uuid for update
        "productNumber": "PROD-001",
        "name": "Product Name",
        "stock": 100,
        // ... other fields
      }
    ]
  }
}
```

## Proposed Solution

### 1. Database Schema Changes

**Add new table: `ProductMapping`**
```prisma
model ProductMapping {
  id                    String   @id @default(uuid())
  tenantId              String   @map("tenant_id")
  tenant                Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // PlentyMarkets identifiers
  plentyItemId          Int      @map("plenty_item_id")
  plentyVariationId     Int      @map("plenty_variation_id")

  // Shopware identifiers
  shopwareProductId     String   @map("shopware_product_id") // UUID from Shopware
  shopwareProductNumber String   @map("shopware_product_number") // SKU

  // Sync metadata
  lastSyncedAt          DateTime @map("last_synced_at")
  lastSyncAction        String   @map("last_sync_action") // 'create', 'update'

  // Timestamps
  createdAt             DateTime @default(now()) @map("created_at")
  updatedAt             DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, plentyVariationId])
  @@unique([tenantId, shopwareProductId])
  @@index([tenantId, shopwareProductNumber])
  @@index([tenantId, plentyItemId])
  @@map("product_mappings")
}
```

**Benefits:**
- Fast lookups: Given Plenty variation ID → Get Shopware product UUID
- Unique constraints prevent duplicates
- Indexed for performance
- Tracks when each product was last synced

### 2. Interface Changes

**Update `IShopwareClient` interface:**
```typescript
interface IShopwareClient {
  // ... existing methods ...

  /**
   * Bulk sync products using Shopware's /api/_action/sync endpoint
   * Automatically creates or updates based on product ID
   */
  bulkSyncProducts(
    products: ShopwareBulkProduct[]
  ): Promise<ShopwareBulkSyncResult>;
}

interface ShopwareBulkProduct {
  id?: string; // null/undefined = create, uuid = update
  productNumber: string;
  stock: number;
  active: boolean;
  price: ShopwarePrice[];
  // ... other required fields
  _plentyVariationId?: number; // For internal tracking
}

interface ShopwareBulkSyncResult {
  success: boolean;
  results: Array<{
    productNumber: string;
    shopwareId: string; // UUID returned by Shopware
    action: 'create' | 'update';
    success: boolean;
    error?: string;
  }>;
}
```

### 3. Implementation Steps

#### Step 1: Database Migration
1. Create migration file for `ProductMapping` table
2. Run migration
3. Optionally backfill from `MockShopwareProduct` table (has `plentyVariationId`)

#### Step 2: Implement Bulk Sync in MockShopwareClient
1. Add `bulkSyncProducts` method to `MockShopwareClient`
2. Use Prisma transactions for batch upsert
3. Return proper result format matching interface

#### Step 3: Create Real ShopwareClient (if not exists)
1. Implement `ShopwareClient` class for real Shopware API
2. Implement authentication (OAuth2)
3. Implement `bulkSyncProducts` using `/api/_action/sync`
4. Handle batch size limits (Shopware recommends batches of 100-500)

#### Step 4: Update ProductSyncProcessor
1. Load existing mappings for variations
2. Batch variations into groups (e.g., 100 per batch)
3. For each batch:
   - Transform all variations
   - Look up existing Shopware IDs from mapping table
   - Call `bulkSyncProducts` with IDs included
   - Process results and update mapping table
4. Remove individual `productExists` and `updateProductBySku` calls

#### Step 5: Add Mapping Table Management
1. Create `ProductMappingService` helper class
2. Methods:
   - `getMapping(tenantId, variationId)` → Shopware ID
   - `getBatchMappings(tenantId, variationIds[])` → Map of mappings
   - `upsertMapping(tenantId, variationId, shopwareId, action)`
   - `deleteMappingsByVariationIds(tenantId, variationIds[])`

### 4. Updated Sync Flow

**New Flow (Batched):**
```
1. Fetch all variations from PlentyMarkets (same as before)

2. Load existing mappings from database
   SELECT * FROM product_mappings
   WHERE tenant_id = ? AND plenty_variation_id IN (...)

3. Split variations into batches of 100

4. For each batch:
   a. Transform all variations → Shopware products
   b. Add Shopware product ID from mapping (if exists)
   c. Call bulkSyncProducts([...])
   d. Process results:
      - Update mapping table with new/updated IDs
      - Collect statistics (created/updated/failed)
      - Log errors

5. Update sync state (same as before)
```

## Implementation Phases

### Phase 1: Database & Mock (Development)
- [ ] Create migration for `ProductMapping` table
- [ ] Run migration and verify schema
- [ ] Implement `bulkSyncProducts` in `MockShopwareClient`
- [ ] Create `ProductMappingService` utility
- [ ] Update `ProductSyncProcessor` to use batching + bulk sync
- [ ] Test with mock data

**Estimated changes:**
- 1 migration file
- 2 new service classes (~200 lines)
- Update ProductSyncProcessor (~100 lines changed)
- Update MockShopwareClient (~150 lines added)

### Phase 2: Real Shopware Client (Production)
- [ ] Create `ShopwareClient` class (currently only Mock exists)
- [ ] Implement OAuth2 authentication
- [ ] Implement `/api/_action/sync` endpoint
- [ ] Handle Shopware API rate limits and errors
- [ ] Add retry logic for failed batches
- [ ] Integration testing

**Estimated changes:**
- 1 new client class (~400 lines)
- Update factory/config to switch between Mock and Real

### Phase 3: Optimization & Monitoring
- [ ] Add metrics for batch performance
- [ ] Implement partial batch retry (if some products fail)
- [ ] Add mapping table cleanup job (remove orphaned mappings)
- [ ] Add validation for mapping consistency
- [ ] Performance testing with large catalogs

## Trade-offs & Considerations

### Benefits
✅ **Performance:** Batch API calls 100x faster for large catalogs
✅ **Simplicity:** No need for existence checks
✅ **Reliability:** Mapping table provides quick lookups
✅ **Shopware-aligned:** Using native bulk sync API
✅ **Scalability:** Handles 10k+ products efficiently

### Risks & Mitigations
⚠️ **Mapping table consistency:** If Shopware product deleted manually, mapping becomes stale
  - *Mitigation:* Add validation check, handle 404s from Shopware

⚠️ **Batch error handling:** Partial batch failures harder to track
  - *Mitigation:* Shopware returns per-item results, log each individually

⚠️ **Migration complexity:** Existing MockShopwareProduct table has variation IDs
  - *Mitigation:* Backfill script to populate mapping table from existing data

⚠️ **Memory usage:** Loading all mappings for large batches
  - *Mitigation:* Load mappings in chunks, use streaming where possible

### Alternative Approaches Considered

**Option A: Keep one-by-one, just add mapping table**
- Pros: Simpler change, less risk
- Cons: Still slow, doesn't leverage bulk API

**Option B: Use Shopware's search API to check existence**
- Pros: No mapping table needed
- Cons: Extra API call per product, still not as fast as bulk sync

**Option C: Store Shopware ID in MockShopwareProduct table**
- Pros: No new table
- Cons: Only works for mock, not production Shopware

**Selected: Mapping table + Bulk Sync**
- Best performance and scalability
- Aligns with production Shopware usage
- Clean separation of concerns

## Questions for User

1. **Backfill existing data?**
   - Should we create a script to backfill the mapping table from existing `MockShopwareProduct` records (which have `plentyVariationId`)?

2. **Batch size preference?**
   - Shopware recommends 100-500 per batch. Default to 100?

3. **Real Shopware implementation priority?**
   - Implement Phase 1 (Mock) first and test, then Phase 2 (Real Shopware)?
   - Or implement both together?

4. **Mapping cleanup strategy?**
   - How should we handle orphaned mappings (e.g., product deleted in Shopware)?
   - Add a cleanup job that validates mappings periodically?

5. **Error handling for partial failures?**
   - If 5 out of 100 products fail in a batch, should we:
     a) Mark entire batch as failed
     b) Mark individual products as failed, others as success
     c) Retry failed products individually
