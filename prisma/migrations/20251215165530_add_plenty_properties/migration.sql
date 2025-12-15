-- CreateTable
CREATE TABLE "plenty_properties" (
    "id" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "property_group_id" INTEGER,
    "cast" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "names" JSONB,
    "display_options" JSONB,
    "selections" JSONB,
    "property_group" JSONB,
    "raw_data" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plenty_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_property_id" INTEGER NOT NULL,
    "plenty_property_group_id" INTEGER,
    "shopware_property_group_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_selection_mappings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plenty_property_id" INTEGER NOT NULL,
    "plenty_selection_id" INTEGER NOT NULL,
    "shopware_property_group_id" TEXT NOT NULL,
    "shopware_property_option_id" TEXT NOT NULL,
    "mapping_type" "MappingType" NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_sync_action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_selection_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plenty_properties_tenant_id_idx" ON "plenty_properties"("tenant_id");

-- CreateIndex
CREATE INDEX "plenty_properties_tenant_id_property_group_id_idx" ON "plenty_properties"("tenant_id", "property_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "plenty_properties_tenant_id_id_key" ON "plenty_properties"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "property_mappings_tenant_id_plenty_property_group_id_idx" ON "property_mappings"("tenant_id", "plenty_property_group_id");

-- CreateIndex
CREATE INDEX "property_mappings_tenant_id_mapping_type_idx" ON "property_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "property_mappings_tenant_id_plenty_property_id_key" ON "property_mappings"("tenant_id", "plenty_property_id");

-- CreateIndex
CREATE INDEX "property_selection_mappings_tenant_id_plenty_property_id_idx" ON "property_selection_mappings"("tenant_id", "plenty_property_id");

-- CreateIndex
CREATE INDEX "property_selection_mappings_tenant_id_mapping_type_idx" ON "property_selection_mappings"("tenant_id", "mapping_type");

-- CreateIndex
CREATE UNIQUE INDEX "property_selection_mappings_tenant_id_plenty_selection_id_key" ON "property_selection_mappings"("tenant_id", "plenty_selection_id");

-- CreateIndex
CREATE UNIQUE INDEX "property_selection_mappings_tenant_id_shopware_property_opt_key" ON "property_selection_mappings"("tenant_id", "shopware_property_option_id");

-- AddForeignKey
ALTER TABLE "plenty_properties" ADD CONSTRAINT "plenty_properties_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_mappings" ADD CONSTRAINT "property_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_selection_mappings" ADD CONSTRAINT "property_selection_mappings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
