-- AlterTable
ALTER TABLE "attribute_mappings" ADD COLUMN     "source_type" TEXT NOT NULL DEFAULT 'ATTRIBUTE';

-- AlterTable
ALTER TABLE "mock_shopware_property_groups" ADD COLUMN     "custom_fields" JSONB,
ADD COLUMN     "plenty_property_id" INTEGER;

-- AlterTable
ALTER TABLE "mock_shopware_property_options" ADD COLUMN     "custom_fields" JSONB,
ADD COLUMN     "plenty_property_id" INTEGER,
ADD COLUMN     "plenty_selection_id" INTEGER;

-- AlterTable
ALTER TABLE "property_mappings" ADD COLUMN     "source_type" TEXT NOT NULL DEFAULT 'PROPERTY';

-- CreateIndex
CREATE INDEX "mock_shopware_property_groups_tenant_id_plenty_property_id_idx" ON "mock_shopware_property_groups"("tenant_id", "plenty_property_id");

-- CreateIndex
CREATE INDEX "mock_shopware_property_options_tenant_id_plenty_property_id_idx" ON "mock_shopware_property_options"("tenant_id", "plenty_property_id");
