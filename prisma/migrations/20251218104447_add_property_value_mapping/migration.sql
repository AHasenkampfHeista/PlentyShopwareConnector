-- CreateTable
CREATE TABLE "property_value_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_property_id" INTEGER NOT NULL,
    "value_hash" TEXT NOT NULL,
    "original_value" TEXT NOT NULL,
    "shopware_property_group_id" TEXT NOT NULL,
    "shopware_property_option_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "status" "MappingStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_value_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "property_value_mappings_tenant_id_plenty_property_id_idx" ON "property_value_mappings"("tenant_id", "plenty_property_id");

-- CreateIndex
CREATE INDEX "property_value_mappings_tenant_id_shopware_property_option__idx" ON "property_value_mappings"("tenant_id", "shopware_property_option_id");

-- CreateIndex
CREATE INDEX "property_value_mappings_tenant_id_mapping_type_idx" ON "property_value_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE INDEX "property_value_mappings_tenant_id_status_idx" ON "property_value_mappings"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "property_value_mappings_tenant_id_plenty_property_id_value__key" ON "property_value_mappings"("tenant_id", "plenty_property_id", "value_hash");

-- AddForeignKey
ALTER TABLE "property_value_mappings" ADD CONSTRAINT "property_value_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
