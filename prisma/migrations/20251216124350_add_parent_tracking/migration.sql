-- AlterTable
ALTER TABLE "product_mappings" ADD COLUMN     "is_parent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shopware_parent_id" TEXT;

-- CreateIndex
CREATE INDEX "product_mappings_tenant_id_is_parent_idx" ON "product_mappings"("tenant_id", "is_parent");
