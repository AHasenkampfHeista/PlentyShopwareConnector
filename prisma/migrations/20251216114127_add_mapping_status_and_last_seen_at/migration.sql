-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('ACTIVE', 'ORPHANED');

-- AlterTable
ALTER TABLE "attribute_mappings" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "attribute_value_mappings" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "category_mappings" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "manufacturer_mappings" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "property_mappings" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "property_selection_mappings" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "unit_mappings" ADD COLUMN     "last_seen_at" TIMESTAMP(3),
ADD COLUMN     "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "attribute_mappings_tenant_id_status_idx" ON "attribute_mappings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "attribute_value_mappings_tenant_id_status_idx" ON "attribute_value_mappings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "category_mappings_tenant_id_status_idx" ON "category_mappings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "manufacturer_mappings_tenant_id_status_idx" ON "manufacturer_mappings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "property_mappings_tenant_id_status_idx" ON "property_mappings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "property_selection_mappings_tenant_id_status_idx" ON "property_selection_mappings"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "unit_mappings_tenant_id_status_idx" ON "unit_mappings"("tenant_id", "status");
